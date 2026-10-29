// Sign-in through an OpenID Connect provider (SSO), next to local accounts.
//
// Authorization code flow with PKCE. The ID token comes straight from the
// provider's token endpoint over TLS, authenticated with our client secret,
// so its signature doesn't need to be checked (OpenID Connect Core 3.1.3.7);
// its issuer, audience, expiry and nonce are.

import crypto from "node:crypto";

import {
  createSession,
  createUser,
  getSessionToken,
  getSessionUser,
  getUserById,
  getUserByUsername,
  hasPassword,
  setSessionCookie,
  USERNAME_RE,
} from "./auth.js";
import { config } from "./config.js";
import { getRegistrationMode } from "./settings.js";

const STATE_COOKIE = "excalidraw_sso";
const STATE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10 * 1000;
/** accepted clock difference with the provider */
const CLOCK_SKEW_S = 60;

export const isSsoEnabled = () =>
  !!(config.oidc.issuer && config.oidc.clientId);

class SsoError extends Error {
  /** `code` is shown to the user by the app (see the sso.error* strings) */
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// provider
// -----------------------------------------------------------------------------

let discovery = null;

const getProviderMetadata = async () => {
  if (discovery && discovery.issuer === config.oidc.issuer) {
    if (Date.now() - discovery.fetchedAt < DISCOVERY_TTL_MS) {
      return discovery.metadata;
    }
  }
  const response = await fetch(
    `${config.oidc.issuer}/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
  );
  if (!response.ok) {
    throw new Error(`OpenID discovery failed (HTTP ${response.status})`);
  }
  const metadata = await response.json();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("Incomplete OpenID provider metadata");
  }
  discovery = { issuer: config.oidc.issuer, metadata, fetchedAt: Date.now() };
  return metadata;
};

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

const decodeJwtPayload = (jwt) => {
  const parts = String(jwt).split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed ID token");
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
};

/** checks the ID token's claims (see the note at the top of the file) */
export const validateIdToken = (
  claims,
  { issuer, nonce, now = Date.now() },
) => {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer) {
    throw new Error("ID token: unexpected issuer");
  }
  if (!audiences.includes(config.oidc.clientId)) {
    throw new Error("ID token: unexpected audience");
  }
  if (
    audiences.length > 1 &&
    claims.azp &&
    claims.azp !== config.oidc.clientId
  ) {
    throw new Error("ID token: unexpected authorized party");
  }
  if (
    typeof claims.exp !== "number" ||
    claims.exp + CLOCK_SKEW_S < now / 1000
  ) {
    throw new Error("ID token: expired");
  }
  if (claims.nonce !== nonce) {
    throw new Error("ID token: nonce mismatch");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("ID token: missing subject");
  }
};

const pendingStates = new Map();

/** returns the provider's sign-in URL, and the state to keep in a cookie */
const startFlow = async ({
  redirectUri,
  mode,
  userId = null,
  popup = false,
}) => {
  const metadata = await getProviderMetadata();
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (value.expiresAt <= now) {
      pendingStates.delete(key);
    }
  }
  const state = base64url(crypto.randomBytes(24));
  const nonce = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(32));
  pendingStates.set(state, {
    nonce,
    codeVerifier,
    redirectUri,
    mode,
    userId,
    popup,
    expiresAt: now + STATE_TTL_MS,
  });
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    ...Object.fromEntries(url.searchParams),
    response_type: "code",
    client_id: config.oidc.clientId,
    redirect_uri: redirectUri,
    scope: config.oidc.scopes,
    state,
    nonce,
    code_challenge: base64url(
      crypto.createHash("sha256").update(codeVerifier).digest(),
    ),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state };
};

/** exchanges the authorization code, returns the user's claims */
const finishFlow = async ({ state, code }) => {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.expiresAt <= Date.now()) {
    throw new SsoError("expired");
  }
  if (typeof code !== "string" || !code) {
    throw new SsoError("failed", "Missing authorization code");
  }
  const metadata = await getProviderMetadata();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const { clientId, clientSecret } = config.oidc;
  const authMethods = metadata.token_endpoint_auth_methods_supported || [
    "client_secret_basic",
  ];
  if (clientSecret && authMethods.includes("client_secret_basic")) {
    headers.Authorization = `Basic ${Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }
  }
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.id_token) {
    throw new Error(
      `Token request failed (HTTP ${response.status}${
        tokens.error ? `, ${tokens.error}` : ""
      })`,
    );
  }
  const claims = decodeJwtPayload(tokens.id_token);
  validateIdToken(claims, {
    issuer: metadata.issuer || config.oidc.issuer,
    nonce: pending.nonce,
  });

