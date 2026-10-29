import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import {
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  LoadIcon,
  PlusIcon,
  usersIcon,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import { STORAGE_PREFIXES, SYNC_BROWSER_TABS_TIMEOUT } from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
  userToFollowAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  DrawingsDialog,
  drawingsDialogOpenAtom,
} from "./components/DrawingsDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  getSyncableElements,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { DrawingsAPI } from "./data/drawings";
import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";

import { loadFilesFromServer } from "./data/serverStorage";
import {
  LibraryIndexedDBMigrationAdapter,
  LibraryServerAdapter,
  ServerData,
  getDrawingUrl,
  getPersistableAppState,
  saveErrorAtom,
} from "./data/ServerData";
import { AuthGate } from "./auth/AuthGate";
import { logout } from "./auth/auth";
import { tu } from "./app-language/unchained-i18n";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";
import { AIComponents } from "./components/AI";

import "./index.scss";

import type { CollabAPI } from "./collab/Collab";
import type { Drawing } from "./data/drawings";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

/** restores a drawing fetched from the server into an editor scene */
const restoreDrawingScene = (drawing: Drawing) => {
  const elements = restoreElements(drawing.elements, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  const appState = {
    ...restoreAppState(drawing.appState, null),
    name: drawing.name,
  };
  return { elements, appState };
};

/** imports a scene shared through a `#json=` or `#url=` link */
const importExternalScene = async (
  jsonBackendMatch: RegExpMatchArray | null,
  externalUrlMatch: RegExpMatchArray | null,
): Promise<ImportedDataState | null> => {
  if (jsonBackendMatch) {
    return importFromBackend(jsonBackendMatch[1], jsonBackendMatch[2]);
  }
  if (externalUrlMatch) {
    const request = await fetch(window.decodeURIComponent(externalUrlMatch[1]));
    return loadFromBlob(await request.blob(), null, null);
  }
  return null;
};

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);
  const roomLinkData = getCollaborationLinkData(window.location.href);

  // don't lose changes made to the drawing that's currently open
  await ServerData.flushSave();

  const drawing = await ServerData.fetchInitialDrawing();
  const drawingScene = restoreDrawingScene(drawing);

  if (jsonBackendMatch || externalUrlMatch) {
    let imported: ImportedDataState | null = null;
    try {
      imported = await importExternalScene(jsonBackendMatch, externalUrlMatch);
    } catch (error: any) {
      console.error(error);
      ServerData.setCurrentDrawing(drawing, drawingScene);
      return {
        scene: {
          ...drawingScene,
          appState: {
            ...drawingScene.appState,
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene: false,
      };
    }

    if (imported?.elements?.length) {
      const elements = restoreElements(imported.elements, null, {
        repairBindings: true,
        deleteInvisibleElements: true,
      });
      const appState = restoreAppState(
        imported.appState,
        // keep the user's settings which aren't part of shared scenes
        drawingScene.appState,
      );
      // the shared scene is imported as a new drawing, so that nothing gets
      // overwritten
      const newDrawing = await DrawingsAPI.create({
        name: imported.appState?.name || undefined,
        elements: getSyncableElements(elements),
        appState: getPersistableAppState(appState),
      });
      appState.name = newDrawing.name;
      ServerData.setCurrentDrawing(newDrawing, { elements, appState });
      opts.excalidrawAPI.setToast({ message: tu("drawings.importedCopy") });

      const scene = {
        elements,
        appState,
        files: imported.files,
        scrollToContent: true,
      };
      return jsonBackendMatch
        ? {
            scene,
            isExternalScene: true,
            id: jsonBackendMatch[1],
            key: jsonBackendMatch[2],
          }
        : { scene, isExternalScene: false };
    }
  }

  ServerData.setCurrentDrawing(drawing, drawingScene);

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: drawingScene.appState.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  }

  return { scene: drawingScene, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);
  const userToFollow = useAtomValue(userToFollowAtom);

  const viewportStatusFrame = useMemo(
    () =>
      userToFollow
        ? {
            border: "var(--color-primary-hover)",
            label: {
              label: (
                <>
                  Following{" "}
                  <span
                    style={{
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 100,
                    }}
                    title={userToFollow.username}
                  >
                    {userToFollow.username}
                  </span>
                </>
              ),
              onClose: () => collabAPI?.setUserToFollow(null),
            },
          }
        : null,
    [userToFollow, collabAPI],
  );

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryServerAdapter,
    // library previously saved in the browser by excalidraw.com
    migrationAdapter: LibraryIndexedDBMigrationAdapter,
  });

  useEffect(() => {
    ServerData.excalidrawAPI = excalidrawAPI;
  }, [excalidrawAPI]);

  const [, setDrawingsDialogOpen] = useAtom(drawingsDialogOpenAtom);

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(excalidrawAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromServer({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (
              isInitializedImageElement(element) &&
              // files bundled with the scene (e.g. imported from a file)
              !data.scene?.files?.[element.fileId]
            ) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct server call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromServer(
            `${STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            ServerData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  // ---------------------------------------------------------------------------
  // server-side drawings
  // ---------------------------------------------------------------------------

  const loadDrawingIntoEditor = useCallback(
    (drawing: Drawing, opts?: { keepViewport?: boolean }) => {
      if (!excalidrawAPI) {
        return;
      }
      const scene = restoreDrawingScene(drawing);
      ServerData.setCurrentDrawing(drawing, scene);
      if (opts?.keepViewport) {
        excalidrawAPI.updateScene({
          elements: scene.elements,
          appState: {
            name: scene.appState.name,
            viewBackgroundColor: scene.appState.viewBackgroundColor,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } else {
        excalidrawAPI.updateScene({
          elements: scene.elements,
          // (the viewport is restored from the drawing's saved appState)
          appState: { ...scene.appState, isLoading: false },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        excalidrawAPI.history.clear();
      }
      loadImages({ scene, isExternalScene: false }, /* isInitialLoad */ true);
    },
    [excalidrawAPI, loadImages],
  );

  /** returns false if the user doesn't want to leave the collab session */
  const leaveCollaboration = useCallback(() => {
    if (!collabAPI?.isCollaborating()) {
      return true;
    }
    if (!window.confirm(tu("drawings.stopCollabConfirm"))) {
      return false;
    }
    collabAPI.stopCollaboration(false);
    return true;
  }, [collabAPI]);

  const openDrawing = useCallback(
    async (drawingId: string | null) => {
      if (!excalidrawAPI || !leaveCollaboration()) {
        return;
      }
      await ServerData.flushSave();
      const drawing = drawingId
        ? await DrawingsAPI.get(drawingId)
        : await DrawingsAPI.create();
      loadDrawingIntoEditor(drawing);
    },
    [excalidrawAPI, leaveCollaboration, loadDrawingIntoEditor],
  );

  const openMostRecentDrawing = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    // the current drawing was deleted: discard its pending changes
    ServerData.drawingId = null;
    const [mostRecent] = await DrawingsAPI.list();
    loadDrawingIntoEditor(
      mostRecent
        ? await DrawingsAPI.get(mostRecent.id)
        : await DrawingsAPI.create(),
    );
  }, [excalidrawAPI, loadDrawingIntoEditor]);

  const onDrawingError = useCallback((error: Error) => {
    console.error(error);
    setErrorMessage(error.message || tu("drawings.loadError"));
  }, []);

  const onLogout = useCallback(async () => {
    try {
      await ServerData.flushSave();
      await logout();
    } finally {
      window.location.href = getDrawingUrl(null);
    }
  }, []);

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    let retryTimer = 0;
    const init = () =>
      initializeScene({ collabAPI, excalidrawAPI })
        .then(async (data) => {
          loadImages(data, /* isInitialLoad */ true);
          initialStatePromiseRef.current.promise.resolve(data.scene);
        })
        .catch((error) => {
          // most likely a network error: retry until it works, there's
          // nothing useful the user could do with the editor in the meantime
          console.error(error);
          retryTimer = window.setTimeout(init, 3000);
        });
    init();

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI })
          .then((data) => {
            loadImages(data, /* isInitialLoad */ true);
            if (data.scene) {
              excalidrawAPI.updateScene({
                elements: restoreElements(data.scene.elements, null, {
                  repairBindings: true,
                }),
                appState: restoreAppState(data.scene.appState, null),
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              });
              if (data.scene.files) {
                excalidrawAPI.addFiles(Object.values(data.scene.files));
              }
            }
          })
          .catch((error) => {
            console.error(error);
            setErrorMessage(tu("drawings.loadError"));
            excalidrawAPI.updateScene({ appState: { isLoading: false } });
          });
      }
    };

    // pick up changes made to the current drawing from other tabs/devices
    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        ServerData.fetchIfChangedRemotely()
          .then((drawing) => {
            if (drawing) {
              loadDrawingIntoEditor(drawing, { keepViewport: true });
            }
          })
          .catch((error) => console.warn(error));
        LibraryServerAdapter.load()
          .then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          })
          .catch((error) => console.warn(error));
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      ServerData.flushSave({ keepalive: true });
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        ServerData.flushSave({ keepalive: true });
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    loadImages,
    loadDrawingIntoEditor,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      const hasUnsavedChanges = ServerData.hasUnsavedChanges();
      ServerData.flushSave({ keepalive: true });

      if (
        excalidrawAPI &&
        (hasUnsavedChanges ||
          ServerData.fileStorage.shouldPreventUnload(
            excalidrawAPI.getSceneElements(),
          ))
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!ServerData.isSavePaused()) {
      ServerData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                ServerData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const isCollabAvailable =
    !isCollabDisabled && (!isOffline || isCollaborating);

  useEffect(() => {
    if (!isCollabAvailable) {
      setShareDialogState({ isOpen: false });
    }
  }, [isCollabAvailable, setShareDialogState]);

  const saveError = useAtomValue(saveErrorAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        viewportStatusFrame={viewportStatusFrame}
        userToFollow={userToFollow}
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || !isCollabAvailable) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={isCollabAvailable}
          theme={appTheme}
          refresh={() => forceRefresh((prev) => !prev)}
          onDrawingsDialogOpen={() => setDrawingsDialogOpen(true)}
          onNewDrawing={() => openDrawing(null).catch(onDrawingError)}
          onLogout={onLogout}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={isCollabAvailable}
          onDrawingsDialogOpen={() => setDrawingsDialogOpen(true)}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
        </OverwriteConfirmDialog>
        <DrawingsDialog
          onOpenDrawing={(id) => openDrawing(id)}
          onNewDrawing={() => openDrawing(null)}
          onCurrentDrawingDeleted={openMostRecentDrawing}
          onCurrentDrawingRenamed={(name) => {
            ServerData.updateCurrentDrawing({ name });
            excalidrawAPI?.updateScene({ appState: { name } });
          }}
        />
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {saveError && (
          <div className="alert alert--danger">{tu("drawings.saveError")}</div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: tu("drawings.title"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: LoadIcon,
              keywords: ["drawings", "open", "files", "dessins", "ouvrir"],
              perform: () => setDrawingsDialogOpen(true),
            },
            {
              label: tu("drawings.new"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: PlusIcon,
              keywords: ["new", "drawing", "create", "nouveau", "dessin"],
              perform: () => {
                openDrawing(null).catch(onDrawingError);
              },
            },
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <AuthGate>
          <ExcalidrawAPIProvider>
            <ExcalidrawWrapper />
          </ExcalidrawAPIProvider>
        </AuthGate>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
