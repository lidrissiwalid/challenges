CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('delivered','failed')), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_owner ON messages(user_id, id);
CREATE TABLE IF NOT EXISTS reconstructions (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 message_id INTEGER NOT NULL REFERENCES messages(id),
 status TEXT NOT NULL CHECK(status IN ('complete','rejected')),
 output TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reconstruction_owner ON reconstructions(user_id, id);

CREATE TABLE IF NOT EXISTS inbox_receipts (
 message_id INTEGER PRIMARY KEY REFERENCES messages(id),
 recipient_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS receipt_owner ON inbox_receipts(recipient_id,message_id);
