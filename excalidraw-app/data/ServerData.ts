/**
 * Saves the current drawing (elements, appState, images) and the user's
 * library to the Excalidraw Unchained server. Replaces the browser storage
 * (localStorage/IndexedDB) used by excalidraw.com.
 *
 * - the editor's state is saved to the current drawing, debounced
 * - concurrent edits of the same drawing (other tab/device) are detected via
 *   the drawing's version and merged using element reconciliation
 * - image files are stored per user, keyed by their content hash
 */

import { reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { clearAppStateForLocalStorage } from "@excalidraw/excalidraw/appState";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";
import { getSceneVersion } from "@excalidraw/element";
import { createStore, del, get } from "idb-keyval";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";
import { tu } from "../app-language/unchained-i18n";
import { SAVE_TO_SERVER_TIMEOUT, STORAGE_KEYS } from "../app_constants";

import { ApiError, apiRequest } from "./api";
import { DrawingsAPI } from "./drawings";
import { FileManager } from "./FileManager";
import { FileStatusStore } from "./fileStatusStore";
import { convertPendingOps } from "./pendingOps";
import { Locker } from "./Locker";

import { getSyncableElements } from ".";

import type { Drawing, DrawingSummary } from "./drawings";
import type { PendingOp } from "./pendingOps";

const SAVE_RETRY_TIMEOUT = 5000;

/** the drawing currently open in the editor */
export const currentDrawingAtom = atom<DrawingSummary | null>(null);

/** whether the last attempt to save to the server failed */
export const saveErrorAtom = atom(false);

type SaveArgs = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
  onFilesSaved: () => void;
};

type SavingLockTypes = "collaboration";

export const getPersistableAppState = (appState: Partial<AppState>) => {
  const _appState = clearAppStateForLocalStorage(appState);

  if (
    _appState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
    _appState.openSidebar.tab === CANVAS_SEARCH_TAB
  ) {
    _appState.openSidebar = null;
  }
  return _appState;
};

/**
 * What must change for the drawing to be saved. Viewport and UI state
 * (scroll, zoom, selection, …) alone doesn't trigger a save, but is persisted
 * along with the next save.
 */
const getChangeSignature = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "name" | "viewBackgroundColor">,
) =>
  JSON.stringify([
    getSceneVersion(elements),
    elements.length,
    appState.name,
    appState.viewBackgroundColor,
  ]);

const setLastOpenedDrawing = (id: string) => {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_OPENED_DRAWING, id);
  } catch {}
};

export const getLastOpenedDrawing = () => {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_OPENED_DRAWING);
  } catch {
    return null;
  }
};

/** URL of the current drawing, used to keep the address bar in sync */
export const getDrawingUrl = (drawingId: string | null) => {
  const url = new URL(window.location.origin);
  if (drawingId) {
    url.searchParams.set("drawing", drawingId);
  }
  return url.toString();
};

export const getDrawingIdFromUrl = () =>
  new URLSearchParams(window.location.search).get("drawing");

export class ServerData {
  /** id of the drawing open in the editor */
  static drawingId: string | null = null;
  /** server version the editor's state is based on */
  private static version = 0;
  private static savedSignature: string | null = null;
  /** pending operations converted into the scene, not acknowledged yet */
  private static appliedOps = new Set<string>();

  private static pending: SaveArgs | null = null;
  private static timer: number | null = null;
  private static retryTimer: number | null = null;
  private static queue: Promise<void> = Promise.resolve();
  private static inflight = 0;

  static excalidrawAPI: ExcalidrawImperativeAPI | null = null;

  /** approximate sizes of the last saved payload, for the stats panel */
  static storageSizes = { scene: 0, total: 0 };

  // ---------------------------------------------------------------------------
  // current drawing
  // ---------------------------------------------------------------------------

  /**
   * Makes `drawing` the current drawing. `elements` & `appState` are what the
   * editor will display, used as the baseline to detect unsaved changes.
   */
  static setCurrentDrawing(
    drawing: Drawing | DrawingSummary,
    scene: {
      elements: readonly ExcalidrawElement[];
      appState: Pick<AppState, "name" | "viewBackgroundColor">;
    },
    opts?: {
      /** pending operations of `drawing` already converted into the scene */
      appliedOps?: readonly string[];
    },
  ) {
    this.cancelPendingSave();
    this.drawingId = drawing.id;
    this.version = drawing.version;
    this.appliedOps = new Set(opts?.appliedOps);
    // converted operations must be saved (and acknowledged) right away
    this.savedSignature = this.appliedOps.size
      ? null
      : getChangeSignature(scene.elements, scene.appState);
    appJotaiStore.set(currentDrawingAtom, {
      id: drawing.id,
      name: drawing.name,
      version: drawing.version,
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    });
    appJotaiStore.set(saveErrorAtom, false);
    setLastOpenedDrawing(drawing.id);

    if (getDrawingIdFromUrl() !== drawing.id || window.location.hash) {
      // keep the hash of collab links (#room=), drop the others (#json=, …)
      const keepHash = window.location.hash.startsWith("#room=");
      window.history.replaceState(
        {},
        "",
        getDrawingUrl(drawing.id) + (keepHash ? window.location.hash : ""),
      );
    }
  }

