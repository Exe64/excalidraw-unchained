# Excalidraw Unchained

Un tableau blanc collaboratif au style « dessiné à la main », basé sur [Excalidraw](https://github.com/excalidraw/excalidraw), que vous hébergez vous-même. Vos dessins sont stockés sur votre serveur et l'accès est réservé aux personnes qui ont un compte.

Le README d'origine d'Excalidraw est conservé dans [README.upstream.md](./README.upstream.md).

## Découvrir l'application

### Se connecter

L'application s'ouvre sur un écran de connexion (nom d'utilisateur et mot de passe). Au tout premier lancement, elle propose de créer le **compte administrateur**. Ensuite, selon le réglage choisi par l'administrateur, les comptes sont soit créés par lui, soit demandés depuis l'écran de connexion (« Pas encore de compte ? En demander un ») puis validés par lui : tant que la demande n'est pas validée, la connexion est refusée avec un message explicite. Votre session reste ouverte 30 jours. Si elle expire pendant que vous dessinez, une fenêtre de reconnexion s'affiche par-dessus le dessin, sans rien perdre. Pour vous déconnecter : menu ☰ > **Se déconnecter**.

### Vos dessins, sur le serveur

- **Enregistrement automatique** : chaque modification est sauvegardée sur le serveur environ une seconde après, et à la fermeture de l'onglet. Pas de bouton « Enregistrer ».
- **Mes dessins** (menu ☰, écran d'accueil ou palette de commandes) : la liste de tous vos dessins, avec recherche, date de dernière modification, et les actions ouvrir, renommer, dupliquer, supprimer. **Nouveau dessin** en crée un vierge.
- **Partout** : retrouvez vos dessins depuis n'importe quel appareil. Chaque dessin a sa propre adresse (`…/?drawing=…`), que vous pouvez mettre en favori.
- **Plusieurs onglets ou appareils** : si le même dessin est modifié à deux endroits, les changements sont fusionnés au lieu de s'écraser.
- **Images** : les images insérées sont elles aussi stockées sur le serveur.

### Dessiner

La barre d'outils en haut de l'écran propose (avec leur raccourci clavier) :

- **Sélection** (V) et **sélection au lasso** ; **main** (H) pour déplacer la vue ;
- **Rectangle** (R), **losange** (D), **ellipse** (O), **flèche** (A), **ligne** (L) ;
- **Crayon** (P) pour le dessin libre, **texte** (T), **post-it** (N), **image** (insertion depuis un fichier ou le presse-papiers) ;
- **Gomme** (E) ;
- dans « Plus d'outils » : **cadre** (pour regrouper et présenter une zone), **intégration web** (vidéo, page…), **pointeur laser** pour présenter, **dessin vers forme**, **remplissage au pot de peinture**, **Mermaid vers Excalidraw**, et les fonctions IA (voir plus bas).

Quelques gestes utiles : double-cliquer sur une forme pour y écrire un texte, relier deux formes avec une flèche (elle reste attachée quand on déplace les formes), créer un organigramme au clavier à partir d'une forme sélectionnée (Ctrl + flèches), éditer les points d'une ligne ou d'une flèche, recadrer une image.

### Mettre en forme

Le panneau de propriétés permet de régler, pour la sélection : couleurs du trait et du fond, style de remplissage (hachures, hachures croisées, plein, zigzag), épaisseur et style du trait (plein, tirets, pointillés), niveau de « fait main » (architecte, artiste, cartooniste), angles droits ou arrondis, opacité, pointes de flèches (dont les notations de cardinalité pour les schémas de données), flèches droites, courbes ou à angles droits, police, taille et alignement du texte.

### Organiser

Premier plan / arrière-plan, alignement et répartition, grouper / dégrouper, verrouiller, dupliquer, retourner, changer le type d'une forme, lier un élément à une adresse web ou à un autre élément du dessin, ajouter des éléments à votre bibliothèque. Annuler (Ctrl+Z) et rétablir (Ctrl+Y sous Windows, Ctrl+Shift+Z ailleurs) à tout moment.

### Naviguer et retrouver

Zoom et défilement libres, grille et magnétisme sur les autres objets, **recherche dans le dessin** (Ctrl+F), **palette de commandes** (Ctrl+/) pour accéder à tout au clavier, mode zen (sans interface), mode lecture seule, statistiques du dessin et des éléments sélectionnés.

### Bibliothèque

Enregistrez des formes ou groupes de formes réutilisables dans votre bibliothèque personnelle (stockée sur le serveur, donc disponible partout), ou ajoutez-y des bibliothèques du catalogue communautaire (« Parcourir les bibliothèques »).

### Collaborer et partager

- **Collaboration en direct** (bouton de partage en haut à droite) : démarrez une session et envoyez le lien (ou le QR code) à vos collègues. Chacun voit les curseurs, les sélections et les modifications des autres en temps réel, et peut suivre la vue d'un participant. Seuls les utilisateurs connectés à votre instance peuvent rejoindre la session, qui est chiffrée de bout en bout : le serveur ne voit pas le contenu. En fin de session, le résultat est enregistré dans votre dessin, ou dans une copie si vous aviez rejoint la session de quelqu'un d'autre.
- **Lien de partage** : une copie en lecture du dessin, elle aussi chiffrée de bout en bout. La personne qui l'ouvre (après connexion) retrouve le dessin ajouté à ses propres dessins.

### Exporter et importer

- Export en **PNG** ou **SVG** (avec ou sans fond, seulement la sélection, en mode sombre, à l'échelle voulue), copie de l'image dans le presse-papiers ;
- option pour **inclure le dessin dans l'image** exportée, afin de pouvoir la rouvrir et la modifier plus tard ;
- enregistrement et ouverture de fichiers **`.excalidraw`** ; glisser-déposer d'un fichier ou d'une image sur le canevas.

### Intelligence artificielle

- **Texte vers diagramme** : décrivez un schéma en langage naturel, l'IA propose un diagramme que vous affinez en conversation avant de l'insérer, sous forme de formes modifiables.
- **Wireframe vers code** : dessinez une maquette d'interface dans un cadre, l'IA en génère une page web fonctionnelle, affichée directement dans le dessin.
- **Mermaid vers Excalidraw** (sans IA) : collez un diagramme Mermaid, il est converti en formes modifiables.

Ces fonctions utilisent le fournisseur d'IA choisi par l'administrateur (Claude, OpenAI, Mistral, un modèle local via Ollama…), voir [Fonctions IA de l'éditeur](#fonctions-ia-de-léditeur).

### Laisser votre assistant IA dessiner

Connectez Claude (ou un autre assistant compatible MCP) à votre instance, puis demandez-lui simplement : _« Dessine dans Excalidraw l'architecture de mon cluster Nutanix 3 nœuds avec Prism Central »_. Il crée le dessin dans « Mes dessins » et vous donne le lien. Il peut aussi lire vos dessins existants, les compléter, déplacer ou recolorer des éléments. Si le dessin est ouvert pendant ce temps, ses modifications apparaissent en direct.

Pour le connecter : menu ☰ > **Accès API (MCP)**, créez un jeton et copiez la configuration proposée (voir [Laisser Claude dessiner](#laisser-claude-dessiner-serveur-mcp)). Votre abonnement Claude suffit : aucune clé d'API n'est nécessaire.

### Administrer

Les administrateurs disposent du menu ☰ > **Administration**, qui affiche aussi le nombre de demandes de compte en attente :

- **Inscriptions** : _fermées_ (seuls les administrateurs créent les comptes) ou _ouvertes, avec validation_ (chacun peut demander un compte, un administrateur le valide ou le refuse) ;
- **Demandes en attente** : valider ou refuser ;
- **Comptes** : créer un compte, réinitialiser un mot de passe (l'utilisateur est déconnecté partout), donner ou retirer les droits d'administrateur, supprimer un compte avec ses dessins. L'application garde toujours au moins un administrateur actif.

### Personnaliser

Thème clair, sombre ou selon le système, couleur de fond du canevas, plus de 40 langues, préférences d'affichage. L'application peut aussi être installée comme une application de bureau ou mobile (PWA).

## Installation (Docker)

```bash
docker compose up -d --build
```

L'application est servie sur <http://localhost:3000>. À la première ouverture, elle demande de créer le compte administrateur. Pour le créer automatiquement à la place, définissez `ADMIN_USERNAME` et `ADMIN_PASSWORD` avant le premier démarrage. Les données sont conservées dans le volume `excalidraw-data` (`/data/excalidraw.sqlite`).

En production, placez le conteneur derrière un reverse proxy HTTPS (Caddy, Traefik, nginx…) qui transmet aussi les WebSockets (`/socket.io`), et définissez `TRUST_PROXY` pour que le cookie de session reçoive le flag `Secure`.

## Gestion des utilisateurs

Les comptes et le mode d'inscription se gèrent depuis l'application (menu ☰ > **Administration**, voir [Administrer](#administrer)). Par défaut, les inscriptions sont fermées. La ligne de commande reste disponible, par exemple pour dépanner :

```bash
# dans le conteneur
docker compose exec excalidraw node src/cli.js add alice          # mot de passe demandé
docker compose exec excalidraw node src/cli.js add bob --admin
docker compose exec excalidraw node src/cli.js passwd alice        # déconnecte ses sessions
docker compose exec excalidraw node src/cli.js approve alice       # valide une demande de compte
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
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | Compte administrateur créé au démarrage si aucun utilisateur n'existe (sinon, l'application propose de le créer) |
| `ALLOW_REGISTRATION` | `false` | Mode d'inscription initial : `true` = ouvertes avec validation. Ensuite, c'est le réglage de l'écran Administration qui s'applique |
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

Aucune clé d'API Anthropic n'est nécessaire : c'est l'assistant (avec votre abonnement Claude) qui appelle votre instance, le jeton `exu_…` ne sert qu'à s'authentifier auprès d'elle.

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

Contrairement au serveur MCP, ces fonctions sont appelées par votre serveur : elles nécessitent une clé d'API du fournisseur (facturée à l'usage, distincte d'un abonnement Claude), ou un modèle local. « Wireframe vers code » nécessite un modèle qui accepte les images. Sans `AI_PROVIDER`, ces fonctions affichent un message indiquant qu'elles ne sont pas configurées.

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
  components/AdminDialog.tsx     écran d'administration
packages/                l'éditeur Excalidraw, inchangé
server/                  Node.js + Express + Socket.IO + SQLite
  src/app.js             API REST (auth, dessins, fichiers, bibliothèque, salles, liens)
  src/collab.js          relais temps réel (protocole d'excalidraw-room), authentifié
  src/mcp.js             serveur MCP (assistants IA)
  src/ai.js              fonctions IA de l'éditeur (Claude ou API compatible OpenAI)
  src/tokens.js          jetons d'accès personnels
  src/admin.js           administration (inscriptions, comptes)
  src/settings.js        réglages de l'instance
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
