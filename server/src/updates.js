// New versions of the application: which one is available (asked to the image
// registry by the server, when an administrator allows it), and installing it
// through the updater service (see updater.js).

import { createBackup } from "./backups.js";
import { config } from "./config.js";
import { getUpdateCheckEnabled } from "./settings.js";

const RELEASE_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const CHECK_INTERVAL_MS = 6 * 3600e3;
const REQUEST_TIMEOUT_MS = 15e3;
/** people whose editor checked in during this time count as connected */
const CONNECTED_MS = 90e3;

const parseRelease = (version) => {
  const match = RELEASE_RE.exec(version);
  return match && match.slice(1).map(Number);
};

/** whether release `a` is more recent than `b`; false if either isn't one */
export const isNewerRelease = (a, b) => {
  const [partsA, partsB] = [parseRelease(a), parseRelease(b)];
  if (!partsA || !partsB) {
    return false;
  }
  const index = partsA.findIndex((part, i) => part !== partsB[i]);
  return index !== -1 && partsA[index] > partsB[index];
};

/** the most recent release among image tags (ignores `latest`, `sha-…`…) */
export const latestRelease = (tags) =>
  tags
    .filter(parseRelease)
    .reduce(
      (latest, tag) =>
        latest === null || isNewerRelease(tag, latest) ? tag : latest,
      null,
    );

/** the tags of a public image, from the registry's anonymous API */
export const fetchImageTags = async (image, fetchFn = fetch) => {
  const slash = image.indexOf("/");
  const host = image.slice(0, slash);
  const repository = image.slice(slash + 1);
  // a registry on this machine has no TLS certificate (only used for tests)
  const protocol = /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
    ? "http"
    : "https";
  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const headers = {};
  if (protocol === "https") {
    const response = await fetchFn(
      `https://${host}/token?scope=repository:${repository}:pull`,
      { signal: signal() },
    );
    if (!response.ok) {
      throw new Error(`Token refused by ${host} (${response.status})`);
    }
    headers.Authorization = `Bearer ${(await response.json()).token}`;
  }

  const tags = [];
  let url = `${protocol}://${host}/v2/${repository}/tags/list?n=1000`;
  while (url) {
    const response = await fetchFn(url, { headers, signal: signal() });
    if (!response.ok) {
      throw new Error(`Tags refused by ${host} (${response.status})`);
    }
    tags.push(...((await response.json()).tags || []));
    const next = /<([^>]+)>;\s*rel="next"/.exec(
      response.headers.get("link") || "",
    );
    url = next && new URL(next[1], url).href;
  }
  return tags;
};

export class UpdateError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const createUpdates = (db, { fetchFn = fetch } = {}) => {
  let latest = null;
  let checkedAt = null;
  let checkError = null;
  /** an update is being installed: told to everyone, for the outage to come */
  let installing = false;
  const lastSeen = new Map();

  const isAvailable = () => !!latest && isNewerRelease(latest, config.version);

  const updaterRequest = async (method, path, body) => {
    const response = await fetchFn(`${config.update.updaterUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.update.updaterSecret}`,
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Updater error (${response.status})`);
    }
    return data;
  };

  /** the updater's status; null if there's none, or it can't be reached */
  const getInstaller = async () => {
    if (!config.update.updaterSecret) {
      return null;
    }
    try {
      return await updaterRequest("GET", "/status");
    } catch {
      return null;
    }
  };

  /** until the updater is done (if it succeeds, this server stops before) */
  const watchInstall = async () => {
    while (installing) {
      await new Promise((resolve) => setTimeout(resolve, 3000).unref());
      const installer = await getInstaller();
      if (installer?.state !== "running") {
        installing = false;
      }
    }
  };

  /** never throws: a failed check only shows up in the status */
  const check = async () => {
    checkedAt = Date.now();
    try {
      latest = latestRelease(
        await fetchImageTags(config.update.image, fetchFn),
      );
      checkError = null;
    } catch (error) {
      checkError = error.message;
    }
  };

  return {
    check,

    getStatus: async (userId) => ({
      version: config.version,
      latest,
      available: isAvailable(),
      checkEnabled: getUpdateCheckEnabled(db),
      checkedAt,
      checkError,
      installer: await getInstaller(),
      installing,
      otherUsers: [...lastSeen].filter(
        ([id, time]) => id !== userId && Date.now() - time < CONNECTED_MS,
      ).length,
    }),

    /** what every editor regularly asks, to tell about an update in progress */
    getPublicStatus: (userId) => {
      lastSeen.set(userId, Date.now());
      for (const [id, time] of lastSeen) {
        if (Date.now() - time >= CONNECTED_MS) {
          lastSeen.delete(id);
        }
      }
      return { version: config.version, installing };
    },

    /** backs up the database, then asks the updater to install `version` */
    install: async (version) => {
      if (!config.update.updaterSecret) {
        throw new UpdateError(
          409,
          "Le service de mise à jour n'est pas activé.",
        );
      }
      if (!isAvailable() || version !== latest) {
        throw new UpdateError(409, "Cette version n'est plus à installer.");
      }
      if (installing) {
        throw new UpdateError(409, "Une mise à jour est déjà en cours.");
      }
      installing = true;
      try {
        createBackup(db, "before-update");
        await updaterRequest("POST", "/update", { version });
      } catch (error) {
        installing = false;
        throw new UpdateError(
          502,
          `La mise à jour n'a pas démarré : ${error.message}`,
        );
      }
      watchInstall();
    },

    /** periodic checks, as long as an administrator allows them */
    schedule: () => {
      const run = () => {
        if (
          getUpdateCheckEnabled(db) &&
          Date.now() - (checkedAt ?? 0) >= CHECK_INTERVAL_MS - 60e3
        ) {
          check();
        }
      };
      run();
      setInterval(run, 3600e3).unref();
    },
  };
};
