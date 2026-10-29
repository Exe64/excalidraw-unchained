import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";
import { openDatabase } from "../src/db.js";
import { TRASH_RETENTION_MS, purgeTrash } from "../src/drawings.js";
import { SNAPSHOT_INTERVAL_MS } from "../src/versions.js";

let server;
let baseUrl;
let db;
const cookies = {};

const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "excalidraw",
};

const as =
  (user) =>
  async (method, path, body, extraHeaders = {}) => {
    const isBinary = body instanceof Uint8Array;
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { ...HEADERS, Cookie: cookies[user], ...extraHeaders },
      body:
        body === undefined ? undefined : isBinary ? body : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") || "";
    return {
      status: res.status,
      type,
      body: type.includes("json") ? await res.json() : await res.arrayBuffer(),
    };
  };

const alice = as("alice");
const bob = as("bob");

const rect = (id, version = 1, extra = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version,
  ...extra,
});

const save = async (call, id, elements, extra = {}) => {
  const { body } = await call("GET", `/drawings/${id}`);
  return call("PUT", `/drawings/${id}`, {
    name: body.drawing.name,
    elements,
    appState: {},
    baseVersion: body.drawing.version,
    ...extra,
  });
};

before(async () => {
  db = openDatabase(":memory:");
  for (const name of ["alice", "bob", "carol"]) {
    await createUser(db, { username: name, password: `password-${name}` });
  }
  server = http.createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const name of ["alice", "bob"]) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ username: name, password: `password-${name}` }),
    });
    cookies[name] = res.headers.get("set-cookie").split(";")[0];
  }
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe("trash", () => {
  it("keeps deleted drawings until they're restored or purged", async () => {
    const { id } = (await alice("POST", "/drawings", { name: "Old" })).body
      .drawing;
    await alice("DELETE", `/drawings/${id}`);
    assert.equal((await alice("GET", `/drawings/${id}`)).status, 404);
    const trash = (await alice("GET", "/trash")).body.drawings;
    assert.equal(trash[0].id, id);
    assert.ok(trash[0].purgeAt > Date.now());

    await alice("POST", `/trash/${id}/restore`);
    assert.equal((await alice("GET", `/drawings/${id}`)).status, 200);

    await alice("DELETE", `/drawings/${id}`);
    db.prepare("UPDATE drawings SET deleted_at = ? WHERE id = ?").run(
      Date.now() - TRASH_RETENTION_MS - 1000,
      id,
    );
    assert.equal(purgeTrash(db), 1);
    assert.equal((await alice("GET", "/trash")).body.drawings.length, 0);
  });

  it("can be emptied", async () => {
    for (const name of ["A", "B"]) {
      const { id } = (await alice("POST", "/drawings", { name })).body.drawing;
      await alice("DELETE", `/drawings/${id}`);
    }
    assert.equal((await alice("DELETE", "/trash")).body.deleted, 2);
  });
});

describe("version history", () => {
  it("keeps previous states and restores them", async () => {
    const { id } = (await alice("POST", "/drawings", { name: "Plan" })).body
      .drawing;
    await save(alice, id, [rect("a")]);
    // the first state worth keeping is stored on the next save
    await save(alice, id, [rect("a", 2), rect("b")]);
    let versions = (await alice("GET", `/drawings/${id}/versions`)).body
      .versions;
    assert.equal(versions.length, 1);
    assert.equal(versions[0].elementCount, 1);

    // automatic snapshots are throttled…
    await save(alice, id, [rect("a", 3), rect("b")]);
    assert.equal(
      (await alice("GET", `/drawings/${id}/versions`)).body.versions.length,
      1,
    );
    // …but not manual ones
    await alice("POST", `/drawings/${id}/versions`);
    versions = (await alice("GET", `/drawings/${id}/versions`)).body.versions;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].reason, "manual");

    const oldest = versions.at(-1);
    const content = (
      await alice("GET", `/drawings/${id}/versions/${oldest.id}`)
    ).body.version;
    assert.deepEqual(
      content.elements.map((element) => element.id),
      ["a"],
    );

    const restored = (
      await alice("POST", `/drawings/${id}/versions/${oldest.id}/restore`)
    ).body.drawing;
    const byId = Object.fromEntries(
      restored.elements.map((element) => [element.id, element]),
    );
    // restored elements win over the current ones when merged
    assert.ok(byId.a.version > 3);
    assert.equal(byId.b.isDeleted, true);
    // the state before the restore is still in the history (here it's the
    // manual version, so it isn't duplicated)
    versions = (await alice("GET", `/drawings/${id}/versions`)).body.versions;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].elementCount, 2);

    // with changes since the last version, the restore keeps them first
    await save(alice, id, [rect("a", 9), rect("c")]);
    await alice("POST", `/drawings/${id}/versions/${oldest.id}/restore`);
    versions = (await alice("GET", `/drawings/${id}/versions`)).body.versions;
    assert.equal(versions[0].reason, "before-restore");
  });

  it("takes a new automatic snapshot after the interval", async () => {
    const { id } = (await alice("POST", "/drawings", {})).body.drawing;
    await save(alice, id, [rect("a")]);
    await save(alice, id, [rect("a", 2)]);
    db.prepare("UPDATE drawing_versions SET created_at = ?").run(
      Date.now() - SNAPSHOT_INTERVAL_MS - 1000,
    );
    await save(alice, id, [rect("a", 3)]);
    assert.equal(
      (await alice("GET", `/drawings/${id}/versions`)).body.versions.length,
      2,
    );
  });
});

