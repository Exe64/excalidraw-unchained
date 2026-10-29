/* eslint-disable no-console */
// User management:
//
//   node src/cli.js list
//   node src/cli.js add <username> [--admin]      (password prompted, or $PASSWORD)
//   node src/cli.js passwd <username>             (password prompted, or $PASSWORD)
//   node src/cli.js approve <username>            (account waiting for approval)
//   node src/cli.js delete <username>             (also deletes their drawings)
//   node src/cli.js reset-2fa <username>          (lost authenticator app)

import readline from "node:readline";

import {
  createUser,
  deleteUserSessions,
  getUserByUsername,
  setUserPassword,
} from "./auth.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { disableTotp } from "./totp.js";

const askPassword = async () => {
  if (process.env.PASSWORD) {
    return process.env.PASSWORD;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // hide what's being typed
  rl._writeToOutput = (str) => {
    if (str.includes("Password")) {
      process.stdout.write(str);
    }
  };
  const ask = (question) =>
    new Promise((resolve) => rl.question(question, resolve));
  const password = await ask("Password: ");
  process.stdout.write("\n");
  const confirmation = await ask("Password (again): ");
  process.stdout.write("\n");
  rl.close();
  if (password !== confirmation) {
    throw new Error("Passwords don't match.");
  }
  return password;
};

const usage = () => {
  console.log(
    "Usage: cli.js list | add <username> [--admin] | passwd <username> | approve <username> | delete <username> | reset-2fa <username>",
  );
  process.exit(1);
};

const main = async () => {
  const [command, username, ...flags] = process.argv.slice(2);
  const db = openDatabase(config.dataDir);

  const requireUser = () => {
    const user = username && getUserByUsername(db, username);
    if (!user) {
      throw new Error(`Unknown user "${username}".`);
    }
    return user;
  };

  switch (command) {
    case "list": {
      const rows = db
        .prepare(
          `SELECT users.username, users.is_admin, users.status, users.created_at,
             users.totp_secret IS NOT NULL AS totp,
             EXISTS (SELECT 1 FROM user_identities
                     WHERE user_id = users.id) AS sso,
             (SELECT COUNT(*) FROM drawings WHERE owner_id = users.id) AS drawings
           FROM users ORDER BY users.created_at`,
        )
        .all();
      console.table(
        rows.map((row) => ({
          username: row.username,
          admin: !!row.is_admin,
          status: row.status,
          "2fa": !!row.totp,
          sso: !!row.sso,
          drawings: row.drawings,
          created: new Date(row.created_at).toISOString(),
        })),
      );
      break;
    }
    case "approve": {
      const user = requireUser();
      db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(
        user.id,
      );
      console.log(`User "${user.username}" approved.`);
      break;
    }
    case "add": {
      if (!username) {
        usage();
      }
      await createUser(db, {
        username,
        password: await askPassword(),
        isAdmin: flags.includes("--admin"),
      });
      console.log(`User "${username}" created.`);
      break;
    }
    case "passwd": {
      const user = requireUser();
      await setUserPassword(db, user.id, await askPassword());
      deleteUserSessions(db, user.id);
      console.log(`Password of "${user.username}" updated.`);
      break;
    }
    case "delete": {
      const user = requireUser();
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      console.log(`User "${user.username}" deleted.`);
      break;
    }
    case "reset-2fa": {
      const user = requireUser();
      disableTotp(db, user.id);
      console.log(`Two-factor authentication of "${user.username}" disabled.`);
      break;
    }
    default:
      usage();
  }
  db.close();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
