// Drawings storage, shared by the REST API (the editor) and the MCP server
// (AI assistants).
//
// Changes requested through MCP are stored as "pending operations" on the
// drawing: element skeletons or Mermaid definitions that the editor converts
// to proper Excalidraw elements (text measurement, arrow bindings, layout…)
// the next time it opens the drawing, then acknowledges when saving.

import crypto from "node:crypto";

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
});

export const toDrawing = (row) => ({
  ...toDrawingSummary(row),
  elements: JSON.parse(row.elements),
  appState: JSON.parse(row.app_state),
  pendingOps: JSON.parse(row.pending_ops || "[]"),
});

export const getUserDrawing = (db, userId, drawingId) => {
  if (typeof drawingId !== "string" || !ID_RE.test(drawingId)) {
    throw new DrawingError(400, "Identifiant invalide.");
  }
  const row = db
    .prepare("SELECT * FROM drawings WHERE id = ? AND owner_id = ?")
    .get(drawingId, userId);
  if (!row) {
    throw new DrawingError(404, "Dessin introuvable.");
  }
  return row;
};

export const listUserDrawings = (db, userId) =>
  db
    .prepare(
      `SELECT id, name, version, created_at, updated_at FROM drawings
       WHERE owner_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId)
    .map(toDrawingSummary);

export const insertDrawing = (
  db,
  ownerId,
  { name, elements, appState, pendingOps },
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
    version: 1,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO drawings
       (id, owner_id, name, elements, app_state, pending_ops, version, created_at, updated_at)
     VALUES
       (:id, :owner_id, :name, :elements, :app_state, :pending_ops, :version, :created_at, :updated_at)`,
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

export const removeElements = (db, row, ids) => {
  if (!Array.isArray(ids) || !ids.length) {
    throw new DrawingError(400, "`element_ids` must be a non-empty array.");
  }
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

export const updateElements = (db, row, updates) => {
  if (!Array.isArray(updates) || !updates.length) {
    throw new DrawingError(400, "`updates` must be a non-empty array.");
  }
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
