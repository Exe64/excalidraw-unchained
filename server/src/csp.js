// Content-Security-Policy of the app: the browser itself blocks requests to
// third parties, including any that a merge from upstream would bring back.

// libraries added from the public catalogue, and publishing to it
const LIBRARY_CATALOGUE = [
  "https://excalidraw.com",
  "https://*.excalidraw.com",
  "https://raw.githubusercontent.com",
  "https://us-central1-excalidraw-room-persistence.cloudfunctions.net",
];

export const getContentSecurityPolicy = ({ webEmbedsEnabled }) => {
  // embeds come from many services, and some load their own scripts and styles
  const embeds = webEmbedsEnabled ? " https:" : "";
  return [
    "default-src 'self'",
    // ponytail: 'unsafe-inline' for index.html's scripts limits XSS protection,
    // use hashes of these scripts if that becomes a goal
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${embeds}`,
    `style-src 'self' 'unsafe-inline'${embeds}`,
    `img-src 'self' data: blob:${embeds}`,
    "font-src 'self' data:",
    `connect-src 'self' data: blob: ${LIBRARY_CATALOGUE.join(" ")}`,
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    `frame-src 'self' data: blob:${embeds}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
};
