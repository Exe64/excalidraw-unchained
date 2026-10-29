/**
 * Strings of the features added by Excalidraw Unchained (authentication,
 * server-side drawings). Kept separate from the upstream locales (managed on
 * Crowdin) to ease merging upstream changes. Falls back to English.
 */

import { useCallback } from "react";

import { appJotaiStore, useAtomValue } from "../app-jotai";

import { appLangCodeAtom } from "./language-state";

const en = {
  "auth.title": "Sign in to continue",
  "auth.registerTitle": "Create an account",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.passwordConfirm": "Confirm password",
  "auth.signIn": "Sign in",
  "auth.signUp": "Create account",
  "auth.toSignUp": "No account yet? Sign up",
  "auth.toSignIn": "Already have an account? Sign in",
  "auth.passwordMismatch": "Passwords don't match.",
  "auth.invalidCredentials": "Wrong username or password.",
  "auth.tooManyAttempts": "Too many sign-in attempts. Try again later.",
  "auth.sessionExpired":
    "Your session has expired. Sign in again to keep saving your work.",
  "auth.networkError": "Can't reach the server. Check your connection.",
  "auth.signOut": "Sign out",
  "auth.signedInAs": "Signed in as {{username}}",
  "auth.changePassword": "Change password",
  "auth.currentPassword": "Current password",
  "auth.newPassword": "New password",
  "auth.passwordChanged": "Password changed",
  "drawings.title": "My drawings",
  "drawings.new": "New drawing",
  "drawings.open": "Open",
  "drawings.rename": "Rename",
  "drawings.duplicate": "Duplicate",
  "drawings.delete": "Delete",
  "drawings.deleteConfirm": 'Delete "{{name}}"? This can\'t be undone.',
  "drawings.empty": "No drawing yet.",
  "drawings.current": "Current",
  "drawings.updated": "Edited {{date}}",
  "drawings.search": "Search drawings…",
  "drawings.loadError": "Couldn't load the drawing.",
  "drawings.saveError": "Couldn't save to the server. Retrying…",
  "drawings.conflict":
    "This drawing was changed from another tab or device. Changes were merged.",
  "drawings.stopCollabConfirm":
    "Opening another drawing will end the live collaboration session. Continue?",
  "drawings.collabStopKeepCopy":
    "Stopping the session will save a copy of this drawing in your drawings. Continue?",
  "drawings.collabStopSaveCurrent":
    'Stopping the session will save the drawing to "{{name}}". Continue?',
  "drawings.importedCopy": "The shared drawing was added to your drawings.",
  "welcome.heading": "Your drawings are saved on the server.",
  "welcome.heading_line2": 'Find them all in "My drawings", from any device.',
};

type Key = keyof typeof en;

const fr: Partial<Record<Key, string>> = {
  "auth.title": "Connectez-vous pour continuer",
  "auth.registerTitle": "Créer un compte",
  "auth.username": "Nom d'utilisateur",
  "auth.password": "Mot de passe",
  "auth.passwordConfirm": "Confirmer le mot de passe",
  "auth.signIn": "Se connecter",
  "auth.signUp": "Créer le compte",
  "auth.toSignUp": "Pas encore de compte ? S'inscrire",
  "auth.toSignIn": "Déjà un compte ? Se connecter",
  "auth.passwordMismatch": "Les mots de passe ne correspondent pas.",
  "auth.invalidCredentials": "Nom d'utilisateur ou mot de passe incorrect.",
  "auth.tooManyAttempts":
    "Trop de tentatives de connexion. Réessayez plus tard.",
  "auth.sessionExpired":
    "Votre session a expiré. Reconnectez-vous pour continuer à enregistrer votre travail.",
  "auth.networkError":
    "Impossible de joindre le serveur. Vérifiez votre connexion.",
  "auth.signOut": "Se déconnecter",
  "auth.signedInAs": "Connecté en tant que {{username}}",
  "auth.changePassword": "Changer le mot de passe",
  "auth.currentPassword": "Mot de passe actuel",
  "auth.newPassword": "Nouveau mot de passe",
  "auth.passwordChanged": "Mot de passe modifié",
  "drawings.title": "Mes dessins",
  "drawings.new": "Nouveau dessin",
  "drawings.open": "Ouvrir",
  "drawings.rename": "Renommer",
  "drawings.duplicate": "Dupliquer",
  "drawings.delete": "Supprimer",
  "drawings.deleteConfirm":
    "Supprimer « {{name}} » ? Cette action est irréversible.",
  "drawings.empty": "Aucun dessin pour l'instant.",
  "drawings.current": "Ouvert",
  "drawings.updated": "Modifié {{date}}",
  "drawings.search": "Rechercher un dessin…",
  "drawings.loadError": "Impossible de charger le dessin.",
  "drawings.saveError":
    "Impossible d'enregistrer sur le serveur. Nouvelle tentative…",
  "drawings.conflict":
    "Ce dessin a été modifié depuis un autre onglet ou appareil. Les modifications ont été fusionnées.",
  "drawings.stopCollabConfirm":
    "Ouvrir un autre dessin mettra fin à la session de collaboration en direct. Continuer ?",
  "drawings.collabStopKeepCopy":
    "Arrêter la session enregistrera une copie de ce dessin dans vos dessins. Continuer ?",
  "drawings.collabStopSaveCurrent":
    "Arrêter la session enregistrera le dessin dans « {{name}} ». Continuer ?",
  "drawings.importedCopy": "Le dessin partagé a été ajouté à vos dessins.",
  "welcome.heading": "Vos dessins sont enregistrés sur le serveur.",
  "welcome.heading_line2":
    "Retrouvez-les dans « Mes dessins », depuis n'importe quel appareil.",
};

const translate = (
  langCode: string,
  key: Key,
  replacements?: Record<string, string>,
) => {
  const dict = langCode.startsWith("fr") ? fr : {};
  let text: string = dict[key] ?? en[key];
  if (replacements) {
    for (const [name, value] of Object.entries(replacements)) {
      text = text.replaceAll(`{{${name}}}`, value);
    }
  }
  return text;
};

/** non-reactive translation, for use outside of React components */
export const tu = (key: Key, replacements?: Record<string, string>) =>
  translate(appJotaiStore.get(appLangCodeAtom), key, replacements);

export const useUnchainedI18n = () => {
  const langCode = useAtomValue(appLangCodeAtom);
  const t = useCallback(
    (key: Key, replacements?: Record<string, string>) =>
      translate(langCode, key, replacements),
    [langCode],
  );
  return { t, langCode };
};
