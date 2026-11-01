/* eslint-disable no-console */
// Applies updates of the application: a separate service, the only one with
// access to the Docker socket. The application asks it to install a release;
// it can do nothing else: the container and the image are set by its own
// environment, the version must be a release, and it has no port on the host.

import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

const RELEASE_RE = /^\d+\.\d+\.\d+$/;

/** values that come from the image, not from how the container was created */
const IMAGE_CONFIG_KEYS = [
  "Cmd",
  "Entrypoint",
  "ExposedPorts",
  "Healthcheck",
  "OnBuild",
  "Shell",
  "StopSignal",
  "User",
  "Volumes",
  "WorkingDir",
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What to create to replace `container` (from `GET /containers/x/json`) with
 * `target`. Settings inherited from the current image (`image`, from
 * `GET /images/x/json`) are left out, or the new container would keep them:
 * APP_VERSION above all.
 */
export const containerSpec = (container, image, target) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { Hostname, Image, ...containerConfig } = container.Config;
  const imageConfig = image.Config || {};
  const spec = {
    ...containerConfig,
    Image: target,
    Env: (containerConfig.Env || []).filter(
      (entry) => !(imageConfig.Env || []).includes(entry),
    ),
    Labels: Object.fromEntries(
      Object.entries(containerConfig.Labels || {}).filter(
        ([key, value]) => imageConfig.Labels?.[key] !== value,
      ),
    ),
  };
  for (const key of IMAGE_CONFIG_KEYS) {
    if (same(spec[key], imageConfig[key])) {
      delete spec[key];
    }
  }

  // an anonymous volume would be replaced by an empty one
  const hostConfig = { ...container.HostConfig };
  const declared = [
    ...(hostConfig.Binds || []).map((bind) => bind.split(":")[1]),
    ...(hostConfig.Mounts || []).map((mount) => mount.Target),
  ];
  const anonymous = (container.Mounts || []).filter(
    (mount) => mount.Type === "volume" && !declared.includes(mount.Destination),
  );
  if (anonymous.length) {
    hostConfig.Binds = [
      ...(hostConfig.Binds || []),
      ...anonymous.map((mount) => `${mount.Name}:${mount.Destination}`),
    ];
  }

  return {
    ...spec,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: Object.fromEntries(
        Object.entries(container.NetworkSettings?.Networks || {}).map(
          ([name, { Aliases, IPAMConfig, Links }]) => [
            name,
            { Aliases, IPAMConfig, Links },
          ],
        ),
      ),
    },
  };
};

/** a request to the Docker API; rejects on an error status, except `allowed` */
const socketRequest =
  (socketPath) =>
  (method, path, body, allowed = []) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          method,
          path,
          headers: body ? { "Content-Type": "application/json" } : {},
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            if (res.statusCode >= 400 && !allowed.includes(res.statusCode)) {
              let message = text;
              try {
                message = JSON.parse(text).message;
              } catch {
                // not JSON
              }
              return reject(new Error(`${method} ${path}: ${message}`));
            }
            try {
              resolve({ status: res.statusCode, data: JSON.parse(text) });
            } catch {
              resolve({ status: res.statusCode, data: text });
            }
          });
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });

