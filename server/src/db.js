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
