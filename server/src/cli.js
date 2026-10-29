/* eslint-disable no-console */
// User management:
//
//   node src/cli.js list
//   node src/cli.js add <username> [--admin]      (password prompted, or $PASSWORD)
//   node src/cli.js passwd <username>             (password prompted, or $PASSWORD)
//   node src/cli.js delete <username>             (also deletes their drawings)

import readline from "node:readline";

import {
  createUser,
  deleteUserSessions,
  getUserByUsername,
  setUserPassword,
} from "./auth.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";

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
    "Usage: cli.js list | add <username> [--admin] | passwd <username> | delete <username>",
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
          `SELECT users.username, users.is_admin, users.created_at,
             (SELECT COUNT(*) FROM drawings WHERE owner_id = users.id) AS drawings
           FROM users ORDER BY users.created_at`,
        )
        .all();
      console.table(
        rows.map((row) => ({
          username: row.username,
          admin: !!row.is_admin,
          drawings: row.drawings,
          created: new Date(row.created_at).toISOString(),
        })),
      );
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
    default:
      usage();
  }
  db.close();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
