// Drawings storage, shared by the REST API (the editor) and the MCP server
// (AI assistants).
//
// Changes requested through MCP are stored as "pending operations" on the
// drawing: element skeletons or Mermaid definitions that the editor converts
// to proper Excalidraw elements (text measurement, arrow bindings, layout…)
// the next time it opens the drawing, then acknowledges when saving.

import crypto from "node:crypto";

import { snapshotDrawing } from "./versions.js";

export const MAX_NAME_LENGTH = 256;
export const MAX_ELEMENTS_PER_OPERATION = 1000;
const MAX_PENDING_OPS = 100;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const SKELETON_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "frame",
];

/** properties an assistant may change on existing elements */
export const UPDATABLE_PROPERTIES = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
];

export class DrawingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const sanitizeName = (name, fallback) => {
  if (typeof name !== "string") {
    return fallback;
  }
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
};

export const defaultDrawingName = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Untitled-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

export const toDrawingSummary = (row) => ({
  id: row.id,
  name: row.name,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // the requesting user's access: owner, edit or view
  role: row.role ?? "owner",
  ownerUsername: row.owner_username ?? undefined,
  folderId: row.folder_id ?? null,
  favorite: !!row.favorite,
  thumbnailUpdatedAt: row.thumbnail_at ?? null,
});

export const toDrawing = (row) => ({
  ...toDrawingSummary(row),
  elements: JSON.parse(row.elements),
  appState: JSON.parse(row.app_state),
  pendingOps: JSON.parse(row.pending_ops || "[]"),
});

// access
// -----------------------------------------------------------------------------

export const ROLES = ["view", "edit", "owner"];
const ROLE_RANK = { view: 1, edit: 2, owner: 3 };

export const assertId = (id) => {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new DrawingError(400, "Identifiant invalide.");
  }
};

/** the drawing's columns, plus the requesting user's role and context */
const ACCESSIBLE_DRAWINGS = `
  SELECT d.*, u.username AS owner_username,
    CASE WHEN d.owner_id = :user THEN 'owner' ELSE s.role END AS role,
    CASE WHEN d.owner_id = :user THEN d.folder_id ELSE NULL END AS folder_id,
    t.updated_at AS thumbnail_at,
    f.user_id IS NOT NULL AS favorite
  FROM drawings d
  JOIN users u ON u.id = d.owner_id
  LEFT JOIN drawing_shares s ON s.drawing_id = d.id AND s.user_id = :user
  LEFT JOIN drawing_thumbnails t ON t.drawing_id = d.id
  LEFT JOIN favorites f ON f.drawing_id = d.id AND f.user_id = :user
  WHERE d.deleted_at IS NULL AND (d.owner_id = :user OR s.user_id IS NOT NULL)`;

/**
 * Returns a drawing the user can access with (at least) the `required` role:
 * "view", "edit" or "owner". Drawings in the trash aren't accessible.
 */
export const getUserDrawing = (db, userId, drawingId, required = "owner") => {
  assertId(drawingId);
  const row = db
    .prepare(`${ACCESSIBLE_DRAWINGS} AND d.id = :id`)
    .get({ user: userId, id: drawingId });
  if (!row) {
    throw new DrawingError(404, "Dessin introuvable.");
  }
  if (ROLE_RANK[row.role] < ROLE_RANK[required]) {
    throw new DrawingError(
      403,
      required === "owner"
        ? "Seul le propriétaire du dessin peut faire cela."
        : "Ce dessin est partagé avec vous en lecture seule.",
    );
  }
  return row;
};

/** the user's drawings and the ones shared with them, most recent first */
export const listUserDrawings = (db, userId) =>
  db
    .prepare(`${ACCESSIBLE_DRAWINGS} ORDER BY d.updated_at DESC`)
    .all({ user: userId })
    .map(toDrawingSummary);

