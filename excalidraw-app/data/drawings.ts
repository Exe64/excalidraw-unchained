import { getDateTime } from "@excalidraw/common";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { apiRequest } from "./api";

import type { PendingOp } from "./pendingOps";

export type DrawingSummary = {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
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

  remove: (id: string) => apiRequest("DELETE", path(id)),
};
