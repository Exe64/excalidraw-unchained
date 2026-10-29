import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const bool = (value, fallback = false) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const AI_PROVIDERS = {
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  "openai-compatible": "openai",
  mistral: "openai",
  ollama: "openai",
};

const aiProvider = AI_PROVIDERS[(process.env.AI_PROVIDER || "").toLowerCase()];

const defaultStaticDir = path.resolve(__dirname, "../../excalidraw-app/build");

export const config = {
  port: Number(process.env.PORT || 3005),
  host: process.env.HOST || "0.0.0.0",
  dataDir: path.resolve(
    process.env.DATA_DIR || path.join(__dirname, "../data"),
  ),
  /** directory with the built frontend (`yarn build:app:docker`). Optional in
   * development, where Vite serves the frontend and proxies `/api` to us. */
  staticDir: process.env.STATIC_DIR
    ? path.resolve(process.env.STATIC_DIR)
    : fs.existsSync(defaultStaticDir)
    ? defaultStaticDir
    : null,
  allowRegistration: bool(process.env.ALLOW_REGISTRATION, false),
  /** public URL of the instance (e.g. https://draw.example.com), used in the
   * drawing links given to AI assistants. Defaults to the request's host. */
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  adminUsername: process.env.ADMIN_USERNAME || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionTtlMs:
    Number(process.env.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
  /** "auto" sets the Secure flag on the session cookie when the request came
   * over HTTPS (see TRUST_PROXY when running behind a reverse proxy) */
  cookieSecure: process.env.COOKIE_SECURE || "auto",
  trustProxy: process.env.TRUST_PROXY || "loopback",
  maxBodySize: process.env.MAX_BODY_SIZE || "50mb",
  /** encrypted collab scenes / share links not touched for this long are
   * deleted (0 disables the cleanup) */
  roomTtlMs: Number(process.env.ROOM_TTL_DAYS ?? 90) * 24 * 60 * 60 * 1000,
  /** automatic database backups, in DATA_DIR/backups */
  backups: {
    /** 0 disables automatic backups */
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
    /** number of automatic backups kept */
    keep: Number(process.env.BACKUP_KEEP ?? 14),
  },
  /** backend of the editor's AI features ("text to diagram", "wireframe to
   * code"). Disabled unless AI_PROVIDER is set. */
  ai: {
    provider: aiProvider || "",
    apiKey:
      process.env.AI_API_KEY ||
      (aiProvider === "openai" ? process.env.OPENAI_API_KEY : "") ||
      "",
    model:
      process.env.AI_MODEL ||
      (aiProvider === "anthropic" ? "claude-opus-5-5" : ""),
    baseUrl: (
      process.env.AI_BASE_URL ||
      (aiProvider === "openai" ? "https://api.openai.com/v1" : "")
    ).replace(/\/+$/, ""),
    /** Claude only: low | medium | high | xhigh | max */
    effort: process.env.AI_EFFORT || "medium",
    /** per user and per day (the editor shows the remaining count), 0 =
     * unlimited */
    requestsPerDay: Number(process.env.AI_REQUESTS_PER_DAY ?? 200),
  },
};

export const COOKIE_NAME = "excalidraw_session";
