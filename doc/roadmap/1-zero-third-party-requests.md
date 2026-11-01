---
plan:
  id: "1"
  name: 1-zero-third-party-requests.md
  link: https://github.com/Exe64/excalidraw-unchained/blob/main/doc/roadmap/1-zero-third-party-requests.md
status: active
date: 2026-11-01
description: >
  Faire en sorte qu'une instance n'émette aucune requête tierce sans action explicite de l'utilisateur, et le vérifier.


priority: high
complexity: L
intent: null
scope:
  modules:
    - excalidraw-app/
    - packages/excalidraw/
    - server/src/
    - scripts/
    - README.md
issue:
  id: 1
  url: https://github.com/Exe64/excalidraw-unchained/issues/1
---

# [🔒] Plan #1 - Zero Third Party Requests

## Objectif

Le cœur de l'application est déjà auto-hébergé, mais des dépendances à des services tiers subsistent. Ce plan les retire et fait bloquer par le navigateur toute requête tierce oubliée, y compris après un merge upstream.

**Définition retenue :** aucune requête tierce sans action explicite de l'utilisateur.

## Périmètre

### Inclus

- Retrait de Sentry et des analytics
- Retrait du recours `esm.sh` pour les polices
- `og:image` servie par l'instance
- Retrait des liens Plus, Discord, YouTube, blog et GitHub, y compris le signalement d'erreur vers les issues d'Excalidraw
- Réglage admin des intégrations web, désactivées par défaut, avec un simple lien dans les dessins existants
- CSP envoyée par le serveur et test en CI sur le build
- Correction du README

### Hors scope

- Catalogue de bibliothèques : « Parcourir » et « Publier » sont conservés et documentés
- `preconnect` Google Fonts : conservés, à noter comme exception connue dans le README
- Lien vers `docs.excalidraw.com` dans l'aide : conservé
- `examples/` et `dev-docs/`
- Renommage de la branche par défaut de GitHub

## Étapes

