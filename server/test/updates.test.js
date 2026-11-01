import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { setUpdateCheckEnabled } from "../src/settings.js";
import {
  createUpdates,
  fetchImageTags,
  isNewerRelease,
  latestRelease,
} from "../src/updates.js";

const json = (body, headers = {}) =>
  new Response(JSON.stringify(body), { headers });

/** a registry with these pages of tags, recording the requested URLs */
const registry = (...pages) => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.includes("/token")) {
      return json({ token: "t" });
    }
    const page = Number(new URL(url).searchParams.get("page") ?? 0);
    return json(
      { tags: pages[page] },
      page + 1 < pages.length
        ? { link: `</v2/o/r/tags/list?page=${page + 1}>; rel="next"` }
        : {},
    );
  };
  return { urls, fetchFn };
};

describe("versions", () => {
  it("compares releases numerically", () => {
    assert.equal(isNewerRelease("1.10.0", "1.9.9"), true);
    assert.equal(isNewerRelease("1.9.9", "1.10.0"), false);
    assert.equal(isNewerRelease("1.0.0", "1.0.0"), false);
  });

  it("never offers an update from or to something that isn't a release", () => {
    assert.equal(isNewerRelease("2.0.0", "dev"), false);
    assert.equal(isNewerRelease("2.0.0", "sha-abc123"), false);
    assert.equal(isNewerRelease("2.0.0-rc1", "1.0.0"), false);
  });

  it("finds the latest release among the tags of an image", () => {
    assert.equal(
      latestRelease([
        "latest",
        "sha-abc",
        "1.2",
        "1.9.0",
        "1.10.0",
        "2.0.0-rc1",
      ]),
      "1.10.0",
    );
    assert.equal(latestRelease(["latest", "sha-abc"]), null);
  });
});

describe("image tags", () => {
  it("authenticates anonymously and follows the pages", async () => {
    const { urls, fetchFn } = registry(["1.0.0"], ["1.1.0"]);
    assert.deepEqual(await fetchImageTags("ghcr.io/o/r", fetchFn), [
      "1.0.0",
      "1.1.0",
    ]);
    assert.ok(urls[0].startsWith("https://ghcr.io/token?"));
    assert.ok(urls[1].startsWith("https://ghcr.io/v2/o/r/tags/list"));
    assert.equal(urls.length, 3);
  });

  it("reaches a local registry without TLS or token", async () => {
    const { urls, fetchFn } = registry(["1.0.0"]);
    await fetchImageTags("localhost:5000/o/r", fetchFn);
    assert.deepEqual(urls, ["http://localhost:5000/v2/o/r/tags/list?n=1000"]);
  });
});

describe("update status", () => {
  const withVersion = async (version, test) => {
    const previous = config.version;
    config.version = version;
    try {
      await test();
    } finally {
      config.version = previous;
    }
  };

  it("makes no request while the checks are off", async () => {
    const db = openDatabase(":memory:");
    const { urls, fetchFn } = registry(["2.0.0"]);
    createUpdates(db, { fetchFn }).schedule();
    assert.deepEqual(urls, []);
    db.close();
  });

  it("offers a newer release once checked", async () => {
    await withVersion("1.0.0", async () => {
      const db = openDatabase(":memory:");
      setUpdateCheckEnabled(db, true);
      const updates = createUpdates(db, {
        fetchFn: registry(["1.1.0"]).fetchFn,
      });
      await updates.check();
      const status = updates.getStatus();
      assert.equal(status.available, true);
      assert.equal(status.latest, "1.1.0");
      assert.equal(status.checkEnabled, true);
      db.close();
    });
  });

  it("reports a failed check without throwing", async () => {
    const db = openDatabase(":memory:");
    const updates = createUpdates(db, {
      fetchFn: async () => {
        throw new Error("offline");
      },
    });
    await updates.check();
    assert.equal(updates.getStatus().checkError, "offline");
    assert.equal(updates.getStatus().available, false);
    db.close();
  });
});
