/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-svgr/client" />
interface ImportMetaEnv {
  // The port to run the dev server
  VITE_APP_PORT: string;

  // base URL of the Excalidraw Unchained server (see /server). Empty means
  // same origin, which is the default setup.
  VITE_APP_API_URL: string;
  // dev only: where the Vite dev server proxies /api and /socket.io to
  VITE_APP_DEV_BACKEND_URL: string;

  // collaboration WebSocket server. Empty means same origin (our server)
  VITE_APP_WS_SERVER_URL: string;

  // set this only if using the collaboration workflow we use on excalidraw.com
  VITE_APP_PORTAL_URL: string;
  VITE_APP_AI_BACKEND: string;

  // whether to disable live reload / HMR. Usuaully what you want to do when
  // debugging Service Workers.
  VITE_APP_DEV_DISABLE_LIVE_RELOAD: string;

  VITE_APP_DISABLE_SENTRY: string;

  // Set this flag to false if you want to open the overlay by default
  VITE_APP_COLLAPSE_OVERLAY: string;

  // Enable eslint in dev server
  VITE_APP_ENABLE_ESLINT: string;

  // Enable PWA in dev server
  VITE_APP_ENABLE_PWA: string;

  VITE_APP_PLUS_LP: string;

  VITE_APP_PLUS_APP: string;

  VITE_APP_GIT_SHA: string;

  MODE: string;

  DEV: string;
  PROD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