  /**
   * Returns the drawing to open on load: the one from the URL, else the last
   * opened one, else the most recent one, else a new one.
   */
  static fetchInitialDrawing(): Promise<Drawing> {
    // dedupe concurrent calls, so that we never create two new drawings
    return (this.initialDrawingRequest ??= this._fetchInitialDrawing().finally(
      () => {
        this.initialDrawingRequest = null;
      },
    ));
  }

  private static initialDrawingRequest: Promise<Drawing> | null = null;

  private static async _fetchInitialDrawing(): Promise<Drawing> {
    const candidates = [
      this.drawingId,
      getDrawingIdFromUrl(),
      getLastOpenedDrawing(),
    ].filter((id): id is string => !!id);

    for (const id of new Set(candidates)) {
      try {
        return await DrawingsAPI.get(id);
      } catch (error: any) {
        if (!(error instanceof ApiError) || error.status !== 404) {
          throw error;
        }
      }
    }

    const [mostRecent] = await DrawingsAPI.list();
    if (mostRecent) {
      return DrawingsAPI.get(mostRecent.id);
    }
    return DrawingsAPI.create();
  }

  /** updates the name of the current drawing (e.g. renamed elsewhere) */
  static updateCurrentDrawing(summary: Partial<DrawingSummary>) {
    const current = appJotaiStore.get(currentDrawingAtom);
    if (current) {
      appJotaiStore.set(currentDrawingAtom, { ...current, ...summary });
    }
  }

  /**
   * Returns the current drawing from the server if it was changed elsewhere
   * (another tab or device) and there are no local unsaved changes.
   */
  static async fetchIfChangedRemotely(): Promise<Drawing | null> {
    const drawingId = this.drawingId;
    if (!drawingId || this.isSavePaused() || this.hasUnsavedChanges()) {
      return null;
    }
    const { version } = await DrawingsAPI.getVersion(drawingId);
    if (version <= this.version) {
      return null;
    }
    const drawing = await DrawingsAPI.get(drawingId);
    if (this.drawingId !== drawingId || this.hasUnsavedChanges()) {
      return null;
    }
    return drawing;
  }

  /** pending operations of `drawing` that haven't been converted yet */
  static getOpsToApply(drawing: Drawing): PendingOp[] {
    return (drawing.pendingOps || []).filter(
      (op) => !this.appliedOps.has(op.id),
    );
  }

  /** saves the editor's current state (e.g. after converting operations) */
  static requestSave() {
    const api = this.excalidrawAPI;
    if (api) {
      this.save(
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
        () => {},
      );
    }
  }

  // ---------------------------------------------------------------------------
  // saving
  // ---------------------------------------------------------------------------

