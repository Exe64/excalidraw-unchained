// Two-factor authentication (TOTP) and sign-in through an OpenID Connect
// provider (SSO), against a fake provider.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { getContentSecurityPolicy } from "../src/csp.js";
import { openDatabase } from "../src/db.js";
import { resetSsoState } from "../src/sso.js";
import { totpCode, totpStep } from "../src/totp.js";

let server;
let baseUrl;
let provider;
let providerUrl;
let db;

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

/** a code of the authenticator app, for a time step not used yet */
const nextCode = (secret, offset = 0) =>
  totpCode(secret, (totpStep() + offset) * 30000);

// fake OpenID Connect provider
// -----------------------------------------------------------------------------

/** what the provider says about the next user who signs in */
let nextLogin = null;
let lastAuthorizeParams = null;
let tokenRequests = [];

const createProvider = () =>
  http.createServer(async (req, res) => {
    const url = new URL(req.url, providerUrl);
    const json = (data, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer: providerUrl,
        authorization_endpoint: `${providerUrl}/authorize`,
        token_endpoint: `${providerUrl}/token`,
        userinfo_endpoint: `${providerUrl}/userinfo`,
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      });
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      const params = new URLSearchParams(body);
      tokenRequests.push({
        params,
        authorization: req.headers.authorization,
      });
      if (params.get("code") !== "good-code") {
        return json({ error: "invalid_grant" }, 400);
      }
      const claims = {
        iss: providerUrl,
        aud: config.oidc.clientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        nonce: lastAuthorizeParams.get("nonce"),
        ...nextLogin.idToken,
      };
      const encode = (data) =>
        Buffer.from(JSON.stringify(data)).toString("base64url");
      return json({
        access_token: "access-token",
        token_type: "Bearer",
        id_token: `${encode({ alg: "RS256" })}.${encode(claims)}.signature`,
      });
    }
    if (url.pathname === "/userinfo") {
      return json({ sub: nextLogin.idToken.sub, ...nextLogin.userinfo });
    }
    res.writeHead(404);
    res.end();
  });

/**
 * Goes through the SSO flow like a browser would. `start` is the response of
 * the request that starts it (the sign-in link, or the link request).
 */
const completeFlow = async ({ cookie, link = false, code = "good-code" }) => {
  let authorizeUrl;
  let stateCookie;
  if (link) {
    const res = await fetch(`${baseUrl}/api/auth/sso/link`, {
      method: "POST",
      headers: { ...HEADERS, Cookie: cookie },
    });
    authorizeUrl = (await res.json()).url;
    stateCookie = res.headers.get("set-cookie").split(";")[0];
  } else {
    const res = await fetch(`${baseUrl}/api/auth/sso/login`, {
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    authorizeUrl = res.headers.get("location");
    stateCookie = res.headers.get("set-cookie").split(";")[0];
  }
  const authorize = new URL(authorizeUrl);
  assert.equal(
    authorize.origin + authorize.pathname,
    `${providerUrl}/authorize`,
  );
  lastAuthorizeParams = authorize.searchParams;
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    `${baseUrl}/api/auth/sso/callback`,
  );

  const state = authorize.searchParams.get("state");
  const callback = await fetch(
    `${baseUrl}/api/auth/sso/callback?code=${code}&state=${state}`,
    {
      redirect: "manual",
      headers: { Cookie: [stateCookie, cookie].filter(Boolean).join("; ") },
    },
  );
  const sessionCookie = callback.headers
    .getSetCookie()
    .find((value) => value.startsWith("excalidraw_session="));
  return {
    location: callback.headers.get("location"),
    cookie: sessionCookie ? sessionCookie.split(";")[0] : null,
  };
};

before(async () => {
  provider = createProvider();
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  providerUrl = `http://127.0.0.1:${provider.address().port}`;

  db = openDatabase(":memory:");
  server = http.createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const s of [server, provider]) {
    s.closeAllConnections();
    s.close();
  }
  config.oidc.issuer = "";
  config.oidc.clientId = "";
});

