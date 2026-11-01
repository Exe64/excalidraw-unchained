import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { listBackups } from "../src/backups.js";
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
      const status = await updates.getStatus();
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
    const status = await updates.getStatus();
    assert.equal(status.checkError, "offline");
    assert.equal(status.available, false);
    db.close();
  });

  describe("installing", () => {
    /** a registry offering 1.1.0, and an updater */
    const setup = async ({ refuse = false } = {}) => {
      const db = openDatabase(":memory:");
      const updaterCalls = [];
      const { fetchFn: registryFetch } = registry(["1.1.0"]);
      const updates = createUpdates(db, {
        fetchFn: async (url, init) => {
          if (!url.startsWith(config.update.updaterUrl)) {
            return registryFetch(url, init);
          }
          updaterCalls.push(`${init.method} ${url}`);
          return refuse
            ? new Response('{"error":"nope"}', { status: 500 })
            : json({ state: "running" });
        },
      });
      await updates.check();
      return { db, updates, updaterCalls };
    };

    const withUpdater = (test) =>
      withVersion("1.0.0", async () => {
        const dataDir = config.dataDir;
        config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "updates-"));
        config.update.updaterSecret = "secret";
        try {
          await test();
        } finally {
          config.update.updaterSecret = "";
          config.dataDir = dataDir;
        }
      });

    it("needs the updater service", async () => {
      await withVersion("1.0.0", async () => {
        const { db, updates } = await setup();
        await assert.rejects(updates.install("1.1.0"), /pas activé/);
        db.close();
      });
    });

    it("only installs the available version", async () => {
      await withUpdater(async () => {
        const { db, updates, updaterCalls } = await setup();
        await assert.rejects(updates.install("9.9.9"), /plus à installer/);
        assert.equal(listBackups().length, 0);
        assert.deepEqual(updaterCalls, []);
        db.close();
      });
    });

    it("backs up first, and tells everyone", async () => {
      await withUpdater(async () => {
        const { db, updates, updaterCalls } = await setup();
        assert.equal(updates.getPublicStatus("u").installing, false);
        await updates.install("1.1.0");
        assert.match(listBackups()[0].name, /before-update/);
        assert.ok(updaterCalls.at(-1).startsWith("POST"));
        assert.equal(updates.getPublicStatus("u").installing, true);
        await assert.rejects(updates.install("1.1.0"), /déjà en cours/);
        db.close();
      });
    });

    it("doesn't start if the backup fails", async () => {
      await withUpdater(async () => {
        const { db, updates, updaterCalls } = await setup();
        db.close();
        await assert.rejects(updates.install("1.1.0"), /pas démarré/);
        assert.deepEqual(updaterCalls, []);
        assert.equal(updates.getPublicStatus("u").installing, false);
      });
    });

    it("reports an updater that refuses", async () => {
      await withUpdater(async () => {
        const { db, updates } = await setup({ refuse: true });
        await assert.rejects(updates.install("1.1.0"), /nope/);
        assert.equal(updates.getPublicStatus("u").installing, false);
        db.close();
      });
    });
  });

  it("counts the other connected people", async () => {
    const db = openDatabase(":memory:");
    const updates = createUpdates(db);
    updates.getPublicStatus("admin");
    updates.getPublicStatus("a");
    updates.getPublicStatus("b");
    assert.equal((await updates.getStatus("admin")).otherUsers, 2);
    db.close();
  });
});
