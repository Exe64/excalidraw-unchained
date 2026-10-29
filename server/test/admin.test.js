import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

let server;
let baseUrl;

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
  server = http.createServer(createApp(openDatabase(":memory:")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
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
});