describe("sharing", () => {
  it("gives other users read or write access", async () => {
    const { id } = (await alice("POST", "/drawings", { name: "Shared" })).body
      .drawing;
    await save(alice, id, [rect("a")]);
    assert.equal((await bob("GET", `/drawings/${id}`)).status, 404);

    const unknown = await alice("PUT", `/drawings/${id}/shares`, {
      username: "nobody",
      role: "view",
    });
    assert.equal(unknown.status, 404);

    await alice("PUT", `/drawings/${id}/shares`, {
      username: "bob",
      role: "view",
    });
    const listed = (await bob("GET", "/drawings")).body.drawings.find(
      (drawing) => drawing.id === id,
    );
    assert.equal(listed.role, "view");
    assert.equal(listed.ownerUsername, "alice");

    // read-only
    assert.equal((await save(bob, id, [rect("b")])).status, 403);
    assert.equal(
      (await bob("PATCH", `/drawings/${id}`, { name: "Mine" })).status,
      403,
    );

    await alice("PUT", `/drawings/${id}/shares`, {
      username: "bob",
      role: "edit",
    });
    assert.equal((await save(bob, id, [rect("a"), rect("b")])).status, 200);
    // editors can't rename
    const drawing = (await alice("GET", `/drawings/${id}`)).body.drawing;
    assert.equal(drawing.name, "Shared");
    assert.equal(drawing.elements.length, 2);

    // nor manage shares
    assert.equal((await bob("GET", `/drawings/${id}/shares`)).status, 403);
    const shares = (await alice("GET", `/drawings/${id}/shares`)).body.shares;
    assert.deepEqual(
      shares.map((share) => [share.username, share.role]),
      [["bob", "edit"]],
    );

    // "deleting" a shared drawing only removes it from the recipient's list
    await bob("DELETE", `/drawings/${id}`);
    assert.equal((await bob("GET", `/drawings/${id}`)).status, 404);
    assert.equal((await alice("GET", `/drawings/${id}`)).status, 200);
  });

  it("gives access to the images added by the drawing's users", async () => {
    const { id } = (await alice("POST", "/drawings", {})).body.drawing;
    await alice("PUT", "/files/img1", {
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AA",
    });
    await alice("PUT", `/drawings/${id}/shares`, {
      username: "bob",
      role: "view",
    });
    assert.equal((await bob("GET", "/files/img1")).status, 404);
    assert.equal((await bob("GET", `/files/img1?drawing=${id}`)).status, 200);
  });
});

describe("organization", () => {
  it("moves drawings into folders and marks favorites", async () => {
    const folder = (await alice("POST", "/folders", { name: "Clients" })).body
      .folder;
    const { id } = (
      await alice("POST", "/drawings", {
        name: "In folder",
        folderId: folder.id,
      })
    ).body.drawing;
    let listed = (await alice("GET", "/drawings")).body.drawings.find(
      (drawing) => drawing.id === id,
    );
    assert.equal(listed.folderId, folder.id);
    assert.equal(
      (await alice("GET", "/folders")).body.folders[0].drawingCount,
      1,
    );

    await alice("PUT", `/drawings/${id}/favorite`, { favorite: true });
    await alice("PATCH", `/folders/${folder.id}`, { name: "Customers" });
    await alice("DELETE", `/folders/${folder.id}`);
    listed = (await alice("GET", "/drawings")).body.drawings.find(
      (drawing) => drawing.id === id,
    );
    assert.equal(listed.folderId, null);
    assert.equal(listed.favorite, true);

    // other users' folders are out of reach
    const bobFolder = (await bob("POST", "/folders", { name: "Bob" })).body
      .folder;
    assert.equal(
      (await alice("PATCH", `/drawings/${id}`, { folderId: bobFolder.id }))
        .status,
      404,
    );
  });

  it("stores previews", async () => {
    const { id } = (await alice("POST", "/drawings", {})).body.drawing;
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const put = await alice("PUT", `/drawings/${id}/thumbnail`, png, {
      "Content-Type": "image/png",
    });
    assert.equal(put.status, 200);
    const listed = (await alice("GET", "/drawings")).body.drawings.find(
      (drawing) => drawing.id === id,
    );
    assert.ok(listed.thumbnailUpdatedAt);
    const got = await alice("GET", `/drawings/${id}/thumbnail`);
    assert.equal(got.type, "image/png");
    assert.deepEqual([...new Uint8Array(got.body)], [...png]);
    assert.equal((await bob("GET", `/drawings/${id}/thumbnail`)).status, 404);
  });
});