export const insertDrawing = (
  db,
  ownerId,
  { name, elements, appState, pendingOps, folderId },
) => {
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    name: sanitizeName(name, defaultDrawingName()),
    elements: JSON.stringify(Array.isArray(elements) ? elements : []),
    app_state: JSON.stringify(
      appState && typeof appState === "object" ? appState : {},
    ),
    pending_ops: JSON.stringify(pendingOps || []),
    folder_id: folderId ? getUserFolder(db, ownerId, folderId).id : null,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO drawings
       (id, owner_id, name, elements, app_state, pending_ops, folder_id, version, created_at, updated_at)
     VALUES
       (:id, :owner_id, :name, :elements, :app_state, :pending_ops, :folder_id, :version, :created_at, :updated_at)`,
  ).run(row);
  return row;
};

/** stores new elements/pending ops and bumps the version, so that open
 * editors pick the change up */
const writeDrawing = (db, row, { elements, pendingOps, name }) => {
  const updated = {
    id: row.id,
    name: name ?? row.name,
    elements: elements ? JSON.stringify(elements) : row.elements,
    pending_ops: pendingOps ? JSON.stringify(pendingOps) : row.pending_ops,
    version: row.version + 1,
    updated_at: Date.now(),
  };
  db.prepare(
    `UPDATE drawings SET name = :name, elements = :elements,
       pending_ops = :pending_ops, version = :version, updated_at = :updated_at
     WHERE id = :id`,
  ).run(updated);
  return { ...row, ...updated };
};

// skeletons
// -----------------------------------------------------------------------------

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Light validation of element skeletons (the editor does the actual
 * conversion). Returns the skeletons, or throws a DrawingError explaining
 * what's wrong so that the assistant can fix its call.
 */
export const validateSkeletons = (skeletons, existingIds) => {
  if (!Array.isArray(skeletons) || !skeletons.length) {
    throw new DrawingError(400, "`elements` must be a non-empty array.");
  }
  if (skeletons.length > MAX_ELEMENTS_PER_OPERATION) {
    throw new DrawingError(
      400,
      `At most ${MAX_ELEMENTS_PER_OPERATION} elements per call.`,
    );
  }
  const ids = new Set();
  skeletons.forEach((skeleton, index) => {
    const where = `elements[${index}]`;
    if (!skeleton || typeof skeleton !== "object") {
      throw new DrawingError(400, `${where} must be an object.`);
    }
    if (!SKELETON_TYPES.includes(skeleton.type)) {
      throw new DrawingError(
        400,
        `${where}.type must be one of ${SKELETON_TYPES.join(", ")}.`,
      );
    }
    if (skeleton.type !== "frame") {
      if (!isFiniteNumber(skeleton.x) || !isFiniteNumber(skeleton.y)) {
        throw new DrawingError(400, `${where} needs numeric x and y.`);
      }
    } else if (!Array.isArray(skeleton.children)) {
      throw new DrawingError(400, `${where}.children must be an array of ids.`);
    }
    if (skeleton.type === "text" && typeof skeleton.text !== "string") {
      throw new DrawingError(400, `${where}.text must be a string.`);
    }
    if (skeleton.id !== undefined) {
      if (typeof skeleton.id !== "string" || !ID_RE.test(skeleton.id)) {
        throw new DrawingError(
          400,
          `${where}.id must match ${ID_RE} (letters, digits, - and _).`,
        );
      }
      if (ids.has(skeleton.id) || existingIds.has(skeleton.id)) {
        throw new DrawingError(
          400,
          `${where}.id "${skeleton.id}" is already used in this drawing.`,
        );
      }
      ids.add(skeleton.id);
    }
  });
  return skeletons;
};

const getAllIds = (row) => {
  const ids = new Set(JSON.parse(row.elements).map((element) => element.id));
  for (const op of JSON.parse(row.pending_ops || "[]")) {
    for (const skeleton of op.elements || []) {
      if (skeleton.id) {
        ids.add(skeleton.id);
      }
    }
  }
  return ids;
};

const createOp = (data) => {
  if (data.mermaid !== undefined) {
    if (typeof data.mermaid !== "string" || !data.mermaid.trim()) {
      throw new DrawingError(400, "`mermaid` must be a non-empty string.");
    }
    return {
      id: crypto.randomUUID(),
      type: "mermaid",
      definition: data.mermaid,
      ...(isFiniteNumber(data.x) && isFiniteNumber(data.y)
        ? { x: data.x, y: data.y }
        : {}),
      createdAt: Date.now(),
    };
  }
  return {
    id: crypto.randomUUID(),
    type: "elements",
    elements: data.elements,
    createdAt: Date.now(),
  };
};

/** queues elements (skeletons) and/or a Mermaid diagram on a drawing */
export const addToDrawing = (db, row, { elements, mermaid, x, y }) => {
  if (!elements && mermaid === undefined) {
    throw new DrawingError(400, "Provide `elements` and/or `mermaid`.");
  }
  const pendingOps = JSON.parse(row.pending_ops || "[]");
  if (pendingOps.length >= MAX_PENDING_OPS) {
    throw new DrawingError(
      409,
      "Too many pending changes: open the drawing in the editor first.",
    );
  }
  const ops = [];
  if (elements) {
    ops.push(
      createOp({ elements: validateSkeletons(elements, getAllIds(row)) }),
    );
  }
  if (mermaid !== undefined) {
    ops.push(createOp({ mermaid, x, y }));
  }
  return writeDrawing(db, row, { pendingOps: [...pendingOps, ...ops] });
};

export const createDrawingWithContent = (
  db,
  userId,
  { name, elements, mermaid },
) => {
  const ops = [];
  if (elements) {
    ops.push(createOp({ elements: validateSkeletons(elements, new Set()) }));
  }
  if (mermaid !== undefined) {
    ops.push(createOp({ mermaid }));
  }
  return insertDrawing(db, userId, { name, pendingOps: ops });
};

// changes to existing elements
// -----------------------------------------------------------------------------

const bumpElement = (element, changes) => ({
  ...element,
  ...changes,
  version: (element.version || 1) + 1,
  versionNonce: crypto.randomInt(2 ** 31),
  updated: Date.now(),
});

export const removeElements = (db, row, ids, userId = null) => {
  if (!Array.isArray(ids) || !ids.length) {
    throw new DrawingError(400, "`element_ids` must be a non-empty array.");
  }
  snapshotDrawing(db, row, { reason: "api", userId, force: true });
  const toRemove = new Set(ids);
  let removed = 0;
  const elements = JSON.parse(row.elements).map((element) => {
    if (
      !element.isDeleted &&
      (toRemove.has(element.id) || toRemove.has(element.containerId))
    ) {
      removed++;
      return bumpElement(element, { isDeleted: true });
    }
    return element;
  });
  // elements not converted yet
  const pendingOps = JSON.parse(row.pending_ops || "[]")
    .map((op) => {
      if (op.type !== "elements") {
        return op;
      }
      const kept = op.elements.filter((skeleton) => !toRemove.has(skeleton.id));
      removed += op.elements.length - kept.length;
      return { ...op, elements: kept };
    })
    .filter((op) => op.type !== "elements" || op.elements.length);

  if (!removed) {
    throw new DrawingError(404, "None of these elements exist.");
  }
  return { row: writeDrawing(db, row, { elements, pendingOps }), removed };
};

export const updateElements = (db, row, updates, userId = null) => {
  if (!Array.isArray(updates) || !updates.length) {
    throw new DrawingError(400, "`updates` must be a non-empty array.");
  }
  snapshotDrawing(db, row, { reason: "api", userId, force: true });
  const byId = new Map();
  for (const update of updates) {
    if (!update || typeof update.id !== "string") {
      throw new DrawingError(400, "Each update needs an element `id`.");
    }
    const changes = {};
    for (const key of UPDATABLE_PROPERTIES) {
      if (update[key] !== undefined) {
        changes[key] = update[key];
      }
    }
    byId.set(update.id, changes);
  }

  const elements = JSON.parse(row.elements);
  const found = new Set();
  // moving a shape also moves its label
  const containerMoves = new Map();
  let next = elements.map((element) => {
    const changes = byId.get(element.id);
    if (!changes || element.isDeleted) {
      return element;
    }
    found.add(element.id);
    const dx = isFiniteNumber(changes.x) ? changes.x - element.x : 0;
    const dy = isFiniteNumber(changes.y) ? changes.y - element.y : 0;
    if (dx || dy) {
      containerMoves.set(element.id, { dx, dy });
    }
    return bumpElement(element, changes);
  });
  next = next.map((element) => {
    const move = element.containerId && containerMoves.get(element.containerId);
    if (!move || byId.has(element.id)) {
      return element;
    }
    return bumpElement(element, {
      x: element.x + move.dx,
      y: element.y + move.dy,
    });
  });

  const missing = [...byId.keys()].filter((id) => !found.has(id));
  if (missing.length === byId.size) {
    throw new DrawingError(404, "None of these elements exist.");
  }
  return {
    row: writeDrawing(db, row, { elements: next }),
    updated: found.size,
    missing,
  };
};

export const renameDrawing = (db, row, name) =>
  writeDrawing(db, row, { name: sanitizeName(name, row.name) });

// description for assistants
// -----------------------------------------------------------------------------

const round = (value) =>
  typeof value === "number" ? Math.round(value * 10) / 10 : value;

/** compact, assistant-friendly description of a drawing's content */
export const describeDrawing = (row) => {
  const elements = JSON.parse(row.elements).filter(
    (element) => !element.isDeleted,
  );
  const labels = new Map();
  for (const element of elements) {
    if (element.type === "text" && element.containerId) {
      labels.set(element.containerId, element.text);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const described = [];
  for (const element of elements) {
    if (element.type === "text" && element.containerId) {
      continue; // reported as the container's label
    }
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + Math.abs(element.width || 0));
    maxY = Math.max(maxY, element.y + Math.abs(element.height || 0));
    const item = {
      id: element.id,
      type: element.type,
      x: round(element.x),
      y: round(element.y),
      width: round(element.width),
      height: round(element.height),
    };
    if (element.type === "text") {
      item.text = element.text;
    }
    if (labels.has(element.id)) {
      item.label = labels.get(element.id);
    }
    if (element.type === "frame" && element.name) {
      item.name = element.name;
    }
    if (element.strokeColor && element.strokeColor !== "#1e1e1e") {
      item.strokeColor = element.strokeColor;
    }
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      item.backgroundColor = element.backgroundColor;
    }
    if (element.type === "arrow" || element.type === "line") {
      item.points = element.points?.map(([px, py]) => [round(px), round(py)]);
      if (element.startBinding?.elementId) {
        item.start = element.startBinding.elementId;
      }
      if (element.endBinding?.elementId) {
        item.end = element.endBinding.elementId;
      }
    }
    if (element.frameId) {
      item.frameId = element.frameId;
    }
    if (element.type === "image") {
      item.note = "image";
    }
    described.push(item);
  }

  const pendingOps = JSON.parse(row.pending_ops || "[]");
  return {
    ...toDrawingSummary(row),
    bounds: described.length
      ? {
          x: round(minX),
          y: round(minY),
          width: round(maxX - minX),
          height: round(maxY - minY),
        }
      : null,
    elements: described,
    // queued changes, applied when the drawing is next opened in the editor
    pending: pendingOps.map((op) =>
      op.type === "mermaid"
        ? { type: "mermaid", definition: op.definition }
        : { type: "elements", elements: op.elements },
    ),
  };
};

// sharing with other users of the instance
// -----------------------------------------------------------------------------

export const SHARE_ROLES = ["view", "edit"];

export const listShares = (db, drawingId) =>
  db
    .prepare(
      `SELECT s.user_id, u.username, s.role, s.created_at FROM drawing_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.drawing_id = ? ORDER BY u.username`,
    )
    .all(drawingId)
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
    }));

export const shareDrawing = (db, row, { username, role }) => {
  if (!SHARE_ROLES.includes(role)) {
    throw new DrawingError(400, "Droit d'accès invalide.");
  }
  const user =
    typeof username === "string" &&
    db
      .prepare("SELECT id FROM users WHERE username = ? AND status = 'active'")
      .get(username.trim());
  if (!user) {
    throw new DrawingError(404, `Utilisateur « ${username} » introuvable.`);
  }
  if (user.id === row.owner_id) {
    throw new DrawingError(400, "C'est le propriétaire du dessin.");
  }
  db.prepare(
    `INSERT INTO drawing_shares (drawing_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (drawing_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(row.id, user.id, role, Date.now());
  return listShares(db, row.id);
};

export const unshareDrawing = (db, drawingId, userId) =>
  db
    .prepare("DELETE FROM drawing_shares WHERE drawing_id = ? AND user_id = ?")
    .run(drawingId, userId).changes > 0;

// folders & favorites
// -----------------------------------------------------------------------------

export const getUserFolder = (db, ownerId, folderId) => {
  assertId(folderId);
  const folder = db
    .prepare("SELECT * FROM folders WHERE id = ? AND owner_id = ?")
    .get(folderId, ownerId);
  if (!folder) {
    throw new DrawingError(404, "Dossier introuvable.");
  }
  return folder;
};

export const listFolders = (db, ownerId) =>
  db
    .prepare(
      `SELECT f.id, f.name, f.created_at,
         (SELECT COUNT(*) FROM drawings d
          WHERE d.folder_id = f.id AND d.deleted_at IS NULL) AS drawing_count
       FROM folders f WHERE f.owner_id = ? ORDER BY f.name COLLATE NOCASE`,
    )
    .all(ownerId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      drawingCount: row.drawing_count,
    }));

