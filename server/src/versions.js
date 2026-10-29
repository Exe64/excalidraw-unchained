// Version history: snapshots of drawings, taken periodically while they're
// edited and before risky changes (restoring a version, edits through the
// API), so that any of them can be restored.

import crypto from "node:crypto";

import { DrawingError } from "./drawings.js";

/** at most one automatic snapshot per drawing in this interval */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
/** older snapshots beyond this count are deleted */
export const MAX_VERSIONS_PER_DRAWING = 100;

/**
 * Stores the current state of `row` (before it gets overwritten).
 * Automatic snapshots (`force` false) are throttled.
 */
export const snapshotDrawing = (
  db,
  row,
  { reason = "auto", userId = null, force = false } = {},
) => {
  if (row.elements === "[]") {
    return; // nothing worth keeping
  }
  const last = db
    .prepare(
      `SELECT elements, created_at FROM drawing_versions
       WHERE drawing_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(row.id);
  if (last) {
    if (last.elements === row.elements) {
      return; // unchanged since the last snapshot
    }
    if (!force && Date.now() - last.created_at < SNAPSHOT_INTERVAL_MS) {
      return;
    }
  }
  db.prepare(
    `INSERT INTO drawing_versions
       (id, drawing_id, name, elements, app_state, reason, created_by, state_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    row.id,
    row.name,
    row.elements,
    row.app_state,
    reason,
    userId,
    row.updated_at,
    Date.now(),
  );
  db.prepare(
    `DELETE FROM drawing_versions WHERE drawing_id = ? AND id NOT IN (
       SELECT id FROM drawing_versions WHERE drawing_id = ?
       ORDER BY created_at DESC LIMIT ?)`,
  ).run(row.id, row.id, MAX_VERSIONS_PER_DRAWING);
};

export const listVersions = (db, drawingId) =>
  db
    .prepare(
      `SELECT v.id, v.name, v.reason, v.state_at, v.created_at, u.username,
         (SELECT COUNT(*) FROM json_each(v.elements)
          WHERE json_extract(value, '$.isDeleted') IS NOT 1) AS element_count
       FROM drawing_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.drawing_id = ? ORDER BY v.created_at DESC`,
    )
    .all(drawingId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      reason: row.reason,
      stateAt: row.state_at,
      createdAt: row.created_at,
      username: row.username ?? null,
      elementCount: row.element_count,
    }));

const getVersionRow = (db, drawingId, versionId) => {
  const version = db
    .prepare("SELECT * FROM drawing_versions WHERE id = ? AND drawing_id = ?")
    .get(versionId, drawingId);
  if (!version) {
    throw new DrawingError(404, "Version introuvable.");
  }
  return version;
};

export const getVersion = (db, drawingId, versionId) => {
  const version = getVersionRow(db, drawingId, versionId);
  return {
    id: version.id,
    name: version.name,
    stateAt: version.state_at,
    elements: JSON.parse(version.elements),
    appState: JSON.parse(version.app_state),
  };
};

/**
 * Restores the content of a version. The current state is kept as a
 * version first. Restored elements get higher versions than the current
 * ones, so that editors with the drawing open (which merge changes element
 * by element) take the restored state.
 */
export const restoreVersion = (db, row, versionId, userId) => {
  const version = getVersionRow(db, row.id, versionId);
  snapshotDrawing(db, row, { reason: "before-restore", userId, force: true });

  const now = Date.now();
  const bump = (element, previousVersion) => ({
    ...element,
    version: Math.max(element.version || 1, previousVersion || 0) + 1,
    versionNonce: crypto.randomInt(2 ** 31),
    updated: now,
  });
  const current = JSON.parse(row.elements);
  const currentVersions = new Map(
    current.map((element) => [element.id, element.version]),
  );
  const restored = JSON.parse(version.elements).map((element) =>
    bump(element, currentVersions.get(element.id)),
  );
  const restoredIds = new Set(restored.map((element) => element.id));
  // elements added since then are deleted
  for (const element of current) {
    if (!restoredIds.has(element.id) && !element.isDeleted) {
      restored.push(bump({ ...element, isDeleted: true }, element.version));
    }
  }

  const updated = {
    id: row.id,
    elements: JSON.stringify(restored),
    version: row.version + 1,
    updated_at: now,
  };
  db.prepare(
    `UPDATE drawings SET elements = :elements, version = :version,
       updated_at = :updated_at WHERE id = :id`,
  ).run(updated);
  return { ...row, ...updated };
};
