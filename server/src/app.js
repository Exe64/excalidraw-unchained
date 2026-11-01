import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import express from "express";

import {
  clearSessionCookie,
  createSession,
  countUsers,
  createTicket,
  createUser,
  deleteSession,
  deleteTicket,
  deleteUserSessions,
  getDummyHash,
  getLoginRetryAfter,
  getSessionToken,
  getSessionUser,
  getTicket,
  getUserById,
  getUserByUsername,
  hasPassword,
  registerFailedLogin,
  registerTicketFailure,
  resetLoginAttempts,
  setSessionCookie,
  setUserPassword,
  toPublicUser,
  verifyPassword,
} from "./auth.js";
import { diagramToCodeHandler, getAiInfo, textToDiagramHandler } from "./ai.js";
import { registerAdminRoutes } from "./admin.js";
import { registerDrawingRoutes } from "./drawingRoutes.js";
import { config } from "./config.js";
import { getContentSecurityPolicy } from "./csp.js";
import { transaction } from "./db.js";
import {
  getRegistrationMode,
  getWebEmbedsEnabled,
  isTwoFactorRequired,
} from "./settings.js";
import { isSsoEnabled, isUserLinked, registerSsoRoutes } from "./sso.js";
import {
  checkSecondFactor,
  countRecoveryCodes,
  disableTotp,
  enableTotp,
  generateRecoveryCodes,
  generateTotpSecret,
  getOtpAuthUri,
  verifyTotp,
} from "./totp.js";
import { createMcpRouter } from "./mcp.js";
import {
  createApiToken,
  deleteApiToken,
  getApiTokenUser,
  getBearerToken,
  listApiTokens,
} from "./tokens.js";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const BLOB_KINDS = new Set(["rooms", "shareLinks"]);
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const isSameOrigin = (req) => {
  const origin = req.get("Origin");
  if (!origin) {
    return false;
  }
  try {
    const host = req.get("X-Forwarded-Host") || req.get("Host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

const assertId = (...ids) => {
  for (const id of ids) {
    if (typeof id !== "string" || !ID_RE.test(id)) {
      throw new HttpError(400, "Identifiant invalide.");
    }
  }
};

/**
 * @param opts.requestRestart called to restart the server (e.g. to restore a
 * backup); by default the process stops and its supervisor (Docker) starts it
 * again
 */
export const createApp = (db, opts = {}) => {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: config.maxBodySize }));
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Mutating requests must carry a custom header. Browsers won't send one
    // cross-origin without a CORS preflight (which we never allow), so this
    // protects cookie-authenticated endpoints against CSRF.
    // (requests authenticated with an API token in the Authorization header
    // aren't exposed to CSRF: browsers never add that header on their own;
    // the editor's AI features can't add the custom header, they're checked
    // against their Origin instead)
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-Requested-With") !== "excalidraw" &&
      !getBearerToken(req) &&
      !isSameOrigin(req)
    ) {
      return next(new HttpError(403, "Requête refusée."));
    }
    next();
  });

  // authentication
  // ---------------------------------------------------------------------------

  const authenticate = (req, res, next) => {
    const bearer = getBearerToken(req);
    const user = bearer
      ? getApiTokenUser(db, bearer)
      : getSessionUser(db, getSessionToken(req));
    if (!user) {
      return next(new HttpError(401, "Authentification requise."));
    }
    req.user = user;
    req.authMethod = bearer ? "token" : "session";
    next();
  };

  /** for actions that must not be possible with an API token */
  const requireSession = (req, res, next) => {
    if (req.authMethod !== "session") {
      return next(new HttpError(403, "Action réservée à l'application."));
    }
    next();
  };

  api.get("/auth/config", (req, res) => {
    const registrationMode = getRegistrationMode(db);
    res.json({
      registrationMode,
      allowRegistration: registrationMode !== "closed",
      // no account yet: the first one to be created is the administrator
      needsSetup: countUsers(db) === 0,
      // sign-in through an OpenID Connect provider
      sso: isSsoEnabled() ? { name: config.oidc.name } : null,
      webEmbedsEnabled: getWebEmbedsEnabled(db),
    });
  });

  api.post("/auth/setup", async (req, res) => {
    const { username, password } = req.body || {};
    const user = await (async () => {
      if (countUsers(db) > 0) {
        throw new HttpError(403, "L'application est déjà configurée.");
      }
      try {
        return await createUser(db, { username, password, isAdmin: true });
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    })();
    setSessionCookie(req, res, createSession(db, user.id));
    res.status(201).json({ user: toPublicUser(user) });
  });

  /** the signed-in user, with what "My account" shows */
  const getAccount = (user) => ({
    ...toPublicUser(user),
    ssoLinked: isUserLinked(db, user.id),
    twoFactorRequired: isTwoFactorRequired(db, user),
    recoveryCodesLeft: user.totp_secret ? countRecoveryCodes(db, user.id) : 0,
  });

  api.get("/auth/me", authenticate, (req, res) => {
    res.json({ user: getAccount(req.user) });
  });

  api.post("/auth/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") {
      throw new HttpError(400, "Identifiants manquants.");
    }
    const throttleKey = `${req.ip}|${username.toLowerCase()}`;
    const retryAfter = getLoginRetryAfter(throttleKey);
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      throw new HttpError(
        429,
        "Trop de tentatives de connexion. Réessayez plus tard.",
      );
    }

    const user = getUserByUsername(db, username);
    const valid = await verifyPassword(
      password,
      user ? user.password_hash : await getDummyHash(),
    );
    if (!user || !valid) {
      registerFailedLogin(throttleKey);
      throw new HttpError(401, "Nom d'utilisateur ou mot de passe incorrect.");
    }
    resetLoginAttempts(throttleKey);

    if (user.status === "pending") {
      throw new HttpError(
        403,
        "Votre compte attend la validation d'un administrateur.",
        { code: "pending" },
      );
    }

    // second step: a code of the authenticator app...
    if (user.totp_secret) {
      return res.json({
        twoFactor: "verify",
        ticket: createTicket({ kind: "verify", userId: user.id }),
      });
    }
    // ...which has to be set up first if it's required
    if (isTwoFactorRequired(db, user)) {
      const secret = generateTotpSecret();
      return res.json({
        twoFactor: "setup",
        ticket: createTicket({ kind: "setup", userId: user.id, secret }),
        secret,
        uri: getOtpAuthUri(secret, user.username),
      });
    }

    setSessionCookie(req, res, createSession(db, user.id));
    res.json({ user: getAccount(user) });
  });

  /** second step of the sign-in, see /auth/login */
  api.post("/auth/login/2fa", (req, res) => {
    const { ticket: ticketId, code } = req.body || {};
    const ticket = getTicket(ticketId);
    const user = ticket && getUserById(db, ticket.userId);
    if (
      !user ||
      user.status !== "active" ||
      !["verify", "setup"].includes(ticket.kind)
    ) {
      throw new HttpError(401, "La connexion a expiré, recommencez.", {
        code: "expired",
      });
    }
    const throttleKey = `2fa|${user.id}`;
    const retryAfter = getLoginRetryAfter(throttleKey);
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      throw new HttpError(
        429,
        "Trop de tentatives de connexion. Réessayez plus tard.",
      );
    }

    let recoveryCodes;
    if (ticket.kind === "verify") {
      if (!checkSecondFactor(db, user, code)) {
        registerFailedLogin(throttleKey);
        registerTicketFailure(ticketId);
        throw new HttpError(401, "Code incorrect.", { code: "invalid_code" });
      }
    } else {
      const step = verifyTotp(ticket.secret, code);
      if (step === null) {
        registerFailedLogin(throttleKey);
        registerTicketFailure(ticketId);
        throw new HttpError(401, "Code incorrect.", { code: "invalid_code" });
      }
      recoveryCodes = enableTotp(db, user.id, ticket.secret, step);
    }
    deleteTicket(ticketId);
    resetLoginAttempts(throttleKey);
    setSessionCookie(req, res, createSession(db, user.id));
    res.json({ user: getAccount(getUserById(db, user.id)), recoveryCodes });
  });

  api.post("/auth/register", async (req, res) => {
    if (getRegistrationMode(db) === "closed") {
      throw new HttpError(403, "Les inscriptions sont désactivées.");
    }
    const throttleKey = `register|${req.ip}`;
    if (getLoginRetryAfter(throttleKey)) {
      throw new HttpError(
        429,
        "Trop de demandes d'inscription. Réessayez plus tard.",
      );
    }
    registerFailedLogin(throttleKey);
    const { username, password } = req.body || {};
    try {
      // the account can be used once an administrator approves it
      await createUser(db, {
        username,
        password,
        isAdmin: false,
        status: "pending",
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    res.status(202).json({ pending: true });
  });

  api.post("/auth/logout", (req, res) => {
    deleteSession(db, getSessionToken(req));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  api.post("/auth/password", authenticate, requireSession, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!hasPassword(req.user)) {
      throw new HttpError(
        400,
        "Ce compte se connecte par SSO et n'a pas de mot de passe.",
      );
    }
    if (
      typeof currentPassword !== "string" ||
      !(await verifyPassword(currentPassword, req.user.password_hash))
    ) {
      throw new HttpError(400, "Le mot de passe actuel est incorrect.");
    }
    try {
      await setUserPassword(db, req.user.id, newPassword);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    // log out every other device
    deleteUserSessions(db, req.user.id, getSessionToken(req));
    res.json({ ok: true });
  });

  // two-factor authentication, from "My account"
  // ---------------------------------------------------------------------------

  /** a new secret, to scan in an authenticator app */
  api.post("/auth/2fa/setup", authenticate, requireSession, (req, res) => {
    const secret = generateTotpSecret();
    res.json({
      ticket: createTicket({ kind: "enroll", userId: req.user.id, secret }),
      secret,
      uri: getOtpAuthUri(secret, req.user.username),
    });
  });

  /** enables it once the app gives the right code */
  api.post("/auth/2fa/enable", authenticate, requireSession, (req, res) => {
    const { ticket: ticketId, code } = req.body || {};
    const ticket = getTicket(ticketId);
    if (!ticket || ticket.kind !== "enroll" || ticket.userId !== req.user.id) {
      throw new HttpError(400, "La configuration a expiré, recommencez.");
    }
    const step = verifyTotp(ticket.secret, code);
    if (step === null) {
      registerTicketFailure(ticketId);
      throw new HttpError(400, "Code incorrect.");
    }
    deleteTicket(ticketId);
    const recoveryCodes = enableTotp(db, req.user.id, ticket.secret, step);
    res.json({
      user: getAccount(getUserById(db, req.user.id)),
      recoveryCodes,
    });
  });

  const requireSecondFactor = (req) => {
    const throttleKey = `2fa|${req.user.id}`;
    if (getLoginRetryAfter(throttleKey)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    }
    if (!checkSecondFactor(db, req.user, req.body?.code)) {
      registerFailedLogin(throttleKey);
      throw new HttpError(400, "Code incorrect.");
    }
    resetLoginAttempts(throttleKey);
  };

  api.post("/auth/2fa/disable", authenticate, requireSession, (req, res) => {
    if (!req.user.totp_secret) {
      return res.json({ user: getAccount(req.user) });
    }
    if (isTwoFactorRequired(db, req.user)) {
      throw new HttpError(
        403,
        "La double authentification est obligatoire pour votre compte.",
      );
    }
    requireSecondFactor(req);
    disableTotp(db, req.user.id);
    res.json({ user: getAccount(getUserById(db, req.user.id)) });
  });

  api.post(
    "/auth/2fa/recovery-codes",
    authenticate,
    requireSession,
    (req, res) => {
      if (!req.user.totp_secret) {
        throw new HttpError(
          400,
          "La double authentification n'est pas activée.",
        );
      }
      requireSecondFactor(req);
      res.json({ recoveryCodes: generateRecoveryCodes(db, req.user.id) });
    },
  );

  registerSsoRoutes(api, { db, HttpError, authenticate, requireSession });

  // everything below requires an authenticated user
  api.use(authenticate);

  registerAdminRoutes(api, {
    db,
    HttpError,
    requireSession,
    requestRestart:
      opts.requestRestart ??
      (() => setTimeout(() => process.kill(process.pid, "SIGTERM"), 500)),
  });
  registerDrawingRoutes(api, { db, HttpError });

  // AI features of the editor
  // ---------------------------------------------------------------------------

  api.get("/ai/config", (req, res) => {
    res.json(getAiInfo());
  });
  api.post(
    "/ai/v1/ai/text-to-diagram/chat-streaming",
    requireSession,
    textToDiagramHandler,
  );
  api.post(
    "/ai/v1/ai/diagram-to-code/generate-streaming",
    requireSession,
    diagramToCodeHandler,
  );

  // personal access tokens (for MCP clients, scripts…)
  // ---------------------------------------------------------------------------

  api.get("/tokens", requireSession, (req, res) => {
    res.json({ tokens: listApiTokens(db, req.user.id) });
  });

  api.post("/tokens", requireSession, (req, res) => {
    let result;
    try {
      result = createApiToken(db, req.user.id, req.body?.name);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    res.status(201).json(result);
  });

  api.delete("/tokens/:id", requireSession, (req, res) => {
    assertId(req.params.id);
    if (!deleteApiToken(db, req.user.id, req.params.id)) {
      throw new HttpError(404, "Jeton introuvable.");
    }
    res.json({ ok: true });
  });

  // personal library
  // ---------------------------------------------------------------------------

  api.get("/library", (req, res) => {
    const row = db
      .prepare("SELECT data FROM libraries WHERE owner_id = ?")
      .get(req.user.id);
    res.json({ library: row ? JSON.parse(row.data) : null });
  });

  api.put("/library", (req, res) => {
    const data = req.body || {};
    if (!Array.isArray(data.libraryItems)) {
      throw new HttpError(400, "Bibliothèque invalide.");
    }
    db.prepare(
      `INSERT INTO libraries (owner_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (owner_id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at`,
    ).run(req.user.id, JSON.stringify(data), Date.now());
    res.json({ ok: true });
  });

  // end-to-end encrypted collaboration scenes
  // ---------------------------------------------------------------------------

  const toStoredScene = (row) => ({
    sceneVersion: row.scene_version,
    iv: Buffer.from(row.iv).toString("base64"),
    ciphertext: Buffer.from(row.ciphertext).toString("base64"),
    revision: row.revision,
  });

  api.get("/rooms/:id", (req, res) => {
    assertId(req.params.id);
    const row = db
      .prepare("SELECT * FROM rooms WHERE id = ?")
      .get(req.params.id);
    if (!row) {
      throw new HttpError(404, "Salle introuvable.");
    }
    res.json(toStoredScene(row));
  });

  api.put("/rooms/:id", (req, res) => {
    assertId(req.params.id);
    const { sceneVersion, iv, ciphertext, revision } = req.body || {};
    if (
      typeof sceneVersion !== "number" ||
      typeof iv !== "string" ||
      typeof ciphertext !== "string" ||
      typeof revision !== "number"
    ) {
      throw new HttpError(400, "Scène invalide.");
    }
    const nextRevision = transaction(db, () => {
      const row = db
        .prepare("SELECT * FROM rooms WHERE id = ?")
        .get(req.params.id);
      const currentRevision = row ? row.revision : 0;
      // optimistic concurrency: the client must have reconciled its scene
      // with the latest stored one
      if (revision !== currentRevision) {
        throw new HttpError(
          409,
          "La scène a été modifiée.",
          row ? toStoredScene(row) : { revision: 0 },
        );
      }
      db.prepare(
        `INSERT INTO rooms (id, scene_version, iv, ciphertext, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           scene_version = excluded.scene_version, iv = excluded.iv,
           ciphertext = excluded.ciphertext, revision = excluded.revision,
           updated_at = excluded.updated_at`,
      ).run(
        req.params.id,
        sceneVersion,
        Buffer.from(iv, "base64"),
        Buffer.from(ciphertext, "base64"),
        currentRevision + 1,
        Date.now(),
      );
      return currentRevision + 1;
    });
    res.json({ revision: nextRevision });
  });

  // end-to-end encrypted shareable links
  // ---------------------------------------------------------------------------

  const rawBody = express.raw({
    type: "application/octet-stream",
    limit: config.maxBodySize,
  });

  api.post("/share", rawBody, (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new HttpError(400, "Contenu invalide.");
    }
    const id = crypto.randomBytes(12).toString("base64url");
    db.prepare(
      "INSERT INTO share_links (id, owner_id, data, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, req.user.id, req.body, Date.now());
    res.status(201).json({ id });
  });

  api.get("/share/:id", (req, res) => {
    assertId(req.params.id);
    const row = db
      .prepare("SELECT data FROM share_links WHERE id = ?")
      .get(req.params.id);
    if (!row) {
      throw new HttpError(404, "Lien introuvable.");
    }
    res.type("application/octet-stream").send(Buffer.from(row.data));
  });

  // encrypted image files of collab rooms and share links
  // ---------------------------------------------------------------------------

  const getBlobPrefix = (req) => {
    const { kind, parentId, fileId } = req.params;
    if (!BLOB_KINDS.has(kind)) {
      throw new HttpError(404, "Introuvable.");
    }
    assertId(parentId, fileId);
    return `${kind}/${parentId}`;
  };

  api.get("/blobs/:kind/:parentId/:fileId", (req, res) => {
    const prefix = getBlobPrefix(req);
    const row = db
      .prepare("SELECT data FROM blobs WHERE prefix = ? AND id = ?")
      .get(prefix, req.params.fileId);
    if (!row) {
      throw new HttpError(404, "Fichier introuvable.");
    }
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("application/octet-stream").send(Buffer.from(row.data));
  });

  api.put("/blobs/:kind/:parentId/:fileId", rawBody, (req, res) => {
    const prefix = getBlobPrefix(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new HttpError(400, "Contenu invalide.");
    }
    if (req.params.kind === "shareLinks") {
      const link = db
        .prepare("SELECT owner_id FROM share_links WHERE id = ?")
        .get(req.params.parentId);
      if (!link || link.owner_id !== req.user.id) {
        throw new HttpError(403, "Accès refusé.");
      }
    }
    // file ids are content hashes: the first upload wins, so a room member
    // can't replace an image that others already uploaded
    db.prepare(
      `INSERT OR IGNORE INTO blobs (prefix, id, owner_id, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(prefix, req.params.fileId, req.user.id, req.body, Date.now());
    res.json({ ok: true });
  });

  api.use((req, res, next) => next(new HttpError(404, "Introuvable.")));

  app.use("/api", api);
  app.use("/mcp", createMcpRouter(db));

  // frontend
  // ---------------------------------------------------------------------------

  if (config.staticDir) {
    const indexHtml = path.join(config.staticDir, "index.html");
    app.use((req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        getContentSecurityPolicy({ webEmbedsEnabled: getWebEmbedsEnabled(db) }),
      );
      next();
    });
    app.use(
      express.static(config.staticDir, {
        index: false,
        setHeaders: (res, filePath) => {
          const relative = path.relative(config.staticDir, filePath);
          if (/^(assets|fonts)[\\/]/.test(relative)) {
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable",
            );
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get(/^(?!\/(api|mcp|socket\.io)(\/|$)).*/, (req, res, next) => {
      if (!fs.existsSync(indexHtml)) {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  // errors
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Contenu trop volumineux." });
    }
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON invalide." });
    }
    const status = error.status || 500;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({
      error: status >= 500 ? "Erreur interne du serveur." : error.message,
      ...error.extra,
    });
  });

  return app;
};

export const authenticateSocketRequest = (db, req) =>
  getSessionUser(db, getSessionToken(req));