export const createFolder = (db, ownerId, name) => {
  const folder = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    name: sanitizeName(name, ""),
    created_at: Date.now(),
  };
  if (!folder.name) {
    throw new DrawingError(400, "Nom de dossier manquant.");
  }
  db.prepare(
    "INSERT INTO folders (id, owner_id, name, created_at) VALUES (:id, :owner_id, :name, :created_at)",
  ).run(folder);
  return { id: folder.id, name: folder.name, createdAt: folder.created_at };
};

export const renameFolder = (db, ownerId, folderId, name) => {
  const folder = getUserFolder(db, ownerId, folderId);
  const newName = sanitizeName(name, folder.name);
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(
    newName,
    folder.id,
  );
  return { id: folder.id, name: newName, createdAt: folder.created_at };
};

/** the folder's drawings are moved back to the root */
export const deleteFolder = (db, ownerId, folderId) => {
  const folder = getUserFolder(db, ownerId, folderId);
  db.prepare("UPDATE drawings SET folder_id = NULL WHERE folder_id = ?").run(
    folder.id,
  );
  db.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
};

export const moveDrawing = (db, row, folderId) => {
  const folder = folderId ? getUserFolder(db, row.owner_id, folderId) : null;
  db.prepare("UPDATE drawings SET folder_id = ? WHERE id = ?").run(
    folder?.id ?? null,
    row.id,
  );
};

