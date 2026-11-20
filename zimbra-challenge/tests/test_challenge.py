import sqlite3

import pytest

from postmortem import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.db"),
                      "SECRET_KEY": "test-secret", "INSPECTION_CODE": "IGT{test_only}"})
    return app.test_client()


def csrf(client):
    with client.session_transaction() as sess:
        return sess["csrf"]


def register(client, name="alice"):
    client.get("/register")
    return client.post("/register", data={"csrf": csrf(client), "username": name,
                                          "password": "securepassword"}, follow_redirects=True)


def send(client, body, recipient="unfinished"):
    response = client.post("/compose", data={"csrf": csrf(client), "recipient": recipient,
                                             "subject": "Archive test", "body": body},
                           follow_redirects=True)
    assert response.request.path.startswith("/messages/"), response.request.path
    return int(response.request.path.rsplit("/", 1)[-1]), response


def inspect(client, message_id):
    return client.post(f"/dead-letters/{message_id}/reconstruct", data={"csrf": csrf(client)})


def test_registration_login_and_menu(client):
    response = register(client)
    assert response.request.path == "/inbox"
    for text in (b"New message", b"Inbox", b"Sent", b"Drafts"):
        assert text in response.data
    client.post("/logout", data={"csrf": csrf(client)})
    assert client.get("/inbox").status_code == 302
    client.get("/login")
    response = client.post("/login", data={"csrf": csrf(client), "username": "alice",
                                           "password": "securepassword"}, follow_redirects=True)
    assert response.request.path == "/inbox"


@pytest.mark.parametrize("address", ["", "unfinished", "a@@example.com", "a b@example.com",
                                     "a..b@example.com", "a@-example.com", "a@example."])
def test_draft_inspection(client, address):
    register(client)
    mid, original = send(client, "Title: {{ subject }}. {{ recipient }}", address)
    assert b"Saved to Drafts" in original.data and b"{{ subject }}" in original.data
    assert b"Archive test" in client.get("/drafts").data
    assert b"Archive test" not in client.get("/sent").data
    result = client.get(f"/messages/{mid}")
    assert b"Title: Archive test." in result.data
    assert b">Inspect<" not in result.data


@pytest.mark.parametrize("address", ["a@invalid.test", "first.last+tag@sub.example.org"])
def test_sent_is_verbatim(client, address):
    register(client)
    mid, response = send(client, "{{ inspection_code }}", address)
    assert b"Message sent." in response.data and b"{{ inspection_code }}" in response.data
    assert b">Inspect<" not in response.data
    assert b"Archive test" in client.get("/sent").data
    assert b"Archive test" not in client.get("/drafts").data
    assert inspect(client, mid).status_code == 404


def test_edit_and_deliver_to_local_inbox(client):
    bob = client.application.test_client()
    register(bob, "bob")
    register(client)
    mid, _ = send(client, "First version")
    assert b"First version" in client.get(f"/drafts/{mid}/edit").data
    data = {"csrf": csrf(client), "recipient": "bob@ZIMBRA.TEST", "subject": "Meeting", "body": "Tomorrow"}
    result = client.post(f"/drafts/{mid}/edit", data=data, follow_redirects=True)
    assert b"Message sent." in result.data
    assert b"Meeting" not in client.get("/drafts").data
    assert b"Meeting" in client.get("/sent").data
    assert b"Meeting" in bob.get("/inbox").data
    assert b"alice@zimbra.test" in bob.get(f"/inbox/{mid}").data
    assert client.post(f"/drafts/{mid}/edit", data=data).status_code == 404
    assert inspect(client, mid).status_code == 404
    assert inspect(bob, mid).status_code == 404
    assert bob.get(f"/messages/{mid}").status_code == 404
    assert client.get(f"/inbox/{mid}").status_code == 404


def test_inspection_ownership_escaping_and_csrf(client):
    register(client)
    mid, _ = send(client, """<b>{{ "whoami" | worker }}</b>""")
    assert client.post(f"/drafts/{mid}/inspect").status_code == 400
    assert b"&lt;b&gt;recoveryworker&lt;/b&gt;" in inspect(client, mid).data
    bob = client.application.test_client()
    register(bob, "bob")
    assert bob.get(f"/messages/{mid}").status_code == 404
    assert bob.get(f"/drafts/{mid}/edit").status_code == 404
    assert inspect(bob, mid).status_code == 404
    assert bob.get(f"/inbox/{mid}").status_code == 404


def test_screenshot_draft_probe(client):
    register(client)
    original = client.post("/compose", data={"csrf": csrf(client), "recipient": "retertre",
                           "subject": "{{7*7}}", "body": "{{7*7}}"}, follow_redirects=True)
    mid = int(original.request.path.rsplit("/", 1)[-1])
    assert b"<pre>{{7*7}}</pre>" in original.data
    result = client.get(f"/messages/{mid}")
    assert b"<pre>{{7*7}}</pre>" in result.data
    assert b"<pre>49</pre>" in result.data
    assert b"<h1>{{7*7}}</h1>" in result.data


