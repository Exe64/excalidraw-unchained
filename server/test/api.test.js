import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { io as ioClient } from "socket.io-client";

import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";
import { attachCollab } from "../src/collab.js";
import { openDatabase } from "../src/db.js";

let server;
let baseUrl;

const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "excalidraw",
};

const login = async (username, password) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").split(";")[0];
};

const api = (cookie) => async (method, path, body) => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...HEADERS, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  const db = openDatabase(":memory:");
  await createUser(db, { username: "alice", password: "password-a" });
  await createUser(db, { username: "bob", password: "password-b" });
  server = http.createServer(createApp(db));
  attachCollab(server, db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe("authentication", () => {
  it("rejects anonymous requests", async () => {
    const res = await fetch(`${baseUrl}/api/drawings`);
    assert.equal(res.status, 401);
  });

  it("rejects wrong passwords", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ username: "alice", password: "nope-nope" }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects mutations without the CSRF header", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password-a" }),
    });
    assert.equal(res.status, 403);
  });

  it("logs in and out", async () => {
    const cookie = await login("alice", "password-a");
    const call = api(cookie);
    const me = await call("GET", "/auth/me");
    assert.equal(me.body.user.username, "alice");
    await call("POST", "/auth/logout");
    assert.equal((await call("GET", "/auth/me")).status, 401);
  });

  it("refuses registration by default", async () => {
    const res = await api("")("POST", "/auth/register", {
      username: "eve",
      password: "password-e",
    });
    assert.equal(res.status, 403);
  });
});

describe("drawings", () => {
  it("are private to their owner", async () => {
    const alice = api(await login("alice", "password-a"));
    const bob = api(await login("bob", "password-b"));

    const created = await alice("POST", "/drawings", { name: "Plan" });
    assert.equal(created.status, 201);
    const { id } = created.body.drawing;

    const saved = await alice("PUT", `/drawings/${id}`, {
      name: "Plan v2",
      elements: [{ id: "a", type: "rectangle" }],
      appState: { viewBackgroundColor: "#fff" },
      baseVersion: 1,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.version, 2);

    const loaded = await alice("GET", `/drawings/${id}`);
    assert.equal(loaded.body.drawing.name, "Plan v2");
    assert.deepEqual(loaded.body.drawing.elements, [
      { id: "a", type: "rectangle" },
    ]);

    assert.equal((await bob("GET", `/drawings/${id}`)).status, 404);
    assert.equal((await bob("GET", "/drawings")).body.drawings.length, 0);
    assert.equal((await alice("GET", "/drawings")).body.drawings.length, 1);
  });

  it("detects concurrent modifications", async () => {
    const alice = api(await login("alice", "password-a"));
    const { id } = (await alice("POST", "/drawings", {})).body.drawing;
    const first = await alice("PUT", `/drawings/${id}`, {
      elements: [],
      appState: {},
      baseVersion: 1,
    });
    assert.equal(first.status, 200);
    const stale = await alice("PUT", `/drawings/${id}`, {
      elements: [],
      appState: {},
      baseVersion: 1,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.version, 2);
  });

  it("renames, duplicates and deletes", async () => {
    const alice = api(await login("alice", "password-a"));
    const { id } = (await alice("POST", "/drawings", { name: "A" })).body
      .drawing;
    await alice("PATCH", `/drawings/${id}`, { name: "B" });
    const copy = await alice("POST", `/drawings/${id}/duplicate`);
    assert.equal(copy.body.drawing.name, "B (copie)");
    assert.equal((await alice("DELETE", `/drawings/${id}`)).status, 200);
    assert.equal((await alice("GET", `/drawings/${id}`)).status, 404);
  });
});

describe("files", () => {
  it("stores image files per user", async () => {
    const alice = api(await login("alice", "password-a"));
    const bob = api(await login("bob", "password-b"));
    const file = { mimeType: "image/png", dataURL: "data:image/png;base64,AA" };
    assert.equal((await alice("PUT", "/files/abc", file)).status, 200);
    assert.equal(
      (await alice("GET", "/files/abc")).body.dataURL,
      "data:image/png;base64,AA",
    );
    assert.equal((await bob("GET", "/files/abc")).status, 404);
  });
});

describe("collaboration rooms", () => {
  it("uses optimistic concurrency", async () => {
    const alice = api(await login("alice", "password-a"));
    const scene = { sceneVersion: 1, iv: "AAAA", ciphertext: "BBBB" };
    const created = await alice("PUT", "/rooms/room1", {
      ...scene,
      revision: 0,
    });
    assert.equal(created.body.revision, 1);
    const conflict = await alice("PUT", "/rooms/room1", {
      ...scene,
      revision: 0,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.revision, 1);
    assert.equal(conflict.body.ciphertext, "BBBB");
  });

  it("relays socket messages between authenticated members only", async () => {
    const cookie = await login("alice", "password-a");
    const anonymous = ioClient(baseUrl, { transports: ["websocket"] });
    const error = await new Promise((resolve) =>
      anonymous.on("connect_error", resolve),
    );
    assert.equal(error.message, "unauthorized");
    anonymous.close();

    const connect = () =>
      new Promise((resolve) => {
        const socket = ioClient(baseUrl, {
          transports: ["websocket"],
          extraHeaders: { Cookie: cookie },
        });
        socket.on("init-room", () => {
          socket.emit("join-room", "room2");
          resolve(socket);
        });
      });

    const a = await connect();
    const b = await connect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const received = new Promise((resolve) =>
      b.on("client-broadcast", (data, iv) => resolve([data, iv])),
    );
    a.emit("server-broadcast", "room2", Buffer.from([1, 2]), Buffer.from([3]));
    const [data] = await received;
    assert.deepEqual([...new Uint8Array(data)], [1, 2]);
    a.close();
    b.close();
  });
});
