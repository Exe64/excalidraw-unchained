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
  /** version of this image (X.Y.Z for a release), see the Dockerfile */
  version: process.env.APP_VERSION || "dev",
  update: {
    /** image of the releases: a public image, in a registry */
    image: process.env.UPDATE_IMAGE || "ghcr.io/exe64/excalidraw-unchained",
    /** the service that installs updates (see docker-compose.yml), used when
     * UPDATER_SECRET is set */
    updaterUrl: process.env.UPDATER_URL || "http://updater:3006",
    updaterSecret: process.env.UPDATER_SECRET || "",
  },
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
  /** sign-in through an OpenID Connect provider (Authentik, Keycloak,
   * Authelia, Google, Microsoft Entra ID…), next to local accounts. Enabled
   * when OIDC_ISSUER and OIDC_CLIENT_ID are set. */
  oidc: {
    issuer: (process.env.OIDC_ISSUER || "").replace(/\/+$/, ""),
    clientId: process.env.OIDC_CLIENT_ID || "",
    clientSecret: process.env.OIDC_CLIENT_SECRET || "",
    /** label of the sign-in button */
    name: process.env.OIDC_NAME || "SSO",
    scopes: process.env.OIDC_SCOPES || "openid profile email",
    /** claim used as the username of new accounts */
    usernameClaim: process.env.OIDC_USERNAME_CLAIM || "preferred_username",
    /** "registration": new accounts follow the registration mode (closed:
     * refused, approval: waiting for an administrator); "active": created
     * right away (for a provider that only lets your people in) */
    newUsers:
      (process.env.OIDC_NEW_USERS || "").toLowerCase() === "active"
        ? "active"
        : "registration",
    /** members of this group are administrators (checked at each SSO
     * sign-in), empty = administrators are managed in the app */
    adminGroup: process.env.OIDC_ADMIN_GROUP || "",
    groupsClaim: process.env.OIDC_GROUPS_CLAIM || "groups",
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