- [x] Étape 1 — Lot 1 : retirer Sentry (code, dépendance, écran d'erreur) et les analytics (M · standard → Sonnet)
- [x] Étape 2 — Lot 1 : retirer le recours `esm.sh`, l'`og:image` externe et les liens, puis corriger le README (S · standard → Sonnet)
- [x] Étape 3 — Lot 2 : ajouter le réglage admin des intégrations web, côté serveur et dans l'écran Administration (M · standard → Sonnet)
- [x] Étape 4 — Lot 2 : appliquer le réglage à l'éditeur, de préférence via la prop `validateEmbeddable`, sous réserve de vérification (M · standard → Sonnet)
- [x] Étape 5 — Lot 3 : envoyer la CSP depuis le serveur, en l'adaptant au réglage des intégrations (L · reasoning → Opus)
- [x] Étape 6 — Lot 3 : ajouter le test en CI sur le build (S · standard → Sonnet)
- [x] 🧪 Tests — Rédiger et exécuter la procédure de test
- [ ] ✅ Validation — Vérifier les résultats des tests et clôturer

## Décisions techniques

| Décision | Choix retenu | Justification |
| --- | --- | --- |
| Catalogue de bibliothèques | Conservé, parcours et publication | Action explicite, n'empêche pas un usage on-prem, aucun patch à maintenir |
| Google Fonts | `preconnect` conservés | Aucune police chargée depuis Google, sans effet bloquant on-prem |
| `esm.sh` | Retiré | Charge des polices d'une version non fixée et masquerait une installation cassée |
| Intégrations web | Réglage admin, désactivées par défaut | Tout lecteur d'un dessin chargerait sinon du contenu tiers |
| `packages/excalidraw` | Patchs minimes, documentés dans le README | Résultat fiable, en limitant les conflits upstream |
| Liens GitHub | Retirés, détail de l'erreur affiché sur place | Le dépôt du fork est privé, un lien ne marcherait pas pour les autres |
| Test en CI | Liste de domaines interdits, sans liste autorisée | Une liste autorisée casserait souvent aux merges ; la CSP couvre les domaines inconnus |
| CSP et scripts inline | `'unsafe-inline'` avec commentaire `ponytail:` | L'objectif est de contrôler les sorties ; limite la protection XSS, empreintes possibles plus tard |
| Livraison | Une branche partie de `main`, une PR par lot | Chaque merge publie l'image Docker ; la CSP doit pouvoir être annulée seule |

| Analytics | Drapeaux retirés, `analytics.ts` inchangé | `window.sa_event` n'est jamais défini : le code est inerte, un patch n'apporterait rien | | Page et service worker | `index.html` en « réseau d'abord » | Sinon la CSP mise en cache figerait le réglage des intégrations | | Import d'image par URL | Bloqué par la CSP et documenté | Ouvrir `connect-src` à tout HTTPS retirerait l'intérêt de la CSP |

**Iframe de Wireframe vers code :** les scripts inline s'exécutent et un script CDN est bloqué. Pas d'assouplissement : le prompt serveur demande déjà du HTML sans ressource externe.

## Tests

### Prérequis pour les tests

```bash
echo "=== Set The Working Directory And Tools ==="
cd /srv/dev/excalidraw-unchained
export S=/tmp/claude-1000/-srv-dev-excalidraw-unchained/13ccee17-b7b6-49b3-a36e-d5165aed0208/scratchpad
export PATH="$S/tools/node_modules/.bin:$PATH"
git switch feat/1-csp-and-build-check

echo "=== Pick A Library From The Public Catalogue ==="
export LIB=$(curl -s https://libraries.excalidraw.com/libraries.json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)[0]["source"])')
```

Le scénario navigateur est `$S/e2e/run.mjs`, hors du dépôt : il s'exécute dans l'image `mcr.microsoft.com/playwright:v1.64.1-noble`, car la machine n'a pas les bibliothèques de Chromium.

### Procédure de test

```bash
echo "=== Run Static Checks ==="
yarn -s test:typecheck
yarn -s test:code

echo "=== Run App And Server Tests ==="
yarn -s test:app --watch=false
yarn -s test:server

echo "=== Check The Build For Removed Third Parties ==="
yarn -s build:app:docker
yarn -s test:third-party

echo "=== Build And Start A Fresh Instance ==="
docker build -q -t excalidraw-unchained:test .
docker rm -f excalidraw-unchained-test
docker run -d --name excalidraw-unchained-test -p 127.0.0.1:38080:80 excalidraw-unchained:test
sleep 5

echo "=== Run The Browser Scenario ==="
docker run --rm --network host --user "$(id -u)" -e HOME=/tmp -e LIB="$LIB" -v "$S/e2e:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.64.1-noble node run.mjs http://127.0.0.1:38080 /e2e/embed-off.png

echo "=== Remove The Test Instance ==="
docker rm -f excalidraw-unchained-test
```

**Résultats attendus :** toutes les commandes se terminent avec le code 0, sans test en échec, et le scénario navigateur affiche `29/29 passed`. Il couvre le chargement, le dessin, le texte, les menus, Mermaid, l'export, le blocage d'une requête tierce, le catalogue, l'iframe générée et les intégrations web à travers le service worker.

### Résultats joués et vérifiés

| Date | Test | Attendu | Observé | Verdict |
| --- | --- | --- | --- | --- |
| 2026-11-01 | Typecheck et lint | Code 0 | Code 0 | ✅ |
| 2026-11-01 | Tests app | Aucun échec | 2633 réussis, 47 ignorés, 1 todo, 0 échec | ✅ |
| 2026-11-01 | Tests serveur | `# fail 0` | 50 réussis, 0 échec | ✅ |
| 2026-11-01 | Contrôle du build | Aucun domaine interdit | « No forbidden third party » | ✅ |
| 2026-11-01 | Scénario navigateur sur image Docker | `29/29 passed` | `29/29 passed` | ✅ |

Verdict du vérificateur indépendant, sur le commit `ca89ddaa` : **PASS**.

**Non couvert :** session de collaboration à plusieurs (seule la connexion WebSocket est testée), appel réel à un fournisseur d'IA (l'iframe générée est simulée), téléchargement du fichier exporté (seule la fenêtre d'export est testée). Les `preconnect` Google Fonts n'apparaissent pas dans les requêtes observées par Playwright.

## Journal de session

### Session 2026-11-01

- ✅ Fait : inventaire statique des dépendances tierces, cadrage, création du plan et de l'issue #1
- ✅ Fait : implémentation des 3 lots, tests finaux validés par le vérificateur, PR ouvertes
- 🔄 En cours : revue et merge des PR par l'opérateur
- 📋 Prochain : après merge, ✅ Validation et clôture du plan et de l'issue #1
- 🚧 Blocages : aucun
