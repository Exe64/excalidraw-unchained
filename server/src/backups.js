// Backups of the database: automatic (every BACKUP_INTERVAL_HOURS) and on
// demand, stored in DATA_DIR/backups. Restoring replaces the database at the
// next start: the server stages the backup, then restarts (Docker restarts
// the container).

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { config } from "./config.js";

const NAME_RE = /^excalidraw-[0-9]{8}-[0-9]{6}(-[a-z0-9-]+)?\.sqlite$/;
/** automatic backups have no label (only a counter, if needed) */
const AUTOMATIC_RE = /^excalidraw-[0-9]{8}-[0-9]{6}(-[0-9]+)?\.sqlite$/;
const SQLITE_HEADER = "SQLite format 3\0";

export const DATABASE_FILE = "excalidraw.sqlite";
const PENDING_RESTORE_FILE = "restore-pending.sqlite";

export class BackupError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const backupDir = () => path.join(config.dataDir, "backups");

const timestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export const getBackupPath = (name) => {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new BackupError(400, "Nom de sauvegarde invalide.");
  }
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) {
    throw new BackupError(404, "Sauvegarde introuvable.");
  }
  return file;
};

export const listBackups = () => {
  if (!fs.existsSync(backupDir())) {
    return [];
  }
  return fs
    .readdirSync(backupDir())
    .filter((name) => NAME_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(backupDir(), name));
      return {
        name,
        size: stat.size,
        createdAt: stat.mtimeMs,
        automatic: AUTOMATIC_RE.test(name),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};

/** keeps the `keep` most recent automatic backups */
const pruneAutomaticBackups = () => {
  const automatic = listBackups().filter((backup) => backup.automatic);
  for (const backup of automatic.slice(config.backups.keep)) {
    fs.rmSync(path.join(backupDir(), backup.name), { force: true });
  }
};

/**
 * Writes a consistent copy of the database (`VACUUM INTO`, safe while the
 * server is running). `label` is empty for automatic backups.
 */
export const createBackup = (db, label = "") => {
  fs.mkdirSync(backupDir(), { recursive: true });
  const base = `excalidraw-${timestamp()}${label ? `-${label}` : ""}`;
  let name = `${base}.sqlite`;
  // two backups in the same second
  for (let i = 2; fs.existsSync(path.join(backupDir(), name)); i++) {
    name = `${base}-${i}.sqlite`;
  }
  const file = path.join(backupDir(), name);
  db.prepare("VACUUM INTO ?").run(file);
  if (!label) {
    pruneAutomaticBackups();
  }
  return listBackups().find((backup) => backup.name === name);
};

export const deleteBackup = (name) => {
  fs.rmSync(getBackupPath(name));
};

/** checks that `file` is a database of this application */
const validateDatabaseFile = (file) => {
  const fd = fs.openSync(file, "r");
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString("latin1") !== SQLITE_HEADER) {
    throw new BackupError(400, "Ce fichier n'est pas une base SQLite.");
  }
  let backup;
  try {
    backup = new DatabaseSync(file, { readOnly: true });
    const tables = new Set(
      backup
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("users") || !tables.has("drawings")) {
      throw new BackupError(
        400,
        "Ce fichier n'est pas une sauvegarde d'Excalidraw.",
      );
    }
    const { count } = backup
      .prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1")
      .get();
    if (!count) {
      throw new BackupError(
        400,
        "Cette sauvegarde ne contient aucun administrateur.",
      );
    }
  } catch (error) {
    if (error instanceof BackupError) {
      throw error;
    }
    throw new BackupError(400, "Sauvegarde illisible ou corrompue.");
  } finally {
    backup?.close();
  }
};

/**
 * Prepares the replacement of the database by `sourceFile` (an uploaded
 * file or an existing backup), applied at the next start. The current
 * database is backed up first.
 */
export const stageRestore = (db, sourceFile) => {
  validateDatabaseFile(sourceFile);
  createBackup(db, "before-restore");
  fs.copyFileSync(sourceFile, path.join(config.dataDir, PENDING_RESTORE_FILE));
};

/** to call at startup, before opening the database */
export const applyPendingRestore = (dataDir) => {
  const pending = path.join(dataDir, PENDING_RESTORE_FILE);
  if (!fs.existsSync(pending)) {
    return false;
  }
  const database = path.join(dataDir, DATABASE_FILE);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(database + suffix, { force: true });
  }
  fs.renameSync(pending, database);
  return true;
};

/** automatic backups, if enabled */
export const scheduleBackups = (db) => {
  const intervalMs = config.backups.intervalHours * 3600e3;
  if (!intervalMs) {
    return;
  }
  const run = () => {
    try {
      const last = listBackups().find((backup) => backup.automatic);
      if (!last || Date.now() - last.createdAt >= intervalMs - 60e3) {
        createBackup(db);
      }
    } catch (error) {
      console.error("Automatic backup failed:", error);
    }
  };
  run();
  // checked hourly, so that restarts don't delay backups by a whole interval
  setInterval(run, Math.min(intervalMs, 3600e3)).unref();
};
