// Fails if the app build references a third party that was removed on purpose
// (see "Différences avec excalidraw.com" in the README).
// The public library catalogue, the docs link and embeds are expected.
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN = [
  "sentry.io",
  "esm.sh/",
  "plus.excalidraw.com",
  "discord.gg/",
  "youtube.com/@excalidraw",
  "x.com/excalidraw",
  "excalidraw/excalidraw/issues",
  "excalidraw.com/og-image",
];

const dir = process.argv[2] || "excalidraw-app/build";
if (!fs.existsSync(dir)) {
  console.error(`${dir} not found: build the app first`);
  process.exit(1);
}

const found = [];
for (const entry of fs.readdirSync(dir, {
  recursive: true,
  withFileTypes: true,
})) {
  if (entry.isFile() && /\.(html|js|css|webmanifest)$/.test(entry.name)) {
    const file = path.join(entry.parentPath, entry.name);
    const content = fs.readFileSync(file, "utf8");
    for (const domain of FORBIDDEN) {
      if (content.includes(domain)) {
        found.push(`${file}: ${domain}`);
      }
    }
  }
}

if (found.length) {
  console.error(`Forbidden third parties in the build:\n${found.join("\n")}`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(`No forbidden third party in ${dir}`);
