import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS drawings (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  elements   TEXT NOT NULL DEFAULT '[]',
  app_state  TEXT NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drawings_owner ON drawings(owner_id, updated_at);

-- image files of private drawings (BinaryFileData, keyed by content hash)
CREATE TABLE IF NOT EXISTS files (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  data_url   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE IF NOT EXISTS libraries (
  owner_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- end-to-end encrypted collaboration scenes (the key never reaches us)
CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  scene_version INTEGER NOT NULL,
  iv            BLOB NOT NULL,
  ciphertext    BLOB NOT NULL,
  revision      INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- end-to-end encrypted shareable links
CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- previous states of drawings, for the version history
CREATE TABLE IF NOT EXISTS drawing_versions (
  id         TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  elements   TEXT NOT NULL,
  app_state  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- when the drawing was in this state
  state_at   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drawing_versions_drawing
  ON drawing_versions(drawing_id, created_at);

-- small previews shown in the list of drawings
CREATE TABLE IF NOT EXISTS drawing_thumbnails (
  drawing_id TEXT PRIMARY KEY REFERENCES drawings(id) ON DELETE CASCADE,
  mime_type  TEXT NOT NULL,
  data       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- drawings shared with other users of the instance
CREATE TABLE IF NOT EXISTS drawing_shares (
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (drawing_id, user_id)
);
CREATE INDEX IF NOT EXISTS drawing_shares_user ON drawing_shares(user_id);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, drawing_id)
);

-- instance settings, managed by administrators
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- personal access tokens (API / MCP clients such as Claude)
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id);

-- accounts of an OpenID Connect provider (SSO) linked to local users
CREATE TABLE IF NOT EXISTS user_identities (
  issuer     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities(user_id);

-- single-use codes to sign in when the authenticator app is lost (hashed)
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

-- encrypted image files of collab rooms and share links
CREATE TABLE IF NOT EXISTS blobs (
  prefix     TEXT NOT NULL,
  id         TEXT NOT NULL,
  owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (prefix, id)
);
`;

const hasColumn = (db, table, column) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);

/** schema changes for databases created by earlier versions */
const migrate = (db) => {
  if (!hasColumn(db, "users", "status")) {
    // "active", or "pending" until an administrator approves the account
    db.exec(
      "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    );
  }
  if (!hasColumn(db, "users", "totp_secret")) {
    // two-factor authentication (base32 secret of the authenticator app)
    db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
    // last time step used, so that a code can't be used twice
    db.exec(
      "ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!hasColumn(db, "sessions", "method")) {
    // how the session was opened: "password" or "sso"
    db.exec(
      "ALTER TABLE sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'password'",
    );
  }
  if (!hasColumn(db, "drawings", "deleted_at")) {
    // set when moved to the trash
    db.exec("ALTER TABLE drawings ADD COLUMN deleted_at INTEGER");
  }
  if (!hasColumn(db, "drawings", "folder_id")) {
    db.exec(
      "ALTER TABLE drawings ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL",
    );
  }
  if (!hasColumn(db, "drawings", "pending_ops")) {
    // changes requested through the API (e.g. by an AI assistant over MCP),
    // converted to elements by the editor the next time it opens the drawing
    db.exec(
      "ALTER TABLE drawings ADD COLUMN pending_ops TEXT NOT NULL DEFAULT '[]'",
    );
  }
};

export const openDatabase = (dataDir) => {
  let filename = ":memory:";
  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
    filename = path.join(dataDir, "excalidraw.sqlite");
  }
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
};

/** runs `fn` inside a transaction, rolling back if it throws */
export const transaction = (db, fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
