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
  "drawings.deleteConfirm":
    'Move "{{name}}" to the trash? You can restore it for 30 days.',
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
  "account.title": "My account",
  "account.menu": "My account",
  "account.passwordChanged": "Your password has been changed.",
  "drawings.back": "Back",
  "drawings.favorite": "Add to favorites",
  "drawings.unfavorite": "Remove from favorites",
  "drawings.actions": "Actions",
  "drawings.moveTo": "Move to…",
  "drawings.share": "Share…",
  "drawings.leave": "Remove from my drawings",
  "drawings.leaveConfirm":
    'Remove "{{name}}" from your drawings? Its owner will have to share it again.',
  "drawings.sharedBy": "Shared by {{name}}",
  "drawings.sharedByReadOnly": "Shared by {{name}} · read only",
  "drawings.all": "All drawings",
  "drawings.favorites": "Favorites",
  "drawings.sharedWithMe": "Shared with me",
  "drawings.noShared": "Nobody has shared a drawing with you yet.",
  "drawings.noFavorites":
    "No favorite yet. Click the star of a drawing to find it here.",
  "drawings.readOnly":
    'Read only: "{{name}}" was shared with you by {{owner}}.',
  "folders.title": "Folders",
  "folders.new": "New folder",
  "folders.rename": "Rename the folder",
  "folders.delete": "Delete the folder",
  "folders.deleteConfirm":
    'Delete the folder "{{name}}"? Its drawings are kept and moved out of it.',
  "folders.empty": "No folder yet.",
  "folders.none": "No folder",
  "trash.title": "Trash",
  "trash.hint":
    "Deleted drawings are kept 30 days before being permanently deleted.",
  "trash.none": "The trash is empty.",
  "trash.empty": "Empty the trash",
  "trash.emptyConfirm":
    "Permanently delete all the drawings in the trash? This can't be undone.",
  "trash.restore": "Restore",
  "trash.deleteForever": "Delete permanently",
  "trash.deleteForeverConfirm":
    'Permanently delete "{{name}}"? This can\'t be undone.',
  "trash.purgedOn": "Deleted permanently on {{date}}",
  "share.title": 'Share "{{name}}"',
  "share.hint":
    "Give other users of this instance access to this drawing. Editors can change it; readers can only look at it.",
  "share.username": "Username",
  "share.roleEdit": "Can edit",
  "share.roleView": "Can view",
  "share.add": "Share",
  "share.none": "This drawing isn't shared yet.",
  "share.remove": "Stop sharing",
  "history.title": 'Version history · "{{name}}"',
  "history.menu": "Version history",
  "history.saveNow": "Save a version now",
  "history.hint":
    "A version is saved automatically every 10 minutes of editing, and before each restore.",
  "history.none": "No version yet.",
  "history.reasonManual": "Saved manually",
  "history.reasonBeforeRestore": "Before a restore",
  "history.reasonApi": "Before an API change",
  "history.reasonAuto": "Automatic",
  "history.elements": "{{count}} element(s)",
  "history.emptyVersion": "This version is empty.",
  "history.previewError": "Couldn't display this version.",
  "history.selectVersion": "Select a version to preview it.",
  "history.restoreHint":
    "The current state is saved as a version before restoring.",
  "history.restoreConfirm":
    "Restore this version? The current state will be saved in the history first.",
  "history.restore": "Restore this version",
  "admin.backups": "Backups",
  "admin.backupsHint":
    "The database is backed up automatically every {{hours}} h; the {{keep}} most recent automatic backups are kept.",
  "admin.backupsDisabled":
    "Automatic backups are disabled (BACKUP_INTERVAL_HOURS=0).",
  "admin.backupsNone": "No backup yet.",
  "admin.backupNow": "Back up now",
  "admin.backupAuto": "automatic",
  "admin.backupManual": "manual",
  "admin.backupDownload": "Download",
  "admin.backupRestore": "Restore",
  "admin.backupRestoreConfirm":
    "Restore the backup from {{date}}? All the current data (accounts, drawings, settings) will be replaced by its content. A backup of the current state is made first. The server will restart.",
  "admin.backupDelete": "Delete the backup",
  "admin.backupDeleteConfirm": 'Delete the backup "{{name}}"?',
  "admin.restoreFile": "Restore from a file…",
  "admin.restoreFileConfirm":
    'Restore "{{name}}"? All the current data will be replaced by the content of this file. A backup of the current state is made first. The server will restart.',
  "admin.restarting":
    "Restoring… The server is restarting, the page will reload.",
  "admin.restartTimeout":
    "The server hasn't come back yet. Make sure it restarts automatically (Docker restart policy, systemd…), then reload the page.",
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
    "Mettre « {{name}} » à la corbeille ? Vous pourrez le restaurer pendant 30 jours.",
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
  "account.title": "Mon compte",
  "account.menu": "Mon compte",
  "account.passwordChanged": "Votre mot de passe a été modifié.",
  "drawings.back": "Retour",
  "drawings.favorite": "Ajouter aux favoris",
  "drawings.unfavorite": "Retirer des favoris",
  "drawings.actions": "Actions",
  "drawings.moveTo": "Déplacer vers…",
  "drawings.share": "Partager…",
  "drawings.leave": "Retirer de mes dessins",
  "drawings.leaveConfirm":
    "Retirer « {{name}} » de vos dessins ? Son propriétaire devra le partager à nouveau.",
  "drawings.sharedBy": "Partagé par {{name}}",
  "drawings.sharedByReadOnly": "Partagé par {{name}} · lecture seule",
  "drawings.all": "Tous les dessins",
  "drawings.favorites": "Favoris",
  "drawings.sharedWithMe": "Partagés avec moi",
  "drawings.noShared": "Personne ne vous a encore partagé de dessin.",
  "drawings.noFavorites":
    "Aucun favori. Cliquez sur l'étoile d'un dessin pour le retrouver ici.",
  "drawings.readOnly":
    "Lecture seule : « {{name}} » vous a été partagé par {{owner}}.",
  "folders.title": "Dossiers",
  "folders.new": "Nouveau dossier",
  "folders.rename": "Renommer le dossier",
  "folders.delete": "Supprimer le dossier",
  "folders.deleteConfirm":
    "Supprimer le dossier « {{name}} » ? Ses dessins sont conservés et sortis du dossier.",
  "folders.empty": "Aucun dossier.",
  "folders.none": "Aucun dossier",
  "trash.title": "Corbeille",
  "trash.hint":
    "Les dessins supprimés sont conservés 30 jours avant d'être définitivement effacés.",
  "trash.none": "La corbeille est vide.",
  "trash.empty": "Vider la corbeille",
  "trash.emptyConfirm":
    "Supprimer définitivement tous les dessins de la corbeille ? Cette action est irréversible.",
  "trash.restore": "Restaurer",
  "trash.deleteForever": "Supprimer définitivement",
  "trash.deleteForeverConfirm":
    "Supprimer définitivement « {{name}} » ? Cette action est irréversible.",
  "trash.purgedOn": "Effacé définitivement le {{date}}",
  "share.title": "Partager « {{name}} »",
  "share.hint":
    "Donnez accès à ce dessin à d'autres utilisateurs de l'instance. Les éditeurs peuvent le modifier, les lecteurs seulement le consulter.",
  "share.username": "Nom d'utilisateur",
  "share.roleEdit": "Peut modifier",
  "share.roleView": "Peut consulter",
  "share.add": "Partager",
  "share.none": "Ce dessin n'est pas encore partagé.",
  "share.remove": "Ne plus partager",
  "history.title": "Historique des versions · « {{name}} »",
  "history.menu": "Historique des versions",
  "history.saveNow": "Enregistrer une version",
  "history.hint":
    "Une version est enregistrée automatiquement toutes les 10 minutes d'édition, et avant chaque restauration.",
  "history.none": "Aucune version pour l'instant.",
  "history.reasonManual": "Enregistrée manuellement",
  "history.reasonBeforeRestore": "Avant une restauration",
  "history.reasonApi": "Avant une modification via l'API",
  "history.reasonAuto": "Automatique",
  "history.elements": "{{count}} élément(s)",
  "history.emptyVersion": "Cette version est vide.",
  "history.previewError": "Impossible d'afficher cette version.",
  "history.selectVersion": "Sélectionnez une version pour l'aperçu.",
  "history.restoreHint":
    "L'état actuel est enregistré comme version avant la restauration.",
  "history.restoreConfirm":
    "Restaurer cette version ? L'état actuel sera d'abord enregistré dans l'historique.",
  "history.restore": "Restaurer cette version",
  "admin.backups": "Sauvegardes",
  "admin.backupsHint":
    "La base est sauvegardée automatiquement toutes les {{hours}} h ; les {{keep}} sauvegardes automatiques les plus récentes sont conservées.",
  "admin.backupsDisabled":
    "Les sauvegardes automatiques sont désactivées (BACKUP_INTERVAL_HOURS=0).",
  "admin.backupsNone": "Aucune sauvegarde pour l'instant.",
  "admin.backupNow": "Sauvegarder maintenant",
  "admin.backupAuto": "automatique",
  "admin.backupManual": "manuelle",
  "admin.backupDownload": "Télécharger",
  "admin.backupRestore": "Restaurer",
  "admin.backupRestoreConfirm":
    "Restaurer la sauvegarde du {{date}} ? Toutes les données actuelles (comptes, dessins, réglages) seront remplacées par son contenu. Une sauvegarde de l'état actuel est faite avant. Le serveur va redémarrer.",
  "admin.backupDelete": "Supprimer la sauvegarde",
  "admin.backupDeleteConfirm": "Supprimer la sauvegarde « {{name}} » ?",
  "admin.restoreFile": "Restaurer depuis un fichier…",
  "admin.restoreFileConfirm":
    "Restaurer « {{name}} » ? Toutes les données actuelles seront remplacées par le contenu de ce fichier. Une sauvegarde de l'état actuel est faite avant. Le serveur va redémarrer.",
  "admin.restarting":
    "Restauration en cours… Le serveur redémarre, la page va se recharger.",
  "admin.restartTimeout":
    "Le serveur n'est pas encore revenu. Vérifiez qu'il redémarre automatiquement (politique de redémarrage Docker, systemd…), puis rechargez la page.",
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
