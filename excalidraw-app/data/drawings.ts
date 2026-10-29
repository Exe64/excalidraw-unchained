import { getDateTime } from "@excalidraw/common";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { API_BASE, apiRequest } from "./api";

import type { PendingOp } from "./pendingOps";

export type DrawingRole = "owner" | "edit" | "view";

export type DrawingSummary = {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** the current user's access to the drawing */
  role?: DrawingRole;
  /** for drawings shared with the current user */
  ownerUsername?: string;
  folderId?: string | null;
  favorite?: boolean;
  thumbnailUpdatedAt?: number | null;
};

export type TrashedDrawing = DrawingSummary & {
  deletedAt: number;
  purgeAt: number;
};

export type Folder = {
  id: string;
  name: string;
  createdAt: number;
  drawingCount?: number;
};

export type Share = {
  userId: string;
  username: string;
  role: "view" | "edit";
  createdAt: number;
};

export type DrawingVersion = {
  id: string;
  name: string;
  reason: "auto" | "manual" | "before-restore" | "api";
  stateAt: number;
  createdAt: number;
  username: string | null;
  elementCount: number;
};

export type DrawingVersionContent = {
  id: string;
  name: string;
  stateAt: number;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
};

export type Drawing = DrawingSummary & {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  /** changes requested through the API (e.g. by an AI assistant) */
  pendingOps?: PendingOp[];
};

const path = (id: string) => `/drawings/${encodeURIComponent(id)}`;

export const DrawingsAPI = {
  list: async () =>
    (await apiRequest<{ drawings: DrawingSummary[] }>("GET", "/drawings"))
      .drawings,

  get: async (id: string) =>
    (await apiRequest<{ drawing: Drawing }>("GET", path(id))).drawing,

  getVersion: (id: string) =>
    apiRequest<{ version: number; updatedAt: number }>(
      "GET",
      `${path(id)}/version`,
    ),

  create: async (
    data: {
      folderId?: string | null;
      name?: string;
      elements?: readonly ExcalidrawElement[];
      appState?: Partial<AppState>;
    } = {},
  ) =>
    (
      await apiRequest<{ drawing: Drawing }>("POST", "/drawings", {
        json: {
          ...data,
          // same default name as the editor's
          name: data.name || `${t("labels.untitled")}-${getDateTime()}`,
        },
      })
    ).drawing,

  save: (
    id: string,
    data: {
      name: string;
      elements: readonly ExcalidrawElement[];
      appState: Partial<AppState>;
      baseVersion: number;
      /** pending operations included in `elements` */
      appliedOps?: string[];
    },
    opts?: { keepalive?: boolean },
  ) =>
    apiRequest<{ version: number; updatedAt: number; name: string }>(
      "PUT",
      path(id),
      { json: data, keepalive: opts?.keepalive },
    ),

  rename: async (id: string, name: string) =>
    (
      await apiRequest<{ drawing: DrawingSummary }>("PATCH", path(id), {
        json: { name },
      })
    ).drawing,

  duplicate: async (id: string) =>
    (
      await apiRequest<{ drawing: DrawingSummary }>(
        "POST",
        `${path(id)}/duplicate`,
      )
    ).drawing,

  /** the owner moves it to the trash, others remove it from their list */
  remove: (id: string) => apiRequest("DELETE", path(id)),

  move: async (id: string, folderId: string | null) =>
    (
      await apiRequest<{ drawing: DrawingSummary }>("PATCH", path(id), {
        json: { folderId },
      })
    ).drawing,

  setFavorite: (id: string, favorite: boolean) =>
    apiRequest("PUT", `${path(id)}/favorite`, { json: { favorite } }),

  thumbnailUrl: (drawing: DrawingSummary) =>
    drawing.thumbnailUpdatedAt
      ? `${API_BASE}${path(drawing.id)}/thumbnail?v=${
          drawing.thumbnailUpdatedAt
        }`
      : null,

  saveThumbnail: (id: string, blob: Blob) =>
    apiRequest("PUT", `${path(id)}/thumbnail`, {
      body: blob,
      contentType: blob.type,
    }),

  // sharing
  shares: async (id: string) =>
    (await apiRequest<{ shares: Share[] }>("GET", `${path(id)}/shares`)).shares,
  share: async (id: string, username: string, role: Share["role"]) =>
    (
      await apiRequest<{ shares: Share[] }>("PUT", `${path(id)}/shares`, {
        json: { username, role },
      })
    ).shares,
  unshare: async (id: string, userId: string) =>
    (
      await apiRequest<{ shares: Share[] }>(
        "DELETE",
        `${path(id)}/shares/${encodeURIComponent(userId)}`,
      )
    ).shares,

  // version history
  versions: async (id: string) =>
    (
      await apiRequest<{ versions: DrawingVersion[] }>(
        "GET",
        `${path(id)}/versions`,
      )
    ).versions,
  version: async (id: string, versionId: string) =>
    (
      await apiRequest<{ version: DrawingVersionContent }>(
        "GET",
        `${path(id)}/versions/${encodeURIComponent(versionId)}`,
      )
    ).version,
  saveVersion: async (id: string) =>
    (
      await apiRequest<{ versions: DrawingVersion[] }>(
        "POST",
        `${path(id)}/versions`,
        { json: {} },
      )
    ).versions,
  restoreVersion: async (id: string, versionId: string) =>
    (
      await apiRequest<{ drawing: Drawing }>(
        "POST",
        `${path(id)}/versions/${encodeURIComponent(versionId)}/restore`,
        { json: {} },
      )
    ).drawing,
};

export const FoldersAPI = {
  list: async () =>
    (await apiRequest<{ folders: Folder[] }>("GET", "/folders")).folders,
  create: async (name: string) =>
    (
      await apiRequest<{ folder: Folder }>("POST", "/folders", {
        json: { name },
      })
    ).folder,
  rename: async (id: string, name: string) =>
    (
      await apiRequest<{ folder: Folder }>(
        "PATCH",
        `/folders/${encodeURIComponent(id)}`,
        { json: { name } },
      )
    ).folder,
  remove: (id: string) =>
    apiRequest("DELETE", `/folders/${encodeURIComponent(id)}`),
};

export const TrashAPI = {
  list: async () =>
    (await apiRequest<{ drawings: TrashedDrawing[] }>("GET", "/trash"))
      .drawings,
  restore: (id: string) =>
    apiRequest("POST", `/trash/${encodeURIComponent(id)}/restore`, {
      json: {},
    }),
  deleteForever: (id: string) =>
    apiRequest("DELETE", `/trash/${encodeURIComponent(id)}`),
  empty: () => apiRequest("DELETE", "/trash"),
};