describe("Content-Security-Policy", () => {
  it("blocks third parties unless web embeds are allowed", () => {
    const blocked = getContentSecurityPolicy({ webEmbedsEnabled: false });
    const allowed = getContentSecurityPolicy({ webEmbedsEnabled: true });
    assert.doesNotMatch(blocked, /https:(?!\/\/)/);
    assert.match(allowed, /frame-src [^;]*https:(?!\/\/)/);
    // embeds never open up what the app itself can send out
    assert.doesNotMatch(allowed, /connect-src [^;]*https:(?!\/\/)/);
  });
});

describe("two-factor authentication", () => {
  let admin;
  let secret;
  let recoveryCodes;

  it("is set up from the account, and asked for at sign-in", async () => {
    admin = (
      await request("POST", "/auth/setup", {
        username: "admin",
        password: "admin-password",
      })
    ).cookie;

    const setup = await request("POST", "/auth/2fa/setup", {}, admin);
    assert.equal(setup.status, 200);
    secret = setup.body.secret;
    assert.match(setup.body.uri, /^otpauth:\/\/totp\/.*secret=/);

    const wrong = await request(
      "POST",
      "/auth/2fa/enable",
      { ticket: setup.body.ticket, code: "000000" },
      admin,
    );
    assert.equal(wrong.status, 400);

    const enable = await request(
      "POST",
      "/auth/2fa/enable",
      { ticket: setup.body.ticket, code: nextCode(secret) },
      admin,
    );
    assert.equal(enable.status, 200);
    assert.equal(enable.body.user.twoFactorEnabled, true);
    assert.equal(enable.body.recoveryCodes.length, 10);
    recoveryCodes = enable.body.recoveryCodes;

    // the password alone isn't enough anymore
    const login = await request("POST", "/auth/login", {
      username: "admin",
      password: "admin-password",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.twoFactor, "verify");
    assert.equal(login.cookie, null);

    const badCode = await request("POST", "/auth/login/2fa", {
      ticket: login.body.ticket,
      code: "123456",
    });
    assert.equal(badCode.status, 401);

    const ok = await request("POST", "/auth/login/2fa", {
      ticket: login.body.ticket,
      code: nextCode(secret, 1),
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.cookie);
    assert.equal(ok.body.user.username, "admin");

    // the ticket can't be used twice, nor the code
    const replay = await request("POST", "/auth/login", {
      username: "admin",
      password: "admin-password",
    });
    const replayed = await request("POST", "/auth/login/2fa", {
      ticket: replay.body.ticket,
      code: nextCode(secret, 1),
    });
    assert.equal(replayed.status, 401);
  });

  it("accepts each recovery code once", async () => {
    const signIn = async (code) => {
      const login = await request("POST", "/auth/login", {
        username: "admin",
        password: "admin-password",
      });
      return request("POST", "/auth/login/2fa", {
        ticket: login.body.ticket,
        code,
      });
    };
    assert.equal((await signIn(recoveryCodes[0].toUpperCase())).status, 200);
    assert.equal((await signIn(recoveryCodes[0])).status, 401);
    const me = await request("GET", "/auth/me", undefined, admin);
    assert.equal(me.body.user.recoveryCodesLeft, 9);
  });

  it("lets administrators require it", async () => {
    // a user without two-factor authentication, signed in
    await request(
      "POST",
      "/admin/users",
      { username: "bob", password: "bob-password" },
      admin,
    );
    const bob = (
      await request("POST", "/auth/login", {
        username: "bob",
        password: "bob-password",
      })
    ).cookie;
    assert.equal(
      (await request("GET", "/auth/me", undefined, bob)).status,
      200,
    );

    const policy = await request(
      "PUT",
      "/admin/settings",
      { twoFactorPolicy: "all" },
      admin,
    );
    assert.equal(policy.status, 200);
    assert.equal(policy.body.twoFactorPolicy, "all");

    // bob is signed out, and sets it up at his next sign-in
    assert.equal(
      (await request("GET", "/auth/me", undefined, bob)).status,
      401,
    );
    const login = await request("POST", "/auth/login", {
      username: "bob",
      password: "bob-password",
    });
    assert.equal(login.body.twoFactor, "setup");
    assert.equal(login.cookie, null);
    const done = await request("POST", "/auth/login/2fa", {
      ticket: login.body.ticket,
      code: nextCode(login.body.secret),
    });
    assert.equal(done.status, 200);
    assert.ok(done.cookie);
    assert.equal(done.body.user.twoFactorEnabled, true);
    assert.equal(done.body.recoveryCodes.length, 10);

    // and can't disable it while it's required
    const disable = await request(
      "POST",
      "/auth/2fa/disable",
      { code: done.body.recoveryCodes[0] },
      done.cookie,
    );
    assert.equal(disable.status, 403);

    // an administrator can reset it (lost phone)
    const users = (await request("GET", "/admin/users", undefined, admin)).body
      .users;
    const bobId = users.find((user) => user.username === "bob").id;
    assert.equal(
      users.find((user) => user.username === "bob").twoFactorEnabled,
      true,
    );
    await request("POST", `/admin/users/${bobId}/reset-2fa`, {}, admin);
    const again = await request("POST", "/auth/login", {
      username: "bob",
      password: "bob-password",
    });
    assert.equal(again.body.twoFactor, "setup");

    await request(
      "PUT",
      "/admin/settings",
      { twoFactorPolicy: "optional" },
      admin,
    );
  });

  it("can't be required by an administrator who doesn't use it", async () => {
    await request(
      "POST",
      "/admin/users",
      { username: "carol", password: "carol-password", isAdmin: true },
      admin,
    );
    const carol = (
      await request("POST", "/auth/login", {
        username: "carol",
        password: "carol-password",
      })
    ).cookie;
    const res = await request(
      "PUT",
      "/admin/settings",
      { twoFactorPolicy: "admins" },
      carol,
    );
    assert.equal(res.status, 400);
  });

  it("can be disabled with a code", async () => {
    const res = await request(
      "POST",
      "/auth/2fa/disable",
      { code: recoveryCodes[1] },
      admin,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.user.twoFactorEnabled, false);
    const login = await request("POST", "/auth/login", {
      username: "admin",
      password: "admin-password",
    });
    assert.ok(login.cookie);
  });
});

describe("SSO (OpenID Connect)", () => {
  beforeEach(() => {
    resetSsoState();
    tokenRequests = [];
    Object.assign(config.oidc, {
      issuer: providerUrl,
      clientId: "excalidraw",
      clientSecret: "s3cret",
      name: "Authentik",
      newUsers: "active",
      adminGroup: "",
    });
  });

  it("is advertised on the sign-in screen", async () => {
    const res = await request("GET", "/auth/config");
    assert.deepEqual(res.body.sso, { name: "Authentik" });
  });

  it("creates the account of a new user", async () => {
    nextLogin = {
      idToken: { sub: "user-1", preferred_username: "Élodie Martin" },
      userinfo: {},
    };
    const { location, cookie } = await completeFlow({});
    assert.equal(location, "/");
    assert.ok(cookie);
    const me = await request("GET", "/auth/me", undefined, cookie);
    assert.equal(me.body.user.username, "Elodie-Martin");
    assert.equal(me.body.user.hasPassword, false);
    assert.equal(me.body.user.ssoLinked, true);

    // the client authenticated with its secret, and PKCE
    const [{ params, authorization }] = tokenRequests;
    assert.equal(
      authorization,
      `Basic ${Buffer.from("excalidraw:s3cret").toString("base64")}`,
    );
    assert.ok(params.get("code_verifier"));

    // next time, the same account
    const again = await completeFlow({});
    const me2 = await request("GET", "/auth/me", undefined, again.cookie);
    assert.equal(me2.body.user.id, me.body.user.id);
  });

  it("follows the registration mode, unless told otherwise", async () => {
    config.oidc.newUsers = "registration";
    nextLogin = { idToken: { sub: "user-2", preferred_username: "dave" } };
    // registrations are closed
    assert.equal((await completeFlow({})).location, "/?sso_error=closed");

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('registration_mode', 'approval')",
    ).run();
    const pending = await completeFlow({});
    assert.equal(pending.location, "/?sso_error=pending");
    assert.equal(pending.cookie, null);
    db.prepare("DELETE FROM settings WHERE key = 'registration_mode'").run();
  });

  it("never takes over a local account with the same name", async () => {
    nextLogin = { idToken: { sub: "user-3", preferred_username: "bob" } };
    const res = await completeFlow({});
    assert.equal(res.location, "/?sso_error=taken");
    assert.equal(res.cookie, null);
  });

  it("links a local account, which can then sign in through SSO", async () => {
    const bob = (
      await request("POST", "/auth/login", {
        username: "carol",
        password: "carol-password",
      })
    ).cookie;
    nextLogin = { idToken: { sub: "carol-at-idp", preferred_username: "c" } };
    const link = await completeFlow({ cookie: bob, link: true });
    assert.equal(link.location, "/?sso=linked");

    const sso = await completeFlow({});
    const me = await request("GET", "/auth/me", undefined, sso.cookie);
    assert.equal(me.body.user.username, "carol");
    assert.equal(me.body.user.ssoLinked, true);

    // can be unlinked, since carol has a password
    const unlink = await request("DELETE", "/auth/sso/link", undefined, bob);
    assert.equal(unlink.status, 200);
  });

  it("keeps accounts without password linked", async () => {
    nextLogin = { idToken: { sub: "user-1" } };
    const { cookie } = await completeFlow({});
    const res = await request("DELETE", "/auth/sso/link", undefined, cookie);
    assert.equal(res.status, 400);
  });

  it("gives administrator rights to a group", async () => {
    config.oidc.adminGroup = "excalidraw-admins";
    nextLogin = {
      idToken: { sub: "user-4", preferred_username: "erin" },
      userinfo: { groups: ["staff", "excalidraw-admins"] },
    };
    const { cookie } = await completeFlow({});
    const me = await request("GET", "/auth/me", undefined, cookie);
    assert.equal(me.body.user.isAdmin, true);

    nextLogin.userinfo.groups = ["staff"];
    const again = await completeFlow({});
    const me2 = await request("GET", "/auth/me", undefined, again.cookie);
    assert.equal(me2.body.user.isAdmin, false);
  });

  it("rejects a callback that doesn't match the flow", async () => {
    nextLogin = { idToken: { sub: "user-1" } };
    // the provider refuses the code
    const bad = await completeFlow({ code: "bad-code" });
    assert.equal(bad.location, "/?sso_error=failed");

    // the state cookie is missing (started in another browser)
    const start = await fetch(`${baseUrl}/api/auth/sso/login`, {
      redirect: "manual",
    });
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    );
    const res = await fetch(
      `${baseUrl}/api/auth/sso/callback?code=good-code&state=${state}`,
      { redirect: "manual" },
    );
    assert.equal(res.headers.get("location"), "/?sso_error=expired");

    // an ID token for another client
    nextLogin = { idToken: { sub: "user-1", aud: "someone-else" } };
    assert.equal((await completeFlow({})).location, "/?sso_error=failed");
  });

  it("doesn't ask SSO users for a second factor", async () => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('two_factor_policy', 'all')",
    ).run();
    nextLogin = { idToken: { sub: "user-1" } };
    const { cookie } = await completeFlow({});
    assert.equal(
      (await request("GET", "/auth/me", undefined, cookie)).status,
      200,
    );
    db.prepare("DELETE FROM settings WHERE key = 'two_factor_policy'").run();
  });
});
