import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";
import { openDatabase } from "../src/db.js";

let server;
let baseUrl;
let cookie;

const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "excalidraw",
};

const api = async (method, path, body, headers = { Cookie: cookie }) => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...HEADERS, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const connect = async (token, { inUrl = false } = {}) => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(inUrl ? `${baseUrl}/mcp/${token}` : `${baseUrl}/mcp`),
    inUrl
      ? {}
      : { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  await client.connect(transport);
  return client;
};

const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const data = res.content[0].text;
  return res.isError ? { error: data } : JSON.parse(data);
};

before(async () => {
  const db = openDatabase(":memory:");
  await createUser(db, { username: "alice", password: "password-a" });
  await createUser(db, { username: "bob", password: "password-b" });
  server = http.createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ username: "alice", password: "password-a" }),
  });
  cookie = res.headers.get("set-cookie").split(";")[0];
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe("API tokens", () => {
  it("are created, listed, used and revoked", async () => {
    const created = await api("POST", "/tokens", { name: "Claude" });
    assert.equal(created.status, 201);
    const { token, apiToken } = created.body;
    assert.match(token, /^exu_/);

    const listed = await api("GET", "/tokens");
    assert.equal(listed.body.tokens[0].name, "Claude");
    assert.equal(JSON.stringify(listed.body).includes(token), false);

    // the token authenticates REST calls…
    const auth = { Authorization: `Bearer ${token}` };
    const drawings = await api("GET", "/drawings", undefined, auth);
    assert.equal(drawings.status, 200);
    // …but can't manage tokens
    assert.equal((await api("GET", "/tokens", undefined, auth)).status, 403);

    await api("DELETE", `/tokens/${apiToken.id}`);
    assert.equal((await api("GET", "/drawings", undefined, auth)).status, 401);
  });
});

describe("MCP", () => {
  it("rejects missing or invalid tokens", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 401);
    await assert.rejects(connect("exu_invalid"));
  });

  it("creates and edits drawings, applied by the editor afterwards", async () => {
    const { token } = (await api("POST", "/tokens", { name: "t" })).body;
    const client = await connect(token);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "add_to_drawing",
      "create_drawing",
      "get_drawing",
      "list_drawings",
      "remove_elements",
      "rename_drawing",
      "update_elements",
    ]);

    const created = await call(client, "create_drawing", {
      name: "Architecture",
      elements: [
        {
          type: "rectangle",
          id: "api",
          x: 0,
          y: 0,
          width: 160,
          height: 80,
          label: { text: "API" },
        },
      ],
    });
    assert.equal(created.name, "Architecture");
    assert.match(created.url, /\/\?drawing=/);

    // invalid input is reported to the assistant
    const invalid = await call(client, "add_to_drawing", {
      drawing_id: created.id,
      elements: [{ type: "rectangle", id: "api", x: 0, y: 0 }],
    });
    assert.match(invalid.error, /already used/);

    await call(client, "add_to_drawing", {
      drawing_id: created.id,
      mermaid: "flowchart LR\n  A --> B",
    });

    // the editor sees the pending operations…
    const drawing = (await api("GET", `/drawings/${created.id}`)).body.drawing;
    assert.deepEqual(
      drawing.pendingOps.map((op) => op.type),
      ["elements", "mermaid"],
    );

    // …converts them, and acknowledges them when saving
    const saved = await api("PUT", `/drawings/${created.id}`, {
      name: drawing.name,
      elements: [
        {
          id: "api",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 160,
          height: 80,
          version: 1,
        },
        {
          id: "label",
          type: "text",
          text: "API",
          containerId: "api",
          x: 60,
          y: 30,
          width: 40,
          height: 20,
          version: 1,
        },
      ],
      appState: {},
      baseVersion: drawing.version,
      appliedOps: drawing.pendingOps.map((op) => op.id),
    });
    assert.equal(saved.status, 200);

    const described = await call(client, "get_drawing", {
      drawing_id: created.id,
    });
    assert.deepEqual(described.pending, []);
    assert.equal(described.elements.length, 1);
    assert.equal(described.elements[0].label, "API");

    const moved = await call(client, "update_elements", {
      drawing_id: created.id,
      updates: [{ id: "api", x: 100, backgroundColor: "#a5d8ff" }],
    });
    assert.equal(moved.updated, 1);
    const afterMove = (await api("GET", `/drawings/${created.id}`)).body
      .drawing;
    const label = afterMove.elements.find((e) => e.id === "label");
    assert.equal(label.x, 160);
    assert.equal(label.version, 2);

    const removed = await call(client, "remove_elements", {
      drawing_id: created.id,
      element_ids: ["api"],
    });
    assert.equal(removed.removed, 2);

    const list = await call(client, "list_drawings");
    assert.equal(list.drawings[0].id, created.id);
    await client.close();
  });

  it("only gives access to the token owner's drawings", async () => {
    const { token } = (await api("POST", "/tokens", { name: "url" })).body;
    const client = await connect(token, { inUrl: true });
    const { id } = await call(client, "create_drawing", { name: "Mine" });
    await client.close();

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ username: "bob", password: "password-b" }),
    });
    const bobCookie = res.headers.get("set-cookie").split(";")[0];
    const bobToken = (
      await api("POST", "/tokens", { name: "bob" }, { Cookie: bobCookie })
    ).body.token;
    const bob = await connect(bobToken);
    const result = await call(bob, "get_drawing", { drawing_id: id });
    assert.match(result.error, /introuvable/);
    assert.equal((await call(bob, "list_drawings")).drawings.length, 0);
    await bob.close();
  });
});
