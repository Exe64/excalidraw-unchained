// REST API of drawings: content, previews, version history, sharing,
// folders, favorites, trash, and their image files.

import express from "express";

import { transaction } from "./db.js";
import {
  assertId,
  createFolder,
  deleteFolder,
  deleteForever,
  emptyTrash,
  findFile,
  getThumbnail,
  getUserDrawing,
  insertDrawing,
  listFolders,
  listShares,
  listTrash,
  listUserDrawings,
  moveDrawing,
  renameFolder,
  restoreFromTrash,
  sanitizeName,
  setFavorite,
  setThumbnail,
  shareDrawing,
  toDrawing,
  toDrawingSummary,
  trashDrawing,
  unshareDrawing,
} from "./drawings.js";
import {
  getVersion,
  listVersions,
  restoreVersion,
  snapshotDrawing,
} from "./versions.js";

export const registerDrawingRoutes = (api, { db, HttpError }) => {
  /** the drawing of the route, with at least the `required` access */
  const drawingOf = (req, required) =>
    getUserDrawing(db, req.user.id, req.params.id, required);

  /** re-reads a drawing, with the requesting user's context */
  const reload = (req, id) => getUserDrawing(db, req.user.id, id, "view");

  // drawings
  // ---------------------------------------------------------------------------

  api.get("/drawings", (req, res) => {
    res.json({ drawings: listUserDrawings(db, req.user.id) });
  });

  api.post("/drawings", (req, res) => {
    const { name, elements, appState, folderId } = req.body || {};
    const row = insertDrawing(db, req.user.id, {
      name,
      elements,
      appState,
      folderId,
    });
    res.status(201).json({ drawing: toDrawing(reload(req, row.id)) });
  });

  api.get("/drawings/:id", (req, res) => {
    res.json({ drawing: toDrawing(drawingOf(req, "view")) });
  });

  /** cheap check used to detect changes made elsewhere */
  api.get("/drawings/:id/version", (req, res) => {
    const row = drawingOf(req, "view");
    res.json({ version: row.version, updatedAt: row.updated_at });
  });

  api.put("/drawings/:id", (req, res) => {
    const { name, elements, appState, baseVersion, appliedOps } =
      req.body || {};
    if (!Array.isArray(elements)) {
      throw new HttpError(400, "Contenu du dessin invalide.");
    }
    const result = transaction(db, () => {
      const row = drawingOf(req, "edit");
      if (typeof baseVersion === "number" && baseVersion !== row.version) {
        throw new HttpError(409, "Le dessin a été modifié ailleurs.", {
          version: row.version,
        });
      }
      // keep the previous state in the version history (throttled)
      snapshotDrawing(db, row, { userId: req.user.id });
      // pending operations the editor converted into these elements
      const applied = new Set(Array.isArray(appliedOps) ? appliedOps : []);
      const pendingOps = JSON.parse(row.pending_ops || "[]").filter(
        (op) => !applied.has(op.id),
      );
      const updated = {
        id: row.id,
        // only the owner renames
        name: row.role === "owner" ? sanitizeName(name, row.name) : row.name,
        elements: JSON.stringify(elements),
        app_state: JSON.stringify(
          appState && typeof appState === "object" ? appState : {},
        ),
        pending_ops: JSON.stringify(pendingOps),
        version: row.version + 1,
        updated_at: Date.now(),
      };
      db.prepare(
        `UPDATE drawings SET name = :name, elements = :elements,
           app_state = :app_state, pending_ops = :pending_ops,
           version = :version, updated_at = :updated_at
         WHERE id = :id`,
      ).run(updated);
      return updated;
    });
    res.json({
      version: result.version,
      updatedAt: result.updated_at,
      name: result.name,
    });
  });

  api.patch("/drawings/:id", (req, res) => {
    const row = drawingOf(req, "owner");
    const { name, folderId } = req.body || {};
    if (name !== undefined) {
      db.prepare("UPDATE drawings SET name = ? WHERE id = ?").run(
        sanitizeName(name, row.name),
        row.id,
      );
    }
    if (folderId !== undefined) {
      moveDrawing(db, row, folderId);
    }
    res.json({ drawing: toDrawingSummary(reload(req, row.id)) });
  });

  api.post("/drawings/:id/duplicate", (req, res) => {
    const row = drawingOf(req, "view");
    const copy = insertDrawing(db, req.user.id, {
      name: sanitizeName(req.body?.name, `${row.name} (copie)`),
      elements: JSON.parse(row.elements),
      appState: JSON.parse(row.app_state),
      pendingOps: JSON.parse(row.pending_ops || "[]"),
      folderId: row.role === "owner" ? row.folder_id : null,
    });
    res.status(201).json({ drawing: toDrawingSummary(reload(req, copy.id)) });
  });

  /** the owner moves the drawing to the trash; others stop seeing it */
  api.delete("/drawings/:id", (req, res) => {
    const row = drawingOf(req, "view");
    if (row.role === "owner") {
      trashDrawing(db, row);
    } else {
      unshareDrawing(db, row.id, req.user.id);
    }
    res.json({ ok: true });
  });

  api.put("/drawings/:id/favorite", (req, res) => {
    const row = drawingOf(req, "view");
    setFavorite(db, req.user.id, row.id, !!req.body?.favorite);
    res.json({ ok: true });
  });

  // previews
  // ---------------------------------------------------------------------------

  api.put(
    "/drawings/:id/thumbnail",
    express.raw({
      type: ["image/png", "image/webp", "image/jpeg"],
      limit: "1mb",
    }),
    (req, res) => {
      const row = drawingOf(req, "edit");
      setThumbnail(db, row.id, req.get("Content-Type"), req.body);
      res.json({ ok: true });
    },
  );

  api.get("/drawings/:id/thumbnail", (req, res) => {
    const row = drawingOf(req, "view");
    const thumbnail = getThumbnail(db, row.id);
    if (!thumbnail) {
      throw new HttpError(404, "Pas d'aperçu.");
    }
    // the URL carries the update time (?v=…)
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type(thumbnail.mime_type).send(Buffer.from(thumbnail.data));
  });

  // version history
  // ---------------------------------------------------------------------------

  api.get("/drawings/:id/versions", (req, res) => {
    const row = drawingOf(req, "view");
    res.json({ versions: listVersions(db, row.id) });
  });

  api.get("/drawings/:id/versions/:versionId", (req, res) => {
    const row = drawingOf(req, "view");
    assertId(req.params.versionId);
    res.json({ version: getVersion(db, row.id, req.params.versionId) });
  });

  /** keeps the current state as a version, on demand */
  api.post("/drawings/:id/versions", (req, res) => {
    const row = drawingOf(req, "edit");
    snapshotDrawing(db, row, {
      reason: "manual",
      userId: req.user.id,
      force: true,
    });
    res.status(201).json({ versions: listVersions(db, row.id) });
  });

  api.post("/drawings/:id/versions/:versionId/restore", (req, res) => {
    assertId(req.params.versionId);
    const updated = transaction(db, () =>
      restoreVersion(
        db,
        drawingOf(req, "edit"),
        req.params.versionId,
        req.user.id,
      ),
    );
    res.json({ drawing: toDrawing(reload(req, updated.id)) });
  });

  // sharing
  // ---------------------------------------------------------------------------

  api.get("/drawings/:id/shares", (req, res) => {
    const row = drawingOf(req, "owner");
    res.json({ shares: listShares(db, row.id) });
  });

  api.put("/drawings/:id/shares", (req, res) => {
    const row = drawingOf(req, "owner");
    const { username, role } = req.body || {};
    res.json({ shares: shareDrawing(db, row, { username, role }) });
  });

  api.delete("/drawings/:id/shares/:userId", (req, res) => {
    const row = drawingOf(req, "view");
    // the owner removes anyone, the others only themselves
    if (row.role !== "owner" && req.params.userId !== req.user.id) {
      throw new HttpError(
        403,
        "Seul le propriétaire du dessin peut faire cela.",
      );
    }
    unshareDrawing(db, row.id, req.params.userId);
    res.json({
      shares: row.role === "owner" ? listShares(db, row.id) : [],
    });
  });

  // folders
  // ---------------------------------------------------------------------------

  api.get("/folders", (req, res) => {
    res.json({ folders: listFolders(db, req.user.id) });
  });

  api.post("/folders", (req, res) => {
    res
      .status(201)
      .json({ folder: createFolder(db, req.user.id, req.body?.name) });
  });

  api.patch("/folders/:id", (req, res) => {
    res.json({
      folder: renameFolder(db, req.user.id, req.params.id, req.body?.name),
    });
  });

  api.delete("/folders/:id", (req, res) => {
    deleteFolder(db, req.user.id, req.params.id);
    res.json({ ok: true });
  });

  // trash
  // ---------------------------------------------------------------------------

  api.get("/trash", (req, res) => {
    res.json({ drawings: listTrash(db, req.user.id) });
  });

  api.post("/trash/:id/restore", (req, res) => {
    restoreFromTrash(db, req.user.id, req.params.id);
    res.json({ drawing: toDrawingSummary(reload(req, req.params.id)) });
  });

  api.delete("/trash/:id", (req, res) => {
    deleteForever(db, req.user.id, req.params.id);
    res.json({ ok: true });
  });

  api.delete("/trash", (req, res) => {
    res.json({ deleted: emptyTrash(db, req.user.id) });
  });

  // image files
  // ---------------------------------------------------------------------------

  /** `?drawing=<id>` also finds images added by the users of a shared drawing */
  api.get("/files/:id", (req, res) => {
    assertId(req.params.id);
    const drawingId =
      typeof req.query.drawing === "string" ? req.query.drawing : null;
    const row = findFile(db, req.user.id, req.params.id, drawingId);
    if (!row) {
      throw new HttpError(404, "Fichier introuvable.");
    }
    res.json({
      id: row.id,
      mimeType: row.mime_type,
      dataURL: row.data_url,
      created: row.created_at,
    });
  });

  api.put("/files/:id", (req, res) => {
    assertId(req.params.id);
    const { mimeType, dataURL, created } = req.body || {};
    if (
      typeof mimeType !== "string" ||
      typeof dataURL !== "string" ||
      !dataURL.startsWith("data:")
    ) {
      throw new HttpError(400, "Fichier invalide.");
    }
    db.prepare(
      `INSERT INTO files (owner_id, id, mime_type, data_url, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (owner_id, id) DO UPDATE SET
         mime_type = excluded.mime_type, data_url = excluded.data_url`,
    ).run(
      req.user.id,
      req.params.id,
      mimeType,
      dataURL,
      typeof created === "number" ? created : Date.now(),
    );
    res.json({ ok: true });
  });
};
