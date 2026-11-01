---
plan:
  id: "7"
  name: 7-readme-banner.md
  link: https://github.com/Exe64/excalidraw-unchained/blob/main/doc/roadmap/done/7-readme-banner.md
status: done
date: 2026-11-01
description: >
  Afficher la bannière du projet en tête du README.


priority: low
complexity: XS
intent: null
issue:
  id: 7
  url: https://github.com/Exe64/excalidraw-unchained/issues/7
---

# [🖼️] Plan #7 - README Banner

## Objectif

Afficher la bannière du projet en tête du README.

## Périmètre

### Inclus

- `.github/assets/banner.jpg`, hors de l'image Docker
- Première ligne de `README.md`

### Hors scope

- Modification de l'image

## Étapes

- [x] Étape 1 — Ajouter l'image et la référencer dans le README (XS · standard → Sonnet)
- [x] 🧪 Tests — Vérifier le chemin et le format
- [x] ✅ Validation — Vérifier les résultats et clôturer

## Tests

### Procédure de test

```bash
echo "=== Check The Banner Is Tracked ==="
git ls-files .github/assets/banner.jpg

echo "=== Check The README Format ==="
node_modules/.bin/prettier --check README.md
```

**Résultats attendus :** le fichier est listé et le README respecte le format.

### Résultats joués et vérifiés

| Date | Test | Attendu | Observé | Verdict |
| --- | --- | --- | --- | --- |
| 2026-11-01 | Fichier suivi et format | Fichier listé, format OK | Fichier listé, format OK | ✅ |

## Journal de session

### Session 2026-11-01

- ✅ Fait : bannière ajoutée au README
