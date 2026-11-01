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

- [x] Étape 1 — Lot 1 : injecter la version dans l'image et l'exposer via l'API ; une image construite localement affiche `dev` et ne propose aucune mise à jour (S · standard → Sonnet)
- [x] Étape 2 — Lot 1 : publier `:latest` sur les seuls tags `v*` et corriger le README (XS · standard → Sonnet)
- [x] Étape 3 — Lot 2 : ajouter l'option d'administration, désactivée par défaut, et la vérification périodique des tags côté serveur (M · standard → Sonnet)
- [x] Étape 4 — Lot 2 : ajouter l'entrée de menu et la section « Mise à jour » avec ses états ; sans conteneur dédié, afficher la commande à lancer (M · standard → Sonnet)
- [x] Étape 5 — Lot 3 : créer le service de mise à jour avec `pull`, remplacement du conteneur, contrôle de santé et retour à l'image précédente, derrière un profil Compose (L · reasoning → Opus)
- [x] Étape 6 — Lot 3 : relier le bouton au service avec sauvegarde obligatoire, confirmation indiquant le nombre de personnes connectées et résultat conservé après le redémarrage (M · reasoning → Opus)
- [x] Étape 7 — Lot 3 : afficher le bandeau de coupure et l'invitation à recharger, puis vérifier le sort des modifications non enregistrées (M · standard → Sonnet)
- [x] 🧪 Tests — Rédiger et exécuter la procédure de test (local ; contrôle GHCR réel en attente, voir Validation)
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
| Délai de santé | 120 secondes, réglable par `UPDATE_HEALTH_TIMEOUT_SECONDS` | Docker fait son premier contrôle après 30 secondes ; garder au moins 60 secondes |
| Personnes connectées | Comptées d'après l'appel régulier de chaque éditeur (90 secondes) | La collaboration n'ouvre un socket que dans une salle ; le nombre reste approximatif pour les onglets en arrière-plan |
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

```bash
echo "=== Set The Working Directory ==="
cd /srv/dev/excalidraw-unchained
export E=/tmp/claude-1000/-srv-dev-excalidraw-unchained/a62a9f77-f136-4697-a9c5-efb1cedcabff/scratchpad/e2e9

echo "=== Start A Local Registry ==="
docker run -d --name e2e9-registry -p 127.0.0.1:5001:5000 registry:2

echo "=== Build And Push The Test Releases ==="
for v in 1.0.0 1.1.0; do
  docker build -q --build-arg APP_VERSION=$v -t e2e-excalidraw:$v .
  docker tag e2e-excalidraw:$v localhost:5001/excalidraw-e2e:$v
  docker push -q localhost:5001/excalidraw-e2e:$v
done

echo "=== Build A Release That Crashes At Start ==="
printf 'FROM e2e-excalidraw:1.1.0\nCMD ["node","-e","process.exit(1)"]\n' | docker build -q -t e2e-excalidraw:bad -
docker tag e2e-excalidraw:bad localhost:5001/excalidraw-e2e:1.2.0
docker push -q localhost:5001/excalidraw-e2e:1.2.0
```

Les scénarios sont hors du dépôt, dans `$E`. Le scénario navigateur s'exécute dans l'image `mcr.microsoft.com/playwright:v1.64.1-noble`.

### Procédure de test

```bash
echo "=== Run Static Checks And Unit Tests ==="
node_modules/.bin/tsc
node_modules/.bin/eslint --max-warnings=0 --ext .js,.ts,.tsx excalidraw-app server/src server/test
node_modules/.bin/vitest run
(cd server && node --disable-warning=ExperimentalWarning --test test/*.test.js)

echo "=== Replace A Container From The Real Compose File ==="
$E/scenario-a.sh

echo "=== Run The Whole Flow In A Browser ==="
$E/scenario-b.sh

echo "=== Read The Real Registry Anonymously ==="
(cd server && node --input-type=module -e "import('./src/updates.js').then(async m=>console.log(m.latestRelease(await m.fetchImageTags('ghcr.io/exe64/excalidraw-unchained'))))")
```

**Résultats attendus :**

- Une instance passe réellement d'une version à l'autre depuis le bouton.
- Un échec simulé ramène l'image précédente.
- Aucune requête tierce n'est émise quand l'option est désactivée.
- Aucune modification enregistrée n'est perdue.

### Contrôle restant, avant clôture

Passer de `v1.0.0` à la version suivante sur les images réelles de GHCR, depuis le bouton. Les deux tags sont publics et demandent l'accord de l'utilisateur.

### Résultats joués et vérifiés

| Date | Test | Attendu | Observé | Verdict |
| --- | --- | --- | --- | --- |
| 2026-11-01 | TypeScript, ESLint | Aucune erreur | Aucune erreur | PASS |
| 2026-11-01 | Tests de l'application | Tous réussis | 2633 réussis, 47 ignorés, 1 à faire | PASS |
| 2026-11-01 | Tests serveur | Tous réussis | 77 réussis | PASS |
| 2026-11-01 | Contrôle des tiers sur le build | Aucun tiers interdit | Aucun | PASS |
| 2026-11-01 | Lecture anonyme de GHCR | Tags lisibles sans token | 7 tags, aucune version publiée à ce jour | PASS |
| 2026-11-01 | Scénario Compose : remplacement | Environnement, port, volume, réseau, labels et comptes conservés | Conservés. `PUBLIC_URL` est la seule variable comparée | PASS |
| 2026-11-01 | Scénario Compose : échecs | Tag absent sans effet ; version qui plante remplacée par la précédente | Image 1.1.0 en marche, `rolledBack: true`, comptes intacts | PASS |
| 2026-11-01 | Navigateur : option désactivée | Aucune requête au registre ni à un tiers | 0 requête, aucun tiers | PASS |
| 2026-11-01 | Navigateur : installation | Bandeau, invitation à recharger, 1.1.0 en service, session conservée | Conforme | PASS |
| 2026-11-01 | Navigateur : coupure | Modification pendant la coupure enregistrée | 2 éléments enregistrés | PASS |
| 2026-11-01 | Navigateur : échec | Cause affichée, version précédente de retour | Conforme | PASS |
| 2026-11-01 | Vérificateur indépendant | Verdict sur les fichiers de résultats | PASS | PASS |

## Journal de session

### Session 2026-11-01

- ✅ Fait : cadrage, plan, étapes 1 à 7, tests locaux de bout en bout, une PR par lot.
- 🔄 En cours : revue et merge des trois PR par l'utilisateur.
- 📋 Prochain : poser `v1.0.0` juste après le merge du lot 1, puis une version suivante pour le contrôle réel sur GHCR, avec l'accord de l'utilisateur.
- 🚧 Blocages : aucun.
