import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { applyPendingRestore } from "../src/backups.js";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";

let server;
let baseUrl;
let restarts = 0;

const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "excalidraw",
};

const request = async (method, path, body, cookie) => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookieHeader = res.headers.get("set-cookie");
  return {
    status: res.status,
    body: await res.json(),
    cookie: cookieHeader ? cookieHeader.split(";")[0] : null,
  };
};

const login = (username, password) =>
  request("POST", "/auth/login", { username, password });

before(async () => {
  // a brand new instance, without any account
  config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-test-"));
  server = http.createServer(
    createApp(openDatabase(":memory:"), {
      requestRestart: () => restarts++,
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(config.dataDir, { recursive: true, force: true });
});

describe("registration and administration", () => {
  let admin;

  it("creates the administrator account on first launch, once", async () => {
    const config = await request("GET", "/auth/config");
    assert.equal(config.body.needsSetup, true);
    assert.equal(config.body.registrationMode, "closed");

    const setup = await request("POST", "/auth/setup", {
      username: "admin",
      password: "admin-password",
    });
    assert.equal(setup.status, 201);
    assert.equal(setup.body.user.isAdmin, true);
    admin = setup.cookie;

    const again = await request("POST", "/auth/setup", {
      username: "intruder",
      password: "intruder-password",
    });
    assert.equal(again.status, 403);
    assert.equal((await request("GET", "/auth/config")).body.needsSetup, false);
  });

  it("refuses sign-ups while registration is closed", async () => {
    const res = await request("POST", "/auth/register", {
      username: "alice",
      password: "alice-password",
    });
    assert.equal(res.status, 403);
  });

  it("lets users sign up, pending an administrator's approval", async () => {
    const settings = await request(
      "PUT",
      "/admin/settings",
      { registrationMode: "approval" },
      admin,
    );
    assert.equal(settings.body.registrationMode, "approval");
    assert.equal(
      (await request("GET", "/auth/config")).body.allowRegistration,
      true,
    );

    const registered = await request("POST", "/auth/register", {
      username: "alice",
      password: "alice-password",
    });
    assert.equal(registered.status, 202);
    assert.equal(registered.cookie, null);

    const pending = await login("alice", "alice-password");
    assert.equal(pending.status, 403);
    assert.equal(pending.body.code, "pending");

    const users = (await request("GET", "/admin/users", undefined, admin)).body
      .users;
    assert.equal(users[0].username, "alice");
    assert.equal(users[0].status, "pending");

    await request("POST", `/admin/users/${users[0].id}/approve`, {}, admin);
    const approved = await login("alice", "alice-password");
    assert.equal(approved.status, 200);

    // regular users can't administrate
    const forbidden = await request(
      "GET",
      "/admin/users",
      undefined,
      approved.cookie,
    );
    assert.equal(forbidden.status, 403);
  });

  it("lets administrators manage accounts", async () => {
    const created = await request(
      "POST",
      "/admin/users",
      { username: "bob", password: "bob-password" },
      admin,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.user.status, "active");
    const bobId = created.body.user.id;
    const bob = (await login("bob", "bob-password")).cookie;

    // password reset logs the user out
    await request(
      "PATCH",
      `/admin/users/${bobId}`,
      { password: "new-bob-password" },
      admin,
    );
    assert.equal(
      (await request("GET", "/auth/me", undefined, bob)).status,
      401,
    );
    assert.equal((await login("bob", "new-bob-password")).status, 200);

    const promoted = await request(
      "PATCH",
      `/admin/users/${bobId}`,
      { isAdmin: true },
      admin,
    );
    assert.equal(promoted.body.user.isAdmin, true);

    await request("DELETE", `/admin/users/${bobId}`, undefined, admin);
    assert.equal((await login("bob", "new-bob-password")).status, 401);
  });

  it("never leaves the instance without an administrator", async () => {
    const me = (await request("GET", "/auth/me", undefined, admin)).body.user;
    const deleteSelf = await request(
      "DELETE",
      `/admin/users/${me.id}`,
      undefined,
      admin,
    );
    assert.equal(deleteSelf.status, 400);
    const demoteSelf = await request(
      "PATCH",
      `/admin/users/${me.id}`,
      { isAdmin: false },
      admin,
    );
    assert.equal(demoteSelf.status, 400);
  });

  it("backs up and restores the database", async () => {
    const created = await request("POST", "/admin/backups", {}, admin);
    assert.equal(created.status, 201);
    const { name } = created.body.backup;
    assert.match(name, /^excalidraw-\d{8}-\d{6}-manual\.sqlite$/);

    const listed = (await request("GET", "/admin/backups", undefined, admin))
      .body;
    assert.equal(listed.backups[0].name, name);
    assert.equal(listed.intervalHours, 24);

    const download = await fetch(`${baseUrl}/api/admin/backups/${name}`, {
      headers: { Cookie: admin },
    });
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 15).toString(), "SQLite format 3");

    // invalid uploads are rejected
    const invalid = await fetch(`${baseUrl}/api/admin/restore`, {
      method: "POST",
      headers: {
        Cookie: admin,
        "Content-Type": "application/octet-stream",
        "X-Requested-With": "excalidraw",
      },
      body: Buffer.from("not a database"),
    });
    assert.equal(invalid.status, 400);
    assert.equal(restarts, 0);

    // a valid one is staged, and applied at the next start
    const restored = await fetch(`${baseUrl}/api/admin/restore`, {
      method: "POST",
      headers: {
        Cookie: admin,
        "Content-Type": "application/octet-stream",
        "X-Requested-With": "excalidraw",
      },
      body: bytes,
    });
    assert.equal(restored.status, 200);
    assert.equal(restarts, 1);
    assert.ok(
      (await request("GET", "/admin/backups", undefined, admin)).body.backups
        .map((backup) => backup.name)
        .some((backupName) => backupName.includes("before-restore")),
    );
    assert.equal(applyPendingRestore(config.dataDir), true);
    assert.ok(fs.existsSync(path.join(config.dataDir, "excalidraw.sqlite")));
    assert.equal(applyPendingRestore(config.dataDir), false);

    // other users can't
    await request(
      "PUT",
      "/admin/settings",
      { registrationMode: "approval" },
      admin,
    );
    const createdCarol = await request(
      "POST",
      "/admin/users",
      {
        username: "carol",
        password: "carol-password",
      },
      admin,
    );
    assert.equal(createdCarol.status, 201);
    const carol = (await login("carol", "carol-password")).cookie;
    assert.equal(
      (await request("GET", "/admin/backups", undefined, carol)).status,
      403,
    );
  });
});
