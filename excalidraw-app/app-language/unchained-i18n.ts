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
  "auth.registerTitle": "Request an account",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.passwordConfirm": "Confirm password",
  "auth.signIn": "Sign in",
  "auth.signUp": "Request an account",
  "auth.toSignUp": "No account yet? Request one",
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
  "drawings.opsApplied":
    "Changes made through the API (AI assistant) were applied.",
  "drawings.opsFailed":
    "Some changes made through the API couldn't be applied: {{error}}",
  "auth.setupTitle": "Create the administrator account",
  "auth.setupHint":
    "Welcome! This first account will administer the application: it manages registrations and the other accounts.",
  "auth.setupSubmit": "Create the account",
  "auth.registerHint":
    "Your account will be usable once an administrator approves it.",
  "auth.registered":
    "Request sent. You'll be able to sign in once an administrator approves your account.",
  "auth.pending": "Your account is waiting for an administrator's approval.",
  "admin.title": "Administration",
  "admin.menu": "Administration",
  "admin.registration": "Registrations",
  "admin.modeClosed": "Closed",
  "admin.modeClosedHint":
    "Nobody can sign up: administrators create the accounts below.",
  "admin.modeApproval": "Open, with approval",
  "admin.modeApprovalHint":
    "Anyone can request an account from the sign-in screen; an administrator approves or rejects each request.",
  "admin.pending": "Waiting for approval",
  "admin.users": "Accounts",
  "admin.createUser": "Create an account",
  "admin.create": "Create",
  "admin.approve": "Approve",
  "admin.reject": "Reject",
  "admin.isAdmin": "Administrator",
  "admin.adminBadge": "admin",
  "admin.you": "you",
  "admin.userMeta": "Created {{date}} · {{count}} drawing(s)",
  "admin.resetPassword": "Reset password",
  "admin.newPassword": "New password",
  "admin.save": "Save",
  "admin.cancel": "Cancel",
  "admin.delete": "Delete the account",
  "admin.deleteConfirm":
    'Delete the account "{{name}}" and all its drawings? This can\'t be undone.',
  "api.title": "API access (MCP)",
  "api.intro":
    "Access tokens let an AI assistant such as Claude, or a script, read and create your drawings through the MCP server of this instance. A token gives access to all your drawings: keep it secret and revoke it when you no longer need it.",
  "api.tokenName": "Token name",
  "api.create": "Create a token",
  "api.tokenOnce": "Copy your token now: it won't be shown again.",
  "api.token": "Token",
  "api.claudeCode": "Claude Code (terminal)",
  "api.connector":
    "Connector URL (Claude app, claude.ai: Settings > Connectors > Add custom connector)",
  "api.connectorHint":
    "This URL contains the token: don't share it. claude.ai connectors require the instance to be reachable from the Internet over HTTPS.",
  "api.jsonConfig": "Other MCP clients (JSON configuration)",
  "api.copy": "Copy",
  "api.copied": "Copied",
  "api.tokens": "Your tokens",
  "api.noTokens": "No token yet.",
  "api.created": "Created {{date}}",
  "api.lastUsed": "last used {{date}}",
  "api.never": "never",
  "api.revoke": "Revoke",
  "api.revokeConfirm":
    'Revoke the token "{{name}}"? Assistants using it will lose access.',
  "welcome.heading": "Your drawings are saved on the server.",
  "welcome.heading_line2": 'Find them all in "My drawings", from any device.',
};

type Key = keyof typeof en;

const fr: Partial<Record<Key, string>> = {
  "auth.title": "Connectez-vous pour continuer",
  "auth.registerTitle": "Demander un compte",
  "auth.username": "Nom d'utilisateur",
  "auth.password": "Mot de passe",
  "auth.passwordConfirm": "Confirmer le mot de passe",
  "auth.signIn": "Se connecter",
  "auth.signUp": "Demander un compte",
  "auth.toSignUp": "Pas encore de compte ? En demander un",
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
  "drawings.opsApplied":
    "Les modifications faites via l'API (assistant IA) ont été appliquées.",
  "drawings.opsFailed":
    "Certaines modifications faites via l'API n'ont pas pu être appliquées : {{error}}",
  "auth.setupTitle": "Créer le compte administrateur",
  "auth.setupHint":
    "Bienvenue ! Ce premier compte administrera l'application : il gère les inscriptions et les autres comptes.",
  "auth.setupSubmit": "Créer le compte",
  "auth.registerHint":
    "Votre compte sera utilisable une fois validé par un administrateur.",
  "auth.registered":
    "Demande envoyée. Vous pourrez vous connecter dès qu'un administrateur aura validé votre compte.",
  "auth.pending": "Votre compte attend la validation d'un administrateur.",
  "admin.title": "Administration",
  "admin.menu": "Administration",
  "admin.registration": "Inscriptions",
  "admin.modeClosed": "Fermées",
  "admin.modeClosedHint":
    "Personne ne peut s'inscrire : les administrateurs créent les comptes ci-dessous.",
  "admin.modeApproval": "Ouvertes, avec validation",
  "admin.modeApprovalHint":
    "Chacun peut demander un compte depuis l'écran de connexion ; un administrateur valide ou refuse chaque demande.",
  "admin.pending": "En attente de validation",
  "admin.users": "Comptes",
  "admin.createUser": "Créer un compte",
  "admin.create": "Créer",
  "admin.approve": "Valider",
  "admin.reject": "Refuser",
  "admin.isAdmin": "Administrateur",
  "admin.adminBadge": "admin",
  "admin.you": "vous",
  "admin.userMeta": "Créé le {{date}} · {{count}} dessin(s)",
  "admin.resetPassword": "Réinitialiser le mot de passe",
  "admin.newPassword": "Nouveau mot de passe",
  "admin.save": "Enregistrer",
  "admin.cancel": "Annuler",
  "admin.delete": "Supprimer le compte",
  "admin.deleteConfirm":
    "Supprimer le compte « {{name}} » et tous ses dessins ? Cette action est irréversible.",
  "api.title": "Accès API (MCP)",
  "api.intro":
    "Les jetons d'accès permettent à un assistant IA comme Claude, ou à un script, de lire et de créer vos dessins via le serveur MCP de cette instance. Un jeton donne accès à tous vos dessins : gardez-le secret et révoquez-le dès qu'il ne sert plus.",
  "api.tokenName": "Nom du jeton",
  "api.create": "Créer un jeton",
  "api.tokenOnce": "Copiez votre jeton maintenant : il ne sera plus affiché.",
  "api.token": "Jeton",
  "api.claudeCode": "Claude Code (terminal)",
  "api.connector":
    "URL de connecteur (app Claude, claude.ai : Paramètres > Connecteurs > Ajouter un connecteur personnalisé)",
  "api.connectorHint":
    "Cette URL contient le jeton : ne la partagez pas. Les connecteurs claude.ai exigent que l'instance soit joignable depuis Internet en HTTPS.",
  "api.jsonConfig": "Autres clients MCP (configuration JSON)",
  "api.copy": "Copier",
  "api.copied": "Copié",
  "api.tokens": "Vos jetons",
  "api.noTokens": "Aucun jeton pour l'instant.",
  "api.created": "Créé {{date}}",
  "api.lastUsed": "dernière utilisation {{date}}",
  "api.never": "jamais",
  "api.revoke": "Révoquer",
  "api.revokeConfirm":
    "Révoquer le jeton « {{name}} » ? Les assistants qui l'utilisent perdront l'accès.",
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
