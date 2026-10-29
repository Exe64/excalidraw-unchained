# --- build the frontend --------------------------------------------------------
FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

ARG NODE_ENV=production

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker

# --- runtime: the server serves the API, the collab sockets and the app --------
FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public

WORKDIR /app/server

COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/src ./src
COPY --from=build /opt/node_app/excalidraw-app/build /app/public

VOLUME ["/data"]
EXPOSE 80

HEALTHCHECK CMD node -e "fetch('http://localhost:' + process.env.PORT + '/api/auth/config').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
