import crypto from "node:crypto";
import { promisify } from "node:util";

import { COOKIE_NAME, config } from "./config.js";

const scrypt = promisify(crypto.scrypt);

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export const USERNAME_RE = /^[a-zA-Z0-9._@-]{2,64}$/;
export const MIN_PASSWORD_LENGTH = 8;

// passwords
// -----------------------------------------------------------------------------

export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const { N, r, p } = SCRYPT_PARAMS;
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r, p });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
};

export const verifyPassword = async (password, stored) => {
  const [algo, N, r, p, salt, hash] = String(stored).split("$");
  if (algo !== "scrypt") {
    return false;
  }
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
    { N: Number(N), r: Number(r), p: Number(p) },
  );
  return crypto.timingSafeEqual(expected, actual);
};

// a hash to compare against when the user doesn't exist, so that response
// times don't reveal which usernames are registered
let dummyHash = null;
export const getDummyHash = async () =>
  (dummyHash ??= await hashPassword(crypto.randomBytes(16).toString("hex")));

// users
// -----------------------------------------------------------------------------

export const toPublicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };

export const validateCredentials = (username, password) => {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "Le nom d'utilisateur doit faire 2 à 64 caractères (lettres, chiffres, . _ @ -).";
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  return null;
};

export const createUser = async (db, { username, password, isAdmin }) => {
  const error = validateCredentials(username, password);
  if (error) {
    throw new Error(error);
  }
  if (getUserByUsername(db, username)) {
    throw new Error(`L'utilisateur "${username}" existe déjà.`);
  }
  const user = {
    id: crypto.randomUUID(),
    username,
    password_hash: await hashPassword(password),
    is_admin: isAdmin ? 1 : 0,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO users (id, username, password_hash, is_admin, created_at)
     VALUES (:id, :username, :password_hash, :is_admin, :created_at)`,
  ).run(user);
  return user;
};

export const getUserByUsername = (db, username) =>
  db.prepare("SELECT * FROM users WHERE username = ?").get(username);

export const setUserPassword = async (db, userId, password) => {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    await hashPassword(password),
    userId,
  );
};

export const countUsers = (db) =>
  db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

// sessions
// -----------------------------------------------------------------------------

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createSession = (db, userId) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(hashToken(token), userId, now, now + config.sessionTtlMs);
  return token;
};

export const getSessionUser = (db, token) => {
  if (!token) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), Date.now());
  return row || null;
};

export const deleteSession = (db, token) => {
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
      hashToken(token),
    );
  }
};

export const deleteUserSessions = (db, userId, exceptToken) => {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(
    userId,
    exceptToken ? hashToken(exceptToken) : "",
  );
};

export const purgeExpiredSessions = (db) => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
};

// cookies
// -----------------------------------------------------------------------------

export const parseCookies = (header) => {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
  }
  return cookies;
};

export const getSessionToken = (req) =>
  parseCookies(req.headers.cookie)[COOKIE_NAME] || null;

const isSecureRequest = (req) =>
  config.cookieSecure === "auto"
    ? !!req.secure
    : ["1", "true", "yes"].includes(config.cookieSecure.toLowerCase());

export const setSessionCookie = (req, res, token) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: config.sessionTtlMs,
    path: "/",
  });
};

export const clearSessionCookie = (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
  });
};

// brute-force protection
// -----------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

/** returns the number of seconds to wait if `key` is currently throttled */
export const getLoginRetryAfter = (key) => {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    return 0;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS
    ? Math.ceil((entry.resetAt - Date.now()) / 1000)
    : 0;
};

export const registerFailedLogin = (key) => {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
  // keep the map from growing unbounded
  if (loginAttempts.size > 10000) {
    for (const [k, v] of loginAttempts) {
      if (v.resetAt <= now) {
        loginAttempts.delete(k);
      }
    }
  }
};

export const resetLoginAttempts = (key) => {
  loginAttempts.delete(key);
};