export const createUpdater = ({
  docker,
  image,
  containerName,
  healthTimeoutMs = 120e3,
  pollMs = 2000,
}) => {
  const previousName = `${containerName}-previous`;
  const status = { state: "idle" };

  const inspect = async (name) => {
    const { status: code, data } = await docker(
      "GET",
      `/containers/${name}/json`,
      undefined,
      [404],
    );
    return code === 404 ? null : data;
  };

  const pull = async (tag) => {
    const { data } = await docker(
      "POST",
      `/images/create?fromImage=${encodeURIComponent(
        image,
      )}&tag=${encodeURIComponent(tag)}`,
    );
    // the response is a stream of JSON lines, errors included
    for (const line of String(data).split("\n")) {
      if (line.includes('"error"')) {
        throw new Error(`Pull failed: ${JSON.parse(line).error}`);
      }
    }
  };

  const waitUntilHealthy = async (name) => {
    const deadline = Date.now() + healthTimeoutMs;
    let last = "unknown";
    while (Date.now() < deadline) {
      const { State } = await inspect(name);
      last = State.Health?.Status ?? State.Status;
      if (last === "healthy" || (!State.Health && State.Running)) {
        return;
      }
      if (last === "unhealthy") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`The new container isn't healthy (${last})`);
  };

  const startContainer = () =>
    docker("POST", `/containers/${containerName}/start`, undefined, [304]);

  /** puts the previous container back in place */
  const restorePrevious = async () => {
    // not renamed yet: the current container is still the only one
    if (await inspect(previousName)) {
      await docker(
        "DELETE",
        `/containers/${containerName}?force=true`,
        undefined,
        [404],
      );
      await docker(
        "POST",
        `/containers/${previousName}/rename?name=${containerName}`,
      );
    }
    await startContainer();
  };

  const install = async (version) => {
    let replacing = false;
    try {
      status.step = "pull";
      const current = await inspect(containerName);
      if (!current) {
        throw new Error(`Container ${containerName} not found`);
      }
      await pull(version);
      const { data: currentImage } = await docker(
        "GET",
        `/images/${encodeURIComponent(current.Image)}/json`,
      );
      const spec = containerSpec(current, currentImage, `${image}:${version}`);

      // left by an update whose cleanup failed
      await docker("DELETE", `/containers/${previousName}`, undefined, [404]);

      status.step = "replace";
      replacing = true;
      await docker(
        "POST",
        `/containers/${containerName}/stop?t=30`,
        undefined,
        [304],
      );
      await docker(
        "POST",
        `/containers/${containerName}/rename?name=${previousName}`,
      );
      await docker("POST", `/containers/create?name=${containerName}`, spec);
      await docker("POST", `/containers/${containerName}/start`);

      status.step = "health";
      await waitUntilHealthy(containerName);

      // from here on, the update has succeeded whatever happens
      replacing = false;
      await docker("DELETE", `/containers/${previousName}`).catch((error) =>
        console.error(error),
      );
      Object.assign(status, { state: "succeeded", finishedAt: Date.now() });
    } catch (error) {
      console.error(error);
      Object.assign(status, {
        state: "failed",
        error: error.message,
        rolledBack: false,
        finishedAt: Date.now(),
      });
      if (replacing) {
        try {
          status.step = "rollback";
          await restorePrevious();
          status.rolledBack = true;
        } catch (rollbackError) {
          console.error(rollbackError);
          status.error += ` / rollback failed: ${rollbackError.message}`;
        }
      }
    }
  };

  return {
    getStatus: () => ({ ...status }),

    /** starts installing, returns before it's done; throws if already busy */
    start: (version) => {
      if (!RELEASE_RE.test(version)) {
        throw Object.assign(new Error("Invalid version"), { status: 400 });
      }
      if (status.state === "running") {
        throw Object.assign(new Error("Already updating"), { status: 409 });
      }
      for (const key of Object.keys(status)) {
        delete status[key];
      }
      Object.assign(status, { state: "running", target: version });
      return install(version);
    },

    /**
     * This service stopped during an update: keeps the new container if it
     * works, or else undoes the update.
     */
    recover: async () => {
      if (!(await inspect(previousName))) {
        return;
      }
      const current = await inspect(containerName);
      if (current?.State.Health?.Status === "healthy") {
        await docker("DELETE", `/containers/${previousName}`);
        return;
      }
      console.warn("Interrupted update: restoring the previous container.");
      await restorePrevious();
    },
  };
};

const main = async () => {
  const secret = process.env.UPDATER_SECRET;
  if (!secret) {
    console.error("UPDATER_SECRET is required.");
    process.exit(1);
  }
  const digest = (value) => crypto.createHash("sha256").update(value).digest();

  const updater = createUpdater({
    docker: socketRequest(process.env.DOCKER_SOCKET || "/var/run/docker.sock"),
    image: process.env.UPDATE_IMAGE || "ghcr.io/exe64/excalidraw-unchained",
    containerName: process.env.APP_CONTAINER || "excalidraw",
    healthTimeoutMs:
      Number(process.env.UPDATE_HEALTH_TIMEOUT_SECONDS || 120) * 1000,
  });
  await updater.recover().catch((error) => console.error(error));

  const send = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  http
    .createServer((req, res) => {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!crypto.timingSafeEqual(digest(token), digest(secret))) {
        return send(res, 401, { error: "Unauthorized" });
      }
      if (req.method === "GET" && req.url === "/status") {
        return send(res, 200, updater.getStatus());
      }
      if (req.method === "POST" && req.url === "/update") {
        let text = "";
        req.on("data", (chunk) => {
          text += chunk;
          if (text.length > 1024) {
            req.destroy();
          }
        });
        req.on("end", () => {
          try {
            updater.start(JSON.parse(text).version);
            send(res, 202, updater.getStatus());
          } catch (error) {
            send(res, error.status || 400, { error: error.message });
          }
        });
        return;
      }
      send(res, 404, { error: "Not found" });
    })
    .listen(Number(process.env.UPDATER_PORT || 3006), () => {
      console.log("Updater listening.");
    });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
