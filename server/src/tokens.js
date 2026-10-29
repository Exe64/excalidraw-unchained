import crypto from "node:crypto";

const TOKEN_PREFIX = "exu_";
const MAX_TOKENS_PER_USER = 50;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const toPublicToken = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export const isApiToken = (value) =>
  typeof value === "string" && value.startsWith(TOKEN_PREFIX);

/** returns the token in clear: it's shown once and never stored */
export const createApiToken = (db, userId, name) => {
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ?")
    .get(userId).count;
  if (count >= MAX_TOKENS_PER_USER) {
    throw new Error("Trop de jetons : révoquez-en avant d'en créer un autre.");
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: (typeof name === "string" && name.trim().slice(0, 100)) || "Jeton",
    token_hash: hashToken(token),
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, created_at)
     VALUES (:id, :user_id, :name, :token_hash, :created_at)`,
  ).run(row);
  return { token, apiToken: toPublicToken({ ...row, last_used_at: null }) };
};

export const listApiTokens = (db, userId) =>
  db
    .prepare(
      `SELECT id, name, created_at, last_used_at FROM api_tokens
       WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId)
    .map(toPublicToken);

export const deleteApiToken = (db, userId, id) =>
  db
    .prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?")
    .run(id, userId).changes > 0;

/** the user owning `token`, or null */
export const getApiTokenUser = (db, token) => {
  if (!isApiToken(token)) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT users.*, api_tokens.id AS api_token_id FROM api_tokens
       JOIN users ON users.id = api_tokens.user_id
       WHERE api_tokens.token_hash = ? AND users.status = 'active'`,
    )
    .get(hashToken(token));
  if (!row) {
    return null;
  }
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
    Date.now(),
    row.api_token_id,
  );
  return row;
};

export const getBearerToken = (req) => {
  const header = req.get?.("Authorization") ?? req.headers?.authorization;
  const match = /^Bearer\s+(\S+)$/i.exec(header || "");
  return match ? match[1] : null;
};
