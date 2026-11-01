import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { containerSpec, createUpdater } from "../src/updater.js";

const IMAGE = {
  Config: {
    Env: ["APP_VERSION=1.0.0", "PATH=/bin"],
    Cmd: ["node"],
    Labels: { "image.version": "1.0.0" },
  },
};

const CONTAINER = {
  Image: "sha256:old",
  Config: {
    Hostname: "abc123",
    Image: "registry/app:latest",
    Env: [
      "APP_VERSION=1.0.0",
      "PATH=/bin",
      "PUBLIC_URL=https://draw.example.com",
    ],
    Cmd: ["node"],
    Labels: {
      "image.version": "1.0.0",
      "com.docker.compose.service": "excalidraw",
    },
  },
  HostConfig: {
    Mounts: [{ Type: "volume", Source: "data", Target: "/data" }],
    RestartPolicy: { Name: "unless-stopped" },
  },
  Mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
  NetworkSettings: {
    Networks: {
      app_default: { Aliases: ["excalidraw"], IPAddress: "172.1.1.1" },
    },
  },
  State: { Running: true },
};

/** a Docker daemon that records calls; `health` is the new container's state */
const fakeDocker = ({
  health = "healthy",
  pullLines = "{}\n",
  failOn = null,
} = {}) => {
  const calls = [];
  const containers = { excalidraw: CONTAINER };
  const docker = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (failOn && path.includes(failOn)) {
      throw new Error(`refused: ${failOn}`);
    }
    const url = new URL(path, "http://docker");
    const [, kind, name, action] = url.pathname.split("/");
    if (kind === "images" && name === "create") {
      return { status: 200, data: pullLines };
    }
    if (kind === "images") {
      return { status: 200, data: IMAGE };
    }
    if (method === "GET") {
      const container = containers[name];
      return container
        ? { status: 200, data: container }
        : { status: 404, data: {} };
    }
    if (name === "create") {
      containers[url.searchParams.get("name")] = {
        spec: body,
        State: { Running: true, Health: { Status: health } },
      };
    } else if (action === "rename") {
      containers[url.searchParams.get("name")] = containers[name];
      delete containers[name];
    } else if (method === "DELETE") {
      delete containers[name];
    }
    return { status: 200, data: {} };
  };
  return { docker, calls, containers };
};

const updaterFor = (docker) =>
  createUpdater({
    docker,
    image: "registry/app",
    containerName: "excalidraw",
    healthTimeoutMs: 50,
    pollMs: 1,
  });

describe("replacement container", () => {
  const spec = containerSpec(CONTAINER, IMAGE, "registry/app:1.1.0");

  it("keeps how the container was set up", () => {
    assert.equal(spec.Image, "registry/app:1.1.0");
    assert.deepEqual(spec.Env, ["PUBLIC_URL=https://draw.example.com"]);
    assert.deepEqual(spec.HostConfig.Mounts, CONTAINER.HostConfig.Mounts);
    assert.deepEqual(spec.HostConfig.RestartPolicy, { Name: "unless-stopped" });
    assert.equal(spec.Labels["com.docker.compose.service"], "excalidraw");
    assert.deepEqual(
      spec.NetworkingConfig.EndpointsConfig.app_default.Aliases,
      ["excalidraw"],
    );
  });

  it("drops what came from the previous image", () => {
    assert.ok(!spec.Env.some((entry) => entry.startsWith("APP_VERSION=")));
    assert.equal(spec.Cmd, undefined);
    assert.equal(spec.Labels["image.version"], undefined);
    assert.equal(spec.Hostname, undefined);
  });

  it("keeps a command that differs from the image's", () => {
    const custom = {
      ...CONTAINER,
      Config: { ...CONTAINER.Config, Cmd: ["other"] },
    };
    assert.deepEqual(containerSpec(custom, IMAGE, "x").Cmd, ["other"]);
  });

  it("keeps anonymous volumes", () => {
    const anonymous = {
      ...CONTAINER,
      HostConfig: {},
      Mounts: [{ Type: "volume", Name: "f00", Destination: "/data" }],
    };
    assert.deepEqual(containerSpec(anonymous, IMAGE, "x").HostConfig.Binds, [
      "f00:/data",
    ]);
  });
});