def test_arithmetic_and_literal_fields(client):
    register(client)
    mid, _ = send(client, "{{ 12 * 4 }} / {{ -3+11 }} / {{ 5 - 12 }}")
    assert b"<pre>48 / 8 / -7</pre>" in inspect(client, mid).data
    edited = client.post(f"/drafts/{mid}/edit", data={"csrf": csrf(client), "recipient": "",
                         "subject": "{{7*7}}", "body": "{{subject}}"})
    assert edited.status_code == 302
    assert b"<pre>{{7*7}}</pre>" in inspect(client, mid).data


@pytest.mark.parametrize(("command", "expected"), [
    ("whoami", "recoveryworker"),
    ("id", "uid=1001(recoveryworker) gid=1001(recoveryworker) groups=1001(recoveryworker)"),
    ("pwd", "/opt/deadletter"),
    ("ls", "flag.txt"),
    ("ls /opt/deadletter", "flag.txt"),
    ("cat /opt/deadletter/flag.txt", "IGT{test_only}"),
    ("cat flag.txt", "IGT{test_only}"),
    ("cat other.txt", "Unsupported worker command."),
    ("cat /another/file", "Unsupported worker command."),
    ("pwd && whoami", "Unsupported worker command."),
])
def test_virtual_worker(client, command, expected):
    register(client)
    mid, _ = send(client, "{{ '" + command + "' | worker }}")
    assert f"<pre>{expected}</pre>".encode() in inspect(client, mid).data


def test_flag_only_in_inspection(client):
    register(client)
    flag = b"IGT{test_only}"
    body = '{{ "cat /opt/deadletter/flag.txt" | worker }}'
    draft, _ = send(client, body)
    sent, _ = send(client, body, "alice@zimbra.test")
    preview = client.get(f"/messages/{draft}")
    assert flag in preview.data
    assert preview.cache_control.no_store
    assert inspect(client, sent).status_code == 404
    for path in ("/drafts", "/inbox", "/sent", f"/inbox/{sent}", f"/messages/{sent}",
                 "/dead-letters", f"/drafts/{draft}/edit", "/reconstructions", "/static/style.css"):
        response = client.get(path)
        assert response.status_code == 200 and flag not in response.data
    for path in ("/flag.txt", "/opt/deadletter/flag.txt", "/static/flag.txt",
                 "/static/opt/deadletter/flag.txt"):
        assert client.get(path).status_code == 404
    with sqlite3.connect(client.application.config["DATABASE"]) as db:
        assert db.execute("SELECT count(*) FROM reconstructions").fetchone() == (0,)
        db.execute("""INSERT INTO reconstructions (user_id,message_id,status,output,created_at)
                      VALUES (1,?,'complete',?,'earlier')""", (draft, flag.decode()))
    assert client.get("/reconstructions/1").status_code == 404
    previous_command, _ = send(client, "{{ archive read delivery-receipt }}")
    assert flag not in inspect(client, previous_command).data


def test_dead_letter_workflow(client):
    register(client)
    mid, original = send(client, "{{7*7}}", "incomplete")
    assert b"<pre>{{7*7}}</pre>" in original.data
    assert b'href="/dead-letters"' in client.get("/drafts").data
    assert f'href="/messages/{mid}"'.encode() in client.get("/dead-letters").data
    link = f"/messages/{mid}"
    assert f'href="{link}"'.encode() in client.get("/drafts").data
    assert b"<pre>49</pre>" in client.get(link).data
    assert b">Inspect<" not in original.data
    old = client.post(f"/drafts/{mid}/inspect", data={"csrf": csrf(client)})
    assert old.status_code == 307 and old.location.endswith(f"/dead-letters/{mid}/reconstruct")
    flag_command = '{{ "cat flag.txt" | worker }}'
    client.post(f"/drafts/{mid}/edit", data={"csrf": csrf(client), "recipient": "",
                "subject": "retry", "body": flag_command})
    assert b"<pre>IGT{test_only}</pre>" in client.get(link).data


def test_auth_and_normal_views_skip_renderer(client, monkeypatch):
    import postmortem

    def forbidden(*args):
        pytest.fail("reconstruction called outside the intended route")

    monkeypatch.setattr(postmortem, "inspect_body", forbidden)
    register(client)
    mid, _ = send(client, "{{7*7}}", "alice@zimbra.test")
    for path in ("/inbox", "/sent", f"/messages/{mid}", f"/inbox/{mid}", "/dead-letters"):
        assert client.get(path).status_code == 200
    assert inspect(client, mid).status_code == 404
    client.post("/logout", data={"csrf": csrf(client)})
    client.get("/login")
    for path in ("/register", "/login"):
        response = client.post(path, data={"csrf": csrf(client), "username": "{{7*7}}",
                                          "password": "{{7*7}}"})
        assert response.status_code == 200


def test_rejected_draft_leads_to_working_hint(client):
    from html import unescape

    register(client)
    mid, _ = send(client, "{{ unknown() }}")
    draft = client.get(f"/messages/{mid}")
    html = unescape(draft.get_data(as_text=True))
    example = '{{ "whoami" | worker }}'
    assert "Draft reconstruction is active." in html and example in html
    assert "/opt/deadletter" not in html and "IGT{" not in html
    result = client.post(f"/drafts/{mid}/edit", data={
        "csrf": csrf(client), "recipient": "", "subject": "Retry", "body": example
    }, follow_redirects=True)
    assert b"<pre>recoveryworker</pre>" in result.data
    assert b"Draft reconstruction is active." not in result.data