export const setFavorite = (db, userId, drawingId, favorite) => {
  if (favorite) {
    db.prepare(
      "INSERT OR IGNORE INTO favorites (user_id, drawing_id) VALUES (?, ?)",
    ).run(userId, drawingId);
  } else {
    db.prepare(
      "DELETE FROM favorites WHERE user_id = ? AND drawing_id = ?",
    ).run(userId, drawingId);
  }
};

// trash
// -----------------------------------------------------------------------------

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const trashDrawing = (db, row) => {
  db.prepare("UPDATE drawings SET deleted_at = ? WHERE id = ?").run(
    Date.now(),
    row.id,
  );
};

const getTrashedDrawing = (db, ownerId, drawingId) => {
  assertId(drawingId);
  const row = db
    .prepare(
      "SELECT * FROM drawings WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL",
    )
    .get(drawingId, ownerId);
  if (!row) {
    throw new DrawingError(404, "Dessin introuvable dans la corbeille.");
  }
  return row;
};

export const listTrash = (db, ownerId) =>
  db
    .prepare(
      `SELECT d.id, d.name, d.version, d.created_at, d.updated_at, d.deleted_at,
         t.updated_at AS thumbnail_at
       FROM drawings d
       LEFT JOIN drawing_thumbnails t ON t.drawing_id = d.id
       WHERE d.owner_id = ? AND d.deleted_at IS NOT NULL
       ORDER BY d.deleted_at DESC`,
    )
    .all(ownerId)
    .map((row) => ({
      ...toDrawingSummary(row),
      deletedAt: row.deleted_at,
      purgeAt: row.deleted_at + TRASH_RETENTION_MS,
    }));