  // some providers only give the groups or the username through userinfo
  if (metadata.userinfo_endpoint && tokens.access_token) {
    try {
      const userinfo = await fetch(metadata.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (userinfo.ok) {
        const extra = await userinfo.json();
        if (extra.sub === claims.sub) {
          Object.assign(claims, { ...extra, ...claims });
        }
      }
    } catch (error) {
      console.warn("SSO: userinfo request failed:", error.message);
    }
  }
  return {
    claims,
    mode: pending.mode,
    userId: pending.userId,
    popup: pending.popup,
  };
};

// accounts
// -----------------------------------------------------------------------------

/** username of a new account, from the provider's claims */
export const usernameFromClaims = (claims) => {
  const candidates = [
    claims[config.oidc.usernameClaim],
    claims.preferred_username,
    typeof claims.email === "string" ? claims.email.split("@")[0] : null,
    claims.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const username = candidate
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._@-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (USERNAME_RE.test(username)) {
      return username;
    }
  }
  return null;
};

const getGroups = (claims) => {
  const groups = claims[config.oidc.groupsClaim];
  return Array.isArray(groups)
    ? groups.map(String)
    : typeof groups === "string"
    ? groups.split(/[\s,]+/)
    : [];
};

export const getLinkedUser = (db, subject) =>
  db
    .prepare(
      `SELECT users.* FROM user_identities
       JOIN users ON users.id = user_identities.user_id
       WHERE user_identities.issuer = ? AND user_identities.subject = ?`,
    )
    .get(config.oidc.issuer, subject);

export const isUserLinked = (db, userId) =>
  !!db
    .prepare("SELECT 1 FROM user_identities WHERE user_id = ? LIMIT 1")
    .get(userId);

export const linkIdentity = (db, userId, subject) => {
  db.prepare(
    "DELETE FROM user_identities WHERE user_id = ? AND issuer = ?",
  ).run(userId, config.oidc.issuer);
  db.prepare(
    `INSERT INTO user_identities (issuer, subject, user_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(config.oidc.issuer, subject, userId, Date.now());
};

export const unlinkIdentities = (db, userId) => {
  db.prepare("DELETE FROM user_identities WHERE user_id = ?").run(userId);
};

const countActiveAdmins = (db) =>
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND status = 'active'",
    )
    .get().count;

/** with OIDC_ADMIN_GROUP, the provider's groups decide who is administrator */
const syncAdminRights = (db, user, claims) => {
  if (!config.oidc.adminGroup) {
    return user;
  }
  const isAdmin = getGroups(claims).includes(config.oidc.adminGroup);
  if (isAdmin === !!user.is_admin) {
    return user;
  }
  if (!isAdmin && user.status === "active" && countActiveAdmins(db) <= 1) {
    // never lock everyone out of the administration
    return user;
  }
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(
    isAdmin ? 1 : 0,
    user.id,
  );
  return getUserById(db, user.id);
};

/** finds or creates the account of the user who signed in with the provider */
const signIn = async (db, claims) => {
  let user = getLinkedUser(db, claims.sub);
  if (!user) {
    let status = "active";
    if (config.oidc.newUsers !== "active") {
      if (getRegistrationMode(db) === "closed") {
        throw new SsoError("closed");
      }
      status = "pending";
    }
    const username = usernameFromClaims(claims);
    if (!username) {
      throw new SsoError("failed", "No usable username in the claims");
    }
    if (getUserByUsername(db, username)) {
      // never take over a local account: its owner links it from the app
      throw new SsoError("taken");
    }
    const isAdmin =
      !!config.oidc.adminGroup &&
      getGroups(claims).includes(config.oidc.adminGroup);
    user = await createUser(db, {
      username,
      password: null,
      isAdmin,
      status: isAdmin ? "active" : status,
    });
    linkIdentity(db, user.id, claims.sub);
  }
  user = syncAdminRights(db, user, claims);
  if (user.status === "pending") {
    throw new SsoError("pending");
  }
  return user;
};

// routes
// -----------------------------------------------------------------------------

const getPublicUrl = (req) =>
  config.publicUrl || `${req.protocol}://${req.get("host")}`;

const getRedirectUri = (req) => `${getPublicUrl(req)}/api/auth/sso/callback`;

export const registerSsoRoutes = (
  api,
  { db, HttpError, authenticate, requireSession },
) => {
  const setStateCookie = (req, res, state) => {
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      // sent back on the provider's top-level redirection to the callback
      sameSite: "lax",
      secure: req.secure,
      maxAge: STATE_TTL_MS,
      path: "/api/auth/sso",
    });
  };

  const requireSso = (req, res, next) => {
    if (!isSsoEnabled()) {
      return next(new HttpError(404, "Connexion SSO non configurée."));
    }
    next();
  };

  /** starts signing in: the browser navigates here */
  api.get("/auth/sso/login", requireSso, async (req, res) => {
    let flow;
    try {
      flow = await startFlow({
        redirectUri: getRedirectUri(req),
        mode: "login",
        // signing in again from the editor, without leaving it (the app
        // closes the window when it gets ?sso=done)
        popup: req.query.popup === "1",
      });
    } catch (error) {
      console.error("SSO:", error.message);
      return res.redirect(303, "/?sso_error=unavailable");
    }
    setStateCookie(req, res, flow.state);
    res.redirect(303, flow.url);
  });

  /** links the signed-in user's account to their account at the provider */
  api.post(
    "/auth/sso/link",
    requireSso,
    authenticate,
    requireSession,
    async (req, res) => {
      let flow;
      try {
        flow = await startFlow({
          redirectUri: getRedirectUri(req),
          mode: "link",
          userId: req.user.id,
        });
      } catch (error) {
        console.error("SSO:", error.message);
        throw new HttpError(502, "Le fournisseur d'identité est injoignable.");
      }
      setStateCookie(req, res, flow.state);
      res.json({ url: flow.url });
    },
  );

  api.delete("/auth/sso/link", authenticate, requireSession, (req, res) => {
    if (!hasPassword(req.user)) {
      throw new HttpError(
        400,
        "Ce compte n'a pas de mot de passe : sans le SSO, il ne serait plus accessible.",
      );
    }
    unlinkIdentities(db, req.user.id);
    res.json({ ok: true });
  });

  api.get("/auth/sso/callback", async (req, res) => {
    const { state, code, error } = req.query;
    const cookieState = (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${STATE_COOKIE}=`))
      ?.slice(STATE_COOKIE.length + 1);
    res.clearCookie(STATE_COOKIE, { path: "/api/auth/sso" });

    const fail = (code) => res.redirect(303, `/?sso_error=${code}`);
    if (!isSsoEnabled()) {
      return fail("unavailable");
    }
    if (error) {
      // e.g. the user refused, or isn't allowed to use this application
      pendingStates.delete(state);
      return fail(error === "access_denied" ? "denied" : "failed");
    }
    // the state must come back to the browser that started the flow
    if (typeof state !== "string" || !state || state !== cookieState) {
      return fail("expired");
    }

    try {
      const flow = await finishFlow({ state, code });
      if (flow.mode === "link") {
        const current = getSessionUser(db, getSessionToken(req));
        if (!current || current.id !== flow.userId) {
          throw new SsoError("expired");
        }
        const linked = getLinkedUser(db, flow.claims.sub);
        if (linked && linked.id !== current.id) {
          throw new SsoError("linked");
        }
        linkIdentity(db, current.id, flow.claims.sub);
        return res.redirect(303, "/?sso=linked");
      }
      const user = await signIn(db, flow.claims);
      setSessionCookie(req, res, createSession(db, user.id, "sso"));
      res.redirect(303, flow.popup ? "/?sso=done" : "/");
    } catch (error) {
      if (error instanceof SsoError) {
        return fail(error.code);
      }
      console.error("SSO:", error.message);
      fail("failed");
    }
  });
};

/** for tests */
export const resetSsoState = () => {
  discovery = null;
  pendingStates.clear();
};
