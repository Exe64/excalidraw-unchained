/* eslint-disable no-console */
import http from "node:http";

import { createApp } from "./app.js";
import { countUsers, createUser, purgeExpiredSessions } from "./auth.js";
import { attachCollab } from "./collab.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";

const db = openDatabase(config.dataDir);

// bootstrap the first account from the environment
if (countUsers(db) === 0) {
  if (config.adminUsername && config.adminPassword) {
    await createUser(db, {
      username: config.adminUsername,
      password: config.adminPassword,
      isAdmin: true,
    });
    console.log(`Created admin user "${config.adminUsername}".`);
  } else if (!config.allowRegistration) {
    console.warn(
      "No user exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD, enable " +
        "ALLOW_REGISTRATION, or run `yarn --cwd server users add <username>`.",
    );
  }
}

if (config.ai.provider) {
  if (!config.ai.model) {
    console.warn("AI_PROVIDER is set but AI_MODEL is missing.");
  }
  console.log(
    `AI features: ${config.ai.provider} (${config.ai.model || "no model"})`,
  );
}

const cleanup = () => {
  purgeExpiredSessions(db);
  if (config.roomTtlMs > 0) {
    const threshold = Date.now() - config.roomTtlMs;
    const staleRooms = db
      .prepare("SELECT id FROM rooms WHERE updated_at < ?")
      .all(threshold);
    for (const { id } of staleRooms) {
      db.prepare("DELETE FROM blobs WHERE prefix = ?").run(`rooms/${id}`);
      db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
    }
  }
};
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();

const app = createApp(db);
const server = http.createServer(app);
attachCollab(server, db);

server.listen(config.port, config.host, () => {
  const serving = config.staticDir ? `serving ${config.staticDir}` : "API only";
  console.log(
    `Excalidraw server listening on http://${config.host}:${config.port} (${serving})`,
  );
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