  /** Saves DataState, including files. Bails if saving is paused */
  static save = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    // we need to make the `isSavePaused` check synchronously (undebounced)
    if (this.isSavePaused() || !this.drawingId || appState.isLoading) {
      return;
    }
    this.pending = { elements, appState, files, onFilesSaved };
    if (this.timer) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.run();
    }, SAVE_TO_SERVER_TIMEOUT);
  };

  /** saves pending changes now, resolving once all saves have completed */
  static flushSave = (opts?: { keepalive?: boolean }) => {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      this.run(opts);
    }
    return this.queue;
  };

  private static cancelPendingSave() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pending = null;
  }

  private static run(opts?: { keepalive?: boolean }) {
    this.timer = null;
    const args = this.pending;
    const drawingId = this.drawingId;
    this.pending = null;
    if (!args || !drawingId) {
      return;
    }
    this.inflight++;
    this.queue = this.queue
      .then(() => this.persist(drawingId, args, opts))
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        this.inflight--;
      });
  }

  private static scheduleRetry(args: SaveArgs) {
    if (!this.pending) {
      this.pending = args;
    }
    if (this.retryTimer) {
      window.clearTimeout(this.retryTimer);
    }
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.timer && this.pending) {
        this.run();
      }
    }, SAVE_RETRY_TIMEOUT);
  }

  private static async persist(
    drawingId: string,
    args: SaveArgs,
    opts?: { keepalive?: boolean },
  ) {
    if (drawingId !== this.drawingId) {
      // the drawing was switched in the meantime
      return;
    }
    const { elements, appState, files, onFilesSaved } = args;

    await this.fileStorage.saveFiles({ elements, files });
    onFilesSaved();

    const signature = getChangeSignature(elements, appState);
    if (signature === this.savedSignature && !this.appliedOps.size) {
      return;
    }

    const appliedOps = [...this.appliedOps];
    const payload = {
      name: appState.name || "",
      elements: getSyncableElements(elements as any),
      appState: getPersistableAppState(appState),
      baseVersion: this.version,
      appliedOps,
    };

    try {
      const result = await DrawingsAPI.save(drawingId, payload, opts);
      if (drawingId !== this.drawingId) {
        return;
      }
      this.version = result.version;
      this.savedSignature = signature;
      appliedOps.forEach((id) => this.appliedOps.delete(id));
      this.updateCurrentDrawing({
        name: result.name,
        version: result.version,
        updatedAt: result.updatedAt,
      });
      appJotaiStore.set(saveErrorAtom, false);

      const sceneSize = JSON.stringify(payload.elements).length;
      this.storageSizes = {
        scene: sceneSize,
        total: sceneSize + JSON.stringify(payload.appState).length,
      };
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 409) {
        // changed from another tab/device: merge and save again
        await this.mergeRemoteChanges(drawingId);
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        // deleted elsewhere: recreate it so no work is lost
        const drawing = await DrawingsAPI.create({
          name: payload.name,
          elements: payload.elements,
          appState: payload.appState,
        });
        this.setCurrentDrawing(drawing, { elements, appState });
        return;
      }
      if (!(error instanceof ApiError) || error.status !== 401) {
        appJotaiStore.set(saveErrorAtom, true);
      }
      this.scheduleRetry(args);
    }
  }

  private static async mergeRemoteChanges(drawingId: string) {
    const api = this.excalidrawAPI;
    const remote = await DrawingsAPI.get(drawingId);
    if (!api || drawingId !== this.drawingId) {
      return;
    }
    const localElements = api.getSceneElementsIncludingDeleted();
    const remoteElements = restoreElements(remote.elements, localElements);
    let reconciledElements: readonly ExcalidrawElement[] = reconcileElements(
      localElements,
      remoteElements as RemoteExcalidrawElement[],
      api.getAppState(),
    );
    // changes requested through the API in the meantime
    const ops = this.getOpsToApply(remote);
    if (ops.length) {
      const converted = await convertPendingOps(ops, reconciledElements);
      reconciledElements = restoreElements(
        [...reconciledElements, ...converted.elements],
        null,
        { repairBindings: true },
      );
      api.addFiles(converted.files);
      ops.forEach((op) => this.appliedOps.add(op.id));
    }
    if (drawingId !== this.drawingId) {
      return;
    }
    this.version = remote.version;
    // force a save of the merged state
    this.savedSignature = null;
    api.updateScene({
      elements: reconciledElements,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.setToast({ message: tu("drawings.conflict") });
    // in case updateScene didn't result in a change
    this.save(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      api.getFiles(),
      () => {},
    );
  }

  /** whether some changes haven't been persisted to the server yet */
  static hasUnsavedChanges = () => {
    if (this.inflight > 0) {
      return true;
    }
    if (this.pending) {
      return (
        getChangeSignature(this.pending.elements, this.pending.appState) !==
          this.savedSignature ||
        this.fileStorage.shouldPreventUnload(this.pending.elements)
      );
    }
    return false;
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new FileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    async getFiles(ids) {
      const loadedFiles: BinaryFileData[] = [];
      const erroredFiles = new Map<FileId, true>();

      await Promise.all(
        ids.map(async (id) => {
          try {
            const file = await apiRequest<BinaryFileData>(
              "GET",
              `/files/${encodeURIComponent(id)}`,
            );
            loadedFiles.push({ ...file, lastRetrieved: Date.now() });
          } catch (error: any) {
            erroredFiles.set(id, true);
          }
        }),
      );

      return { loadedFiles, erroredFiles };
    },
    async saveFiles({ addedFiles }) {
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();

      await Promise.all(
        [...addedFiles].map(async ([id, fileData]) => {
          try {
            await apiRequest("PUT", `/files/${encodeURIComponent(id)}`, {
              json: {
                mimeType: fileData.mimeType,
                dataURL: fileData.dataURL,
                created: fileData.created,
              },
            });
            savedFiles.set(id, fileData);
          } catch (error: any) {
            console.error(error);
            erroredFiles.set(id, fileData);
          }
        }),
      );

      return { savedFiles, erroredFiles };
    },
  });
}

/** the user's personal library, stored on the server */
export class LibraryServerAdapter {
  static async load(): Promise<LibraryPersistedData | null> {
    const { library } = await apiRequest<{
      library: LibraryPersistedData | null;
    }>("GET", "/library");
    return library;
  }

  static async save(data: LibraryPersistedData): Promise<void> {
    await apiRequest("PUT", "/library", { json: data });
  }
}

/** migrates a library saved in the browser (IndexedDB) to the server */
export class LibraryIndexedDBMigrationAdapter {
  private static key = "libraryData";

  private static store = createStore(
    "excalidraw-library-db",
    "excalidraw-library-store",
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBMigrationAdapter.key,
      LibraryIndexedDBMigrationAdapter.store,
    );
    return IDBData?.libraryItems?.length ? IDBData : null;
  }

  static async clear() {
    await del(
      LibraryIndexedDBMigrationAdapter.key,
      LibraryIndexedDBMigrationAdapter.store,
    );
  }
}
