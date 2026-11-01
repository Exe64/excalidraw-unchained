---
plan:
  id: "9"
  name: 9-in-app-update.md
  link: https://github.com/Exe64/excalidraw-unchained/blob/main/doc/roadmap/9-in-app-update.md
status: active
date: 2026-11-01
description: >
  Permettre à un admin de mettre à jour une instance depuis l'application, avec sauvegarde préalable et retour à l'image précédente en cas d'échec.


priority: medium
complexity: L
intent: null
scope:
  modules:
    - .github/workflows/docker-publish.yml
    - Dockerfile
    - docker-compose.yml
    - server/src/
    - excalidraw-app/components/AdminDialog.tsx
    - excalidraw-app/components/AppMainMenu.tsx
    - README.md
issue:
  id: 9
  url: https://github.com/Exe64/excalidraw-unchained/issues/9
---

# [⬆️] Plan #9 - In App Update

## Objectif

Un admin voit « Update x.y available », clique, et l'instance passe à cette version sans ligne de commande. L'opération reste compatible avec la règle du plan #1 et n'expose pas le socket Docker au conteneur de l'app.

## Périmètre

### Inclus

- Numéro de version dans l'image
- Publication de `:latest` sur les seuls tags `v*`
- Vérification côté serveur, sur option d'administration désactivée par défaut
- Entrée de menu et section « Mise à jour » dans Administration
- Conteneur dédié, activable par un profil Compose
- Bandeau pour les personnes connectées
- README

### Hors scope

- Retour manuel à une version antérieure depuis l'interface
- Mises à jour automatiques sans clic
- Notes de version dans l'app
- Déploiements hors Docker Compose
- Images de préversion (`v1.2.0-rc1`)

## Étapes

- [ ] Étape 1 — Lot 1 : injecter la version dans l'image et l'exposer via l'API ; une image construite localement affiche `dev` et ne propose aucune mise à jour (S · standard → Sonnet)
- [ ] Étape 2 — Lot 1 : publier `:latest` sur les seuls tags `v*` et corriger le README (XS · standard → Sonnet)
- [ ] Étape 3 — Lot 2 : ajouter l'option d'administration, désactivée par défaut, et la vérification périodique des tags côté serveur (M · standard → Sonnet)
- [ ] Étape 4 — Lot 2 : ajouter l'entrée de menu et la section « Mise à jour » avec ses états ; sans conteneur dédié, afficher la commande à lancer (M · standard → Sonnet)
- [ ] Étape 5 — Lot 3 : créer le service de mise à jour avec `pull`, remplacement du conteneur, contrôle de santé et retour à l'image précédente, derrière un profil Compose (L · reasoning → Opus)
- [ ] Étape 6 — Lot 3 : relier le bouton au service avec sauvegarde obligatoire, confirmation indiquant le nombre de personnes connectées et résultat conservé après le redémarrage (M · reasoning → Opus)
- [ ] Étape 7 — Lot 3 : afficher le bandeau de coupure et l'invitation à recharger, puis vérifier le sort des modifications non enregistrées (M · standard → Sonnet)
- [ ] 🧪 Tests — Rédiger et exécuter la procédure de test
- [ ] ✅ Validation — Vérifier les résultats des tests et clôturer

## Décisions techniques

| Décision | Choix retenu | Justification |
| --- | --- | --- |
| Application de la mise à jour | Conteneur dédié, activé par un profil Compose | Une faille dans l'app ne donne pas directement accès à l'hôte, et les instances qui n'en veulent pas n'ont aucun service privilégié |
| Sans conteneur dédié | Le bouton affiche la version et la commande à lancer | La notification reste utile sans accès à Docker |
| Vérification | Côté serveur, option désactivée par défaut | Conforme au plan #1 ; la CSP du navigateur n'est pas touchée |
| Source des versions | Tags GHCR, pas l'API GitHub | Un tag GHCR n'existe qu'une fois l'image poussée, alors qu'un tag Git apparaît avant la fin du build |
| Accès | Dépôt et image publics, aucun token sur les instances | Accès anonyme à GHCR vérifié le 2026-11-01 |
| Versions | Tags `v1.2.0` ; `:latest` ne suit que ces tags et `main` ne publie que `sha-…` | Un `docker compose pull` n'installe pas de code non publié |
| Image du service de mise à jour | La même que l'app, avec une autre commande | Aucune deuxième image à publier ; le service lui-même reste mis à jour par `docker compose pull` et `up -d` |
| Accès à Docker | API du socket en Node, sans nouvelle dépendance | Moins de code tiers dans le seul composant privilégié |
| Limites du service | Aucun port sur l'hôte, secret partagé obligatoire, conteneur et dépôt d'image fixés, tag validé au format semver | Une app compromise ne peut pas lancer une image arbitraire |
| Image de test | Variable `UPDATE_IMAGE`, GHCR par défaut | Permet de tester sur un registre local sans publier de faux tags |
| Sauvegarde | Obligatoire avant le `pull`, abandon si elle échoue | Évite une mise à jour sans point de retour |
| Échec | Retour automatique à l'image précédente, sans restauration automatique de la base | Restaurer la base effacerait ce qui a été écrit depuis : l'admin décide |
| Interface | Admins uniquement, entrée de menu discrète et section dans Administration, rien sur le canevas | L'action interrompt tout le monde et ne concerne pas le dessin |
| Personnes connectées | Confirmation avec leur nombre, sans compte à rebours ; bandeau pendant la coupure, puis invitation à recharger | Prévient sans ajouter d'attente |

### Risques et limites

| Sujet | Effet | Traitement |
| --- | --- | --- |
| Première mise à jour | Les instances actuelles n'ont pas le bouton | Passage manuel à la première version taguée, à documenter |
| `:latest` figé après le lot 1 | Plus aucune nouvelle image `:latest` jusqu'au premier tag | Poser `v1.0.0` juste après le merge, avec l'accord de l'utilisateur |
| Migrations de base | Une ancienne image peut être incompatible avec une base déjà migrée | Le retour d'image signale ce cas et renvoie vers la sauvegarde |
| Socket Docker | Le service reste équivalent à root sur l'hôte | Surface réduite, activation volontaire, à expliciter dans le README |

## Tests

### Prérequis pour les tests

À rédiger à l'étape 🧪 Tests.

### Procédure de test

À rédiger à l'étape 🧪 Tests. Le test final sur GHCR demande un vrai tag, posé uniquement avec l'accord de l'utilisateur.

**Résultats attendus :**

- Une instance passe réellement d'une version à l'autre depuis le bouton.
- Un échec simulé ramène l'image précédente.
- Aucune requête tierce n'est émise quand l'option est désactivée.
- Aucune modification enregistrée n'est perdue.

### Résultats joués et vérifiés

| Date | Test | Attendu | Observé | Verdict |
| ---- | ---- | ------- | ------- | ------- |

## Journal de session

### Session 2026-11-01

- ✅ Fait : cadrage, proposition validée, issue #9 et plan créés ; dépôt et image rendus publics par l'utilisateur.
- 🔄 En cours : aucun.
- 📋 Prochain : Phase 6, puis étape 1 sur une branche partie de `main` à jour.
- 🚧 Blocages : aucun.
