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

/**
 * Who must use two-factor authentication to sign in with a password (signing
 * in through SSO relies on the provider's own security):
 * - "optional": everyone chooses
 * - "admins": required for administrators
 * - "all": required for everyone
 */
export const TWO_FACTOR_POLICIES = ["optional", "admins", "all"];

export const getTwoFactorPolicy = (db) => {
  const policy = getSetting(db, "two_factor_policy");
  return TWO_FACTOR_POLICIES.includes(policy) ? policy : "optional";
};

export const setTwoFactorPolicy = (db, policy) => {
  if (!TWO_FACTOR_POLICIES.includes(policy)) {
    throw new Error(`Règle de double authentification inconnue : ${policy}`);
  }
  setSetting(db, "two_factor_policy", policy);
};

/**
 * Whether drawings can load third-party web embeds (YouTube, Figma…) in the
 * browsers of the people who open them. Off until an administrator allows it.
 */
export const getWebEmbedsEnabled = (db) =>
  getSetting(db, "web_embeds_enabled") === "true";

export const setWebEmbedsEnabled = (db, enabled) =>
  setSetting(db, "web_embeds_enabled", String(enabled));

/** whether `user` (a database row) must use two-factor authentication */
export const isTwoFactorRequired = (db, user) => {
  const policy = getTwoFactorPolicy(db);
  return policy === "all" || (policy === "admins" && !!user.is_admin);
};