export const restoreFromTrash = (db, ownerId, drawingId) => {
  const row = getTrashedDrawing(db, ownerId, drawingId);
  db.prepare("UPDATE drawings SET deleted_at = NULL WHERE id = ?").run(row.id);
};

export const deleteForever = (db, ownerId, drawingId) => {
  const row = getTrashedDrawing(db, ownerId, drawingId);
  db.prepare("DELETE FROM drawings WHERE id = ?").run(row.id);
};

export const emptyTrash = (db, ownerId) =>
  db
    .prepare(
      "DELETE FROM drawings WHERE owner_id = ? AND deleted_at IS NOT NULL",
    )
    .run(ownerId).changes;

/** deletes drawings that have been in the trash for too long */
export const purgeTrash = (db) =>
  db
    .prepare("DELETE FROM drawings WHERE deleted_at < ?")
    .run(Date.now() - TRASH_RETENTION_MS).changes;

// thumbnails
// -----------------------------------------------------------------------------

const THUMBNAIL_TYPES = ["image/png", "image/webp", "image/jpeg"];
const MAX_THUMBNAIL_BYTES = 512 * 1024;

export const setThumbnail = (db, drawingId, mimeType, data) => {
  if (!THUMBNAIL_TYPES.includes(mimeType)) {
    throw new DrawingError(400, "Format d'aperçu non supporté.");
  }
  if (!data?.length || data.length > MAX_THUMBNAIL_BYTES) {
    throw new DrawingError(413, "Aperçu trop volumineux.");
  }
  db.prepare(
    `INSERT INTO drawing_thumbnails (drawing_id, mime_type, data, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (drawing_id) DO UPDATE SET mime_type = excluded.mime_type,
       data = excluded.data, updated_at = excluded.updated_at`,
  ).run(drawingId, mimeType, data, Date.now());
};

export const getThumbnail = (db, drawingId) =>
  db
    .prepare("SELECT * FROM drawing_thumbnails WHERE drawing_id = ?")
    .get(drawingId);

// image files
// -----------------------------------------------------------------------------

/**
 * Image files are stored per user. In a shared drawing, images may have been
 * added by any of its users: look them up among those too.
 */
export const findFile = (db, userId, fileId, drawingId) => {
  const own = db
    .prepare("SELECT * FROM files WHERE owner_id = ? AND id = ?")
    .get(userId, fileId);
  if (own || !drawingId) {
    return own;
  }
  const drawing = getUserDrawing(db, userId, drawingId, "view");
  return db
    .prepare(
      `SELECT * FROM files WHERE id = ? AND owner_id IN (
         SELECT ? UNION SELECT user_id FROM drawing_shares WHERE drawing_id = ?)
       LIMIT 1`,
    )
    .get(fileId, drawing.owner_id, drawing.id);
};