describe("updater", () => {
  it("replaces the container and removes the previous one", async () => {
    const { docker, containers } = fakeDocker();
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    assert.equal(updater.getStatus().state, "succeeded");
    assert.equal(containers.excalidraw.spec.Image, "registry/app:1.1.0");
    assert.equal(containers["excalidraw-previous"], undefined);
  });

  it("restores the previous container if the new one isn't healthy", async () => {
    const { docker, containers } = fakeDocker({ health: "unhealthy" });
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    const status = updater.getStatus();
    assert.equal(status.state, "failed");
    assert.equal(status.rolledBack, true);
    assert.match(status.error, /unhealthy/);
    assert.equal(containers.excalidraw, CONTAINER);
    assert.equal(containers["excalidraw-previous"], undefined);
  });

  it("gives up after the timeout if the new one never gets healthy", async () => {
    const { docker, containers } = fakeDocker({ health: "starting" });
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    assert.equal(updater.getStatus().rolledBack, true);
    assert.equal(containers.excalidraw, CONTAINER);
  });

  it("doesn't touch the container if the pull fails", async () => {
    const { docker, calls, containers } = fakeDocker({
      pullLines: '{"status":"x"}\n{"error":"manifest unknown"}\n',
    });
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    const status = updater.getStatus();
    assert.equal(status.state, "failed");
    assert.equal(status.rolledBack, false);
    assert.match(status.error, /manifest unknown/);
    assert.ok(!calls.some((call) => call.includes("/stop")));
    assert.equal(containers.excalidraw, CONTAINER);
  });

  it("keeps the only container if stopping it fails", async () => {
    const { docker, containers } = fakeDocker({ failOn: "/stop" });
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    const status = updater.getStatus();
    assert.equal(status.state, "failed");
    assert.equal(status.rolledBack, true);
    assert.equal(containers.excalidraw, CONTAINER);
  });

  it("removes what a failed cleanup left before updating again", async () => {
    const { docker, containers } = fakeDocker();
    containers["excalidraw-previous"] = { State: {} };
    const updater = updaterFor(docker);
    await updater.start("1.1.0");
    assert.equal(updater.getStatus().state, "succeeded");
    assert.equal(containers["excalidraw-previous"], undefined);
  });

  it("only accepts releases, one at a time", async () => {
    const updater = updaterFor(fakeDocker().docker);
    for (const version of ["latest", "1.0", "1.0.0-rc1", "../x", undefined]) {
      assert.throws(() => updater.start(version), /Invalid version/);
    }
    const running = updater.start("1.1.0");
    assert.throws(() => updater.start("1.1.0"), /Already updating/);
    await running;
  });

  it("undoes an interrupted update", async () => {
    const { docker, containers } = fakeDocker();
    containers["excalidraw-previous"] = containers.excalidraw;
    containers.excalidraw = { spec: {}, State: { Running: false } };
    const previous = containers["excalidraw-previous"];
    await updaterFor(docker).recover();
    assert.equal(containers.excalidraw, previous);
    assert.equal(containers["excalidraw-previous"], undefined);
  });

  it("keeps a working new container after an interruption", async () => {
    const { docker, containers } = fakeDocker();
    const healthy = { spec: {}, State: { Health: { Status: "healthy" } } };
    containers["excalidraw-previous"] = containers.excalidraw;
    containers.excalidraw = healthy;
    await updaterFor(docker).recover();
    assert.equal(containers.excalidraw, healthy);
    assert.equal(containers["excalidraw-previous"], undefined);
  });
});
