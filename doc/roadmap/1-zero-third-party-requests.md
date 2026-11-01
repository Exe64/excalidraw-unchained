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

- [ ] Étape 1 — Lot 1 : retirer Sentry (code, dépendance, écran d'erreur) et les analytics (M · standard → Sonnet)
- [ ] Étape 2 — Lot 1 : retirer le recours `esm.sh`, l'`og:image` externe et les liens, puis corriger le README (S · standard → Sonnet)
- [ ] Étape 3 — Lot 2 : ajouter le réglage admin des intégrations web, côté serveur et dans l'écran Administration (M · standard → Sonnet)
- [ ] Étape 4 — Lot 2 : appliquer le réglage à l'éditeur, de préférence via la prop `validateEmbeddable`, sous réserve de vérification (M · standard → Sonnet)
- [ ] Étape 5 — Lot 3 : envoyer la CSP depuis le serveur, en l'adaptant au réglage des intégrations (L · reasoning → Opus)
- [ ] Étape 6 — Lot 3 : ajouter le test en CI sur le build (S · standard → Sonnet)
- [ ] 🧪 Tests — Rédiger et exécuter la procédure de test
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

**Risque à vérifier :** Wireframe vers code affiche du HTML généré dans une iframe. Si ce HTML appelle un CDN, la CSP le bloquera. À contrôler dans les tests avant de décider d'assouplir la règle pour cette iframe.

## Tests

### Prérequis pour les tests

### Procédure de test

### Résultats joués et vérifiés

| Date | Test | Attendu | Observé | Verdict |
| ---- | ---- | ------- | ------- | ------- |

## Journal de session

### Session 2026-11-01

- ✅ Fait : inventaire statique des dépendances tierces, cadrage, création du plan et de l'issue #1
- 🔄 En cours : rien
- 📋 Prochain : étape 1, sur une branche partie de `main`
- 🚧 Blocages : aucun
