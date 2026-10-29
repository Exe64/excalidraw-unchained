# Excalidraw Unchained

Fork auto-hébergé d'[Excalidraw](https://github.com/excalidraw/excalidraw) : **même éditeur, même design, mêmes fonctionnalités**, mais :

- 🔐 **accès réservé aux utilisateurs authentifiés** (nom d'utilisateur + mot de passe) ;
- 🗄️ **les dessins sont hébergés et stockés côté serveur** (SQLite), et non plus dans le navigateur : on les retrouve depuis n'importe quel appareil ;
- 📁 **plusieurs dessins par utilisateur** (« Mes dessins » : créer, ouvrir, rechercher, renommer, dupliquer, supprimer) ;
- 🤝 la **collaboration en direct** et les **liens de partage** passent par ce même serveur (plus de Firebase ni de serveurs excalidraw.com) et restent **chiffrés de bout en bout** ;
- 📚 la **bibliothèque** personnelle est aussi stockée sur le serveur ;
- 🤖 **votre assistant IA peut dessiner** : un serveur [MCP](https://modelcontextprotocol.io) intégré permet à Claude (ou tout client MCP) de lire, créer et modifier vos dessins ;
- ✨ les fonctions IA de l'éditeur (« Texte vers diagramme », « Wireframe vers code ») utilisent **le fournisseur de votre choix** : Claude, OpenAI, Mistral, Ollama…

Le README d'origine est conservé dans [README.upstream.md](./README.upstream.md).

## Démarrage rapide (Docker)

```bash
ADMIN_PASSWORD='un-mot-de-passe-solide' docker compose up -d --build
```

L'application est servie sur <http://localhost:3000>. Au premier démarrage, le compte `admin` (ou `ADMIN_USERNAME`) est créé avec `ADMIN_PASSWORD`. Les données sont conservées dans le volume `excalidraw-data` (`/data/excalidraw.sqlite`).

En production, placez le conteneur derrière un reverse proxy HTTPS (Caddy, Traefik, nginx…) qui transmet aussi les WebSockets (`/socket.io`), et définissez `TRUST_PROXY` pour que le cookie de session reçoive le flag `Secure`.

## Gestion des utilisateurs

Par défaut, l'inscription depuis l'écran de connexion est désactivée. Les comptes se gèrent en ligne de commande :

```bash
# dans le conteneur
docker compose exec excalidraw node src/cli.js add alice          # mot de passe demandé
docker compose exec excalidraw node src/cli.js add bob --admin
docker compose exec excalidraw node src/cli.js passwd alice        # déconnecte ses sessions
docker compose exec excalidraw node src/cli.js delete alice        # supprime aussi ses dessins
docker compose exec excalidraw node src/cli.js list

# hors Docker
yarn --cwd server users add alice
```

Le mot de passe peut aussi être passé via la variable `PASSWORD` (scripts).

## Configuration du serveur

| Variable | Défaut | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `3005` / `0.0.0.0` | Adresse d'écoute (`80` dans l'image Docker) |
| `DATA_DIR` | `server/data` | Dossier de la base SQLite (`/data` dans l'image Docker) |
| `STATIC_DIR` | `excalidraw-app/build` s'il existe | Frontend compilé à servir |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | Compte créé au démarrage si aucun utilisateur n'existe |
| `ALLOW_REGISTRATION` | `false` | Autorise la création de compte depuis l'écran de connexion |
| `SESSION_TTL_DAYS` | `30` | Durée de validité des sessions |
| `COOKIE_SECURE` | `auto` | `auto` (selon HTTPS), `true` ou `false` |
| `TRUST_PROXY` | `loopback` | Valeur de [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) d'Express |
| `MAX_BODY_SIZE` | `50mb` | Taille maximale d'une requête (dessin, image) |
| `ROOM_TTL_DAYS` | `90` | Purge des salles de collaboration inactives (`0` = jamais) |
| `PUBLIC_URL` | URL de la requête | URL publique de l'instance (liens donnés aux assistants IA) |
| `AI_PROVIDER` | – (IA désactivée) | `anthropic` (Claude) ou `openai` (toute API compatible OpenAI : OpenAI, Mistral, Ollama, LM Studio, vLLM…) |
| `AI_API_KEY` | – | Clé du fournisseur (pour Claude, `ANTHROPIC_API_KEY` est aussi lue) |
| `AI_MODEL` | `claude-opus-5-5` pour Claude | Modèle à utiliser (obligatoire pour `openai`) |
| `AI_BASE_URL` | `https://api.openai.com/v1` pour `openai` | URL de l'API, ex. `https://api.mistral.ai/v1`, `http://ollama:11434/v1` |
| `AI_EFFORT` | `medium` | Claude uniquement : `low`, `medium`, `high`, `xhigh`, `max` |
| `AI_REQUESTS_PER_DAY` | `200` | Quota de requêtes IA par utilisateur et par jour (`0` = illimité) |

## Laisser Claude dessiner (serveur MCP)

L'instance expose un serveur MCP sur `/mcp`. Chaque utilisateur crée un **jeton d'accès** depuis le menu ☰ > **Accès API (MCP)** ; la fenêtre affiche aussi la configuration prête à copier. Un jeton donne accès aux dessins de son propriétaire uniquement, et se révoque à tout moment.

- **Claude Code** :
  ```bash
  claude mcp add --transport http excalidraw https://draw.example.com/mcp \
    --header "Authorization: Bearer exu_…"
  ```
- **App Claude / claude.ai** : Paramètres > Connecteurs > _Ajouter un connecteur personnalisé_, avec l'URL `https://draw.example.com/mcp/exu_…` (le jeton est dans l'URL, ces clients ne permettant pas d'ajouter un en-tête). L'instance doit être joignable depuis Internet en HTTPS.
- **Autres clients MCP** : transport « Streamable HTTP » sur `/mcp`, en-tête `Authorization: Bearer <jeton>`.

Outils proposés à l'assistant : `list_drawings`, `get_drawing`, `create_drawing`, `add_to_drawing`, `update_elements`, `remove_elements`, `rename_drawing`. Claude décrit les formes dans un format simple (rectangles, ellipses, losanges, textes, flèches reliées aux formes, cadres) ou en **Mermaid** ; l'éditeur les convertit en éléments Excalidraw modifiables à l'ouverture du dessin. Si le dessin est déjà ouvert, les modifications apparaissent en quelques secondes.

Exemple : _« Dessine dans Excalidraw l'architecture de mon cluster Nutanix 3 nœuds avec Prism Central »_, puis ouvrez le lien que Claude vous donne.

Les mêmes jetons fonctionnent avec l'API REST (`/api/drawings…`) pour vos scripts.

## Fonctions IA de l'éditeur

« Texte vers diagramme » et « Wireframe vers code » passent par le serveur, qui interroge le fournisseur configuré (`AI_PROVIDER`, voir la configuration) : la clé d'API reste côté serveur et rien n'est envoyé aux services d'excalidraw.com. Exemples :

```bash
# Claude
AI_PROVIDER=anthropic AI_API_KEY=sk-ant-…
# Mistral
AI_PROVIDER=openai AI_BASE_URL=https://api.mistral.ai/v1 AI_MODEL=mistral-large-latest AI_API_KEY=…
# Ollama, en local
AI_PROVIDER=openai AI_BASE_URL=http://ollama:11434/v1 AI_MODEL=llama3.1
```

« Wireframe vers code » nécessite un modèle qui accepte les images. Sans `AI_PROVIDER`, ces fonctions affichent un message indiquant qu'elles ne sont pas configurées.

## Développement

Prérequis : Node.js ≥ 22.13 (le serveur utilise `node:sqlite`) et Yarn 1.

```bash
yarn install

# terminal 1 : le serveur (API + collaboration) sur :3005
ADMIN_USERNAME=admin ADMIN_PASSWORD=admin1234 yarn dev:server

# terminal 2 : l'app (Vite) sur :3001, qui proxifie /api et /socket.io vers :3005
yarn start
```

Tests et vérifications :

```bash
yarn test:server       # API, authentification, collaboration (node:test)
yarn test:app          # tests de l'app et de l'éditeur (vitest)
yarn test:typecheck && yarn test:code && yarn test:other
```

## Architecture

```
excalidraw-app/          l'app web (fork d'excalidraw.com)
  auth/                  écran de connexion, garde d'authentification
  data/ServerData.ts     sauvegarde auto du dessin courant, images, bibliothèque
  data/serverStorage.ts  salles de collaboration & fichiers chiffrés (remplace Firebase)
  data/drawings.ts       client de l'API des dessins
  data/pendingOps.ts     conversion des modifications demandées via l'API (MCP)
  components/DrawingsDialog.tsx  « Mes dessins »
packages/                l'éditeur Excalidraw, inchangé
server/                  Node.js + Express + Socket.IO + SQLite
  src/app.js             API REST (auth, dessins, fichiers, bibliothèque, salles, liens)
  src/collab.js          relais temps réel (protocole d'excalidraw-room), authentifié
  src/mcp.js             serveur MCP (assistants IA)
  src/ai.js              fonctions IA de l'éditeur (Claude ou API compatible OpenAI)
  src/tokens.js          jetons d'accès personnels
  src/cli.js             gestion des utilisateurs
```

- **Sauvegarde** : le dessin ouvert est enregistré automatiquement (1 s après la dernière modification, et à la fermeture de l'onglet). Chaque dessin a un numéro de version : si le même dessin est modifié depuis un autre onglet ou appareil, les modifications sont fusionnées élément par élément (même algorithme que la collaboration) au lieu de s'écraser.
- **Images** : stockées par utilisateur, identifiées par l'empreinte de leur contenu.
- **Collaboration** : les scènes et images des salles sont chiffrées dans le navigateur ; la clé reste dans l'ancre (`#room=…,clé`) et n'est jamais envoyée au serveur. Seuls les utilisateurs connectés peuvent rejoindre une salle. En arrêtant une session, le résultat est enregistré dans le dessin d'origine (pour celui qui l'a lancée) ou dans une copie (pour ceux qui l'ont rejointe).
- **Liens de partage** (« Exporter vers un lien ») : chiffrés de bout en bout ; à l'ouverture, le dessin partagé est ajouté aux dessins de l'utilisateur sans écraser le dessin courant.

## Différences avec excalidraw.com

Retirés car liés aux services commerciaux d'excalidraw.com : promotions et export vers Excalidraw+, analytics, Sentry, polices chargées depuis le CDN d'excalidraw.com (elles sont désormais servies par le serveur). Les fonctions IA passent par votre serveur et le fournisseur que vous configurez. Seul le catalogue public de bibliothèques (`VITE_APP_LIBRARY_URL`) reste un service externe.

## Suivre les évolutions d'Excalidraw

Le dépôt conserve l'historique d'Excalidraw ; pour récupérer les nouveautés :

```bash
git remote add upstream https://github.com/excalidraw/excalidraw.git
git fetch upstream && git merge upstream/master
```

Les modifications sont concentrées dans `excalidraw-app/` et `server/` ; le paquet `packages/excalidraw` (l'éditeur) n'est pas modifié, ce qui limite les conflits.

## Licence

MIT, comme Excalidraw — voir [LICENSE](./LICENSE).
