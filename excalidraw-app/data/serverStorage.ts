/**
 * Persistence of collaboration rooms and of encrypted files (collab rooms &
 * shareable links) on the Excalidraw Unchained server. Replaces the Firebase
 * storage used by excalidraw.com. Data is end-to-end encrypted: the server
 * never receives the room/link keys.
 */

import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { ApiError, apiRequest, base64ToBytes, bytesToBase64 } from "./api";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

type StoredScene = {
  sceneVersion: number;
  /** base64 */
  iv: string;
  /** base64 */
  ciphertext: string;
  /** server-side revision, used for optimistic concurrency */
  revision: number;
};

const MAX_SAVE_ATTEMPTS = 5;

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = base64ToBytes(data.ciphertext);
  const iv = base64ToBytes(data.iv);

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

class SceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return SceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    SceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

/** last known server revision of the room scene, per socket */
const roomRevisionCache = new WeakMap<Socket, StoredScene>();

export const isSavedToServer = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return SceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

const blobUrl = (prefix: string, id: string) =>
  `/blobs/${prefix.replace(/^\/+/, "")}/${encodeURIComponent(id)}`;

/**
 * @param prefix `rooms/<roomId>` or `shareLinks/<linkId>`
 */
export const saveFilesToServer = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        await apiRequest("PUT", blobUrl(prefix, id), {
          body: buffer as Uint8Array<ArrayBuffer>,
        });
        savedFiles.push(id);
      } catch (error: any) {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createStoredScene = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
  revision: number,
): Promise<StoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  return {
    sceneVersion,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    revision,
  };
};

const fetchStoredScene = async (
  roomId: string,
): Promise<StoredScene | null> => {
  try {
    return await apiRequest<StoredScene>(
      "GET",
      `/rooms/${encodeURIComponent(roomId)}`,
    );
  } catch (error: any) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const saveToServer = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToServer(portal, elements)
  ) {
    return null;
  }

  // optimistic concurrency: try to save on top of the last stored scene we
  // know of, and on conflict reconcile with the scene the server returns
  let prevStoredScene: StoredScene | null =
    roomRevisionCache.get(socket) ?? null;
  let storedElements: readonly SyncableExcalidrawElement[] | null = null;

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    let elementsToSave = elements;
    if (prevStoredScene?.ciphertext) {
      const prevStoredElements = getSyncableElements(
        restoreElements(await decryptElements(prevStoredScene, roomKey), null),
      );
      elementsToSave = getSyncableElements(
        reconcileElements(
          elements,
          prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      );
    }

    const storedScene = await createStoredScene(
      elementsToSave,
      roomKey,
      prevStoredScene?.revision ?? 0,
    );

    try {
      const { revision } = await apiRequest<{ revision: number }>(
        "PUT",
        `/rooms/${encodeURIComponent(roomId)}`,
        { json: storedScene },
      );
      roomRevisionCache.set(socket, { ...storedScene, revision });
      storedElements = elementsToSave;
      break;
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 409) {
        prevStoredScene = error.data as StoredScene;
        continue;
      }
      throw error;
    }
  }

  if (!storedElements) {
    throw new Error("Couldn't save the collaboration scene (conflict)");
  }

  const restoredElements = getSyncableElements(
    restoreElements(storedElements, null),
  );

  SceneVersionCache.set(socket, restoredElements);

  return toBrandedType<RemoteExcalidrawElement[]>(restoredElements);
};

export const loadFromServer = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const storedScene = await fetchStoredScene(roomId);
  if (!storedScene) {
    return null;
  }
  const elements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null, {
      deleteInvisibleElements: true,
    }),
  );

  if (socket) {
    roomRevisionCache.set(socket, storedScene);
    SceneVersionCache.set(socket, elements);
  }

  return elements;
};

/**
 * @param prefix `rooms/<roomId>` or `shareLinks/<linkId>`
 */
export const loadFilesFromServer = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const arrayBuffer = await apiRequest<ArrayBuffer>(
          "GET",
          blobUrl(prefix, id),
          { binary: true },
        );

        const { data, metadata } = await decompressData<BinaryFileMetadata>(
          new Uint8Array(arrayBuffer),
          {
            decryptionKey,
          },
        );

        const dataURL = new TextDecoder().decode(data) as DataURL;

        loadedFiles.push({
          mimeType: metadata.mimeType || MIME_TYPES.binary,
          id,
          dataURL,
          created: metadata?.created || Date.now(),
          lastRetrieved: metadata?.created || Date.now(),
        });
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
