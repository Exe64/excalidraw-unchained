// Instance settings, changed by administrators from the app.

import { config } from "./config.js";

/**
 * - "closed": no sign-up, administrators create the accounts
 * - "approval": anyone can sign up, an administrator approves the account
 */
export const REGISTRATION_MODES = ["closed", "approval"];

const getSetting = (db, key) =>
  db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;

const setSetting = (db, key, value) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);

export const getRegistrationMode = (db) => {
  const mode = getSetting(db, "registration_mode");
  if (REGISTRATION_MODES.includes(mode)) {
    return mode;
  }
  // until an administrator chooses, ALLOW_REGISTRATION decides
  return config.allowRegistration ? "approval" : "closed";
};

export const setRegistrationMode = (db, mode) => {
  if (!REGISTRATION_MODES.includes(mode)) {
    throw new Error(`Mode d'inscription inconnu : ${mode}`);
  }
  setSetting(db, "registration_mode", mode);
};
