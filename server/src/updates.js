// New versions of the application: which one is available (asked to the image
// registry by the server, when an administrator allows it).

import { config } from "./config.js";
import { getUpdateCheckEnabled } from "./settings.js";

const RELEASE_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const CHECK_INTERVAL_MS = 6 * 3600e3;
const REQUEST_TIMEOUT_MS = 15e3;

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

export const createUpdates = (db, { fetchFn = fetch } = {}) => {
  let latest = null;
  let checkedAt = null;
  let checkError = null;

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

    getStatus: () => ({
      version: config.version,
      latest,
      available: !!latest && isNewerRelease(latest, config.version),
      checkEnabled: getUpdateCheckEnabled(db),
      checkedAt,
      checkError,
    }),

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
