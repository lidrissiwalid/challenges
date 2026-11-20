import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, abort, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from .inspection import inspect_body

LOCAL_DOMAIN = "zimbra.test"
MAIL_ATOM = r"[\w!#$%&'*+/=?^`{|}~-]+"
DOMAIN_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
ADDRESS = re.compile(rf"({MAIL_ATOM}(?:\.{MAIL_ATOM})*)@({DOMAIN_LABEL}(?:\.{DOMAIN_LABEL})+)")


def valid_address(address):
    match = ADDRESS.fullmatch(address)
    return bool(match and len(address.encode()) <= 254 and len(match[1].encode()) <= 64)



def create_app(config=None):
    app = Flask(__name__)
    app.config.update(DATABASE=os.environ.get("DATABASE", "/data/postmortem.db"),
                      SECRET_KEY=os.environ.get("SECRET_KEY"),
                      INSPECTION_CODE=os.environ.get("INSPECTION_CODE"),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      MAX_CONTENT_LENGTH=64 * 1024)
    if config:
        app.config.update(config)
    if not app.config["INSPECTION_CODE"]:
        raise RuntimeError("Set INSPECTION_CODE before starting the challenge.")
    if not app.config["SECRET_KEY"]:
        key_file = Path(app.config["DATABASE"]).with_suffix(".secret")
        key_file.parent.mkdir(parents=True, exist_ok=True)
        if not key_file.exists():
            try:
                with key_file.open("x") as handle:
                    handle.write(secrets.token_hex(32))
                key_file.chmod(0o600)
            except FileExistsError:
                pass
        app.config["SECRET_KEY"] = key_file.read_text().strip()

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys=ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop("db", None)
        if connection is not None:
            connection.close()

    with app.app_context():
        Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
        db().executescript((Path(__file__).parent / "schema.sql").read_text())
        db().commit()

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if "user_id" not in session:
                return redirect(url_for("login"))
            return view(*args, **kwargs)
        return wrapped

    def now():
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def owned_message(message_id):
        message = db().execute("SELECT * FROM messages WHERE id=? AND user_id=?",
                               (message_id, session["user_id"])).fetchone()
        if message is None:
            abort(404)
        return message

    @app.before_request
    def check_csrf():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        if request.method == "POST" and not secrets.compare_digest(
                request.form.get("csrf", ""), session["csrf"]):
            abort(400)

    @app.context_processor
    def shared_context():
        return {"csrf": session.get("csrf"), "username": session.get("username"),
                "mail_domain": LOCAL_DOMAIN}

    @app.route("/")
    def index():
        return redirect(url_for("inbox") if "user_id" in session else url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if not (3 <= len(username) <= 32 and username.replace("_", "").isalnum()
                    and 8 <= len(password) <= 128):
                flash("Use a 3–32 character username and a password of at least 8 characters.", "error")
            else:
                try:
                    cursor = db().execute("INSERT INTO users(username,password_hash) VALUES (?,?)",
                                          (username, generate_password_hash(password)))
                    db().commit()
                except sqlite3.IntegrityError:
                    flash("Username already taken.", "error")
                else:
                    session.clear()
                    session["user_id"] = cursor.lastrowid
                    session["username"] = username
                    session["csrf"] = secrets.token_urlsafe(32)
                    return redirect(url_for("inbox"))
        return render_template("auth.html", mode="register")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            user = db().execute("SELECT * FROM users WHERE username=?",
                                (request.form.get("username", ""),)).fetchone()
            if user and check_password_hash(user["password_hash"], request.form.get("password", "")):
                session.clear()
                session["user_id"] = user["id"]
                session["username"] = user["username"]
                session["csrf"] = secrets.token_urlsafe(32)
                return redirect(url_for("inbox"))
            flash("Invalid credentials.", "error")
        return render_template("auth.html", mode="login")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    def folder_page(folder, messages):
        return render_template("messages.html", folder=folder, messages=messages)

    @app.get("/dashboard")
    @login_required
    def dashboard():
        return redirect(url_for("inbox"))

    @app.get("/inbox")
    @login_required
    def inbox():
        rows = db().execute("""SELECT m.*, u.username AS sender FROM inbox_receipts r
            JOIN messages m ON m.id=r.message_id JOIN users u ON u.id=m.user_id
            WHERE r.recipient_id=? ORDER BY m.id DESC""", (session["user_id"],))
        return folder_page("inbox", rows)

    @app.get("/inbox/<int:message_id>")
    @login_required
    def received(message_id):
        row = db().execute("""SELECT m.*, u.username AS sender FROM inbox_receipts r
            JOIN messages m ON m.id=r.message_id JOIN users u ON u.id=m.user_id
            WHERE r.message_id=? AND r.recipient_id=?""", (message_id, session["user_id"])).fetchone()
        if row is None:
            abort(404)
        return render_template("message.html", message=row, folder="inbox")

    def owned_draft(message_id):
        row = owned_message(message_id)
        if row["status"] != "failed":
            abort(404)
        return row

    @app.route("/compose", methods=["GET", "POST"])
    @app.route("/drafts/<int:message_id>/edit", methods=["GET", "POST"])
    @login_required
    def compose(message_id=None):
        draft = owned_draft(message_id) if message_id is not None else None
        if request.method == "GET":
            return render_template("compose.html", values=draft or {}, editing=draft is not None)

        recipient = request.form.get("recipient", "").strip()
        subject = request.form.get("subject", "").strip()
        body = request.form.get("body", "")
        if len(subject) > 120 or len(body) > 2048:
            flash("Use up to 120 characters for the subject and 2,048 for the message.", "error")
            return render_template("compose.html", values=request.form, editing=draft is not None), 400

        deliver = valid_address(recipient)
        # Existing databases use 'failed' for unsent mail and 'delivered' for sent mail.
        status = "delivered" if deliver else "failed"
        conn = db()
        fields = (recipient, subject, body, status, now())
        with conn:
            if draft is None:
                message_id = conn.execute("""INSERT INTO messages
                    (recipient,subject,body,status,created_at,user_id) VALUES (?,?,?,?,?,?)""",
                    (*fields, session["user_id"])).lastrowid
            else:
                updated = conn.execute("""UPDATE messages SET recipient=?, subject=?, body=?,
                    status=?, created_at=? WHERE id=? AND user_id=? AND status='failed'""",
                    (*fields, message_id, session["user_id"]))
                if not updated.rowcount:
                    abort(409)
            if deliver:
                name, domain = recipient.rsplit("@", 1)
                if domain.lower() == LOCAL_DOMAIN:
                    conn.execute("""INSERT INTO inbox_receipts (message_id,recipient_id)
                        SELECT ?,id FROM users WHERE username=?""", (message_id, name))
        flash("Message sent." if deliver else "Saved to Drafts. Enter a valid recipient to send it.", "info")
        return redirect(url_for("message", message_id=message_id))

    @app.get("/sent")
    @login_required
    def sent():
        rows = db().execute("""SELECT * FROM messages WHERE user_id=? AND status='delivered'
            ORDER BY id DESC""", (session["user_id"],))
        return folder_page("sent", rows)

    @app.get("/drafts")
    @login_required
    def drafts():
        return failed_folder("drafts")

    def failed_folder(folder):
        rows = db().execute("""SELECT * FROM messages WHERE user_id=? AND status='failed'
            ORDER BY id DESC""", (session["user_id"],))
        return folder_page(folder, rows)

    @app.get("/dead-letters")
    @login_required
    def dead_letters():
        return failed_folder("dead_letters")

    @app.get("/messages/<int:message_id>")
    @login_required
    def message(message_id):
        row = owned_message(message_id)
        if row["status"] == "failed":
            return draft_page(row)
        return render_template("message.html", message=row, folder="sent")

    @app.post("/drafts/<int:message_id>/inspect")
    @login_required
    def inspect_draft(message_id):
        owned_draft(message_id)
        return redirect(url_for("reconstruct_draft", message_id=message_id), code=307)

    @app.post("/dead-letters/<int:message_id>/reconstruct")
    @login_required
    def reconstruct_draft(message_id):
        return draft_page(owned_draft(message_id))

    def draft_page(draft):
        preview = inspect_body(draft, app.config["INSPECTION_CODE"])
        page = render_template("message.html", message=draft, folder="drafts", preview=preview)
        return page, 200, {"Cache-Control": "private, no-store"}

    @app.get("/reconstructions")
    @login_required
    def reconstructions():
        jobs = db().execute("""SELECT r.*,m.subject FROM reconstructions r JOIN messages m
            ON m.id=r.message_id WHERE r.user_id=? ORDER BY r.id DESC""",
            (session["user_id"],)).fetchall()
        return render_template("jobs.html", jobs=jobs)

    @app.get("/reconstructions/<int:job_id>")
    @login_required
    def reconstruction(job_id):
        job = db().execute("""SELECT r.*,m.subject,m.recipient FROM reconstructions r
            JOIN messages m ON m.id=r.message_id WHERE r.id=? AND r.user_id=? AND m.user_id=?""",
            (job_id, session["user_id"], session["user_id"])).fetchone()
        if job is None or app.config["INSPECTION_CODE"] in job["output"]:
            abort(404)
        return render_template("reconstruction.html", job=job)

    return app
