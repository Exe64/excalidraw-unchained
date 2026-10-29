import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";

let app;
let appUrl;
let cookie;
let provider;
let providerUrl;
let lastProviderRequest;
let providerReply = ["flowchart LR\n", "  A --> B\n"];

const sse = (res, event, data) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** fake AI provider: Anthropic Messages API & OpenAI chat completions */
const providerHandler = async (req, res) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  lastProviderRequest = {
    url: req.url,
    headers: req.headers,
    body: JSON.parse(body),
  };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (req.url.startsWith("/v1/messages")) {
    sse(res, "message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: lastProviderRequest.body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    sse(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    for (const text of ["```mermaid\n", ...providerReply, "```"]) {
      sse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      });
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 10 },
    });
    sse(res, "message_stop", { type: "message_stop" });
  } else {
    for (const text of providerReply) {
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: text } }],
        })}\n\n`,
      );
    }
    res.write("data: [DONE]\n\n");
  }
  res.end();
};

const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );

const readEvents = async (res) => {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
};

const post = (path, body, headers = {}) =>
  fetch(`${appUrl}/api/ai/v1/ai/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      // the editor's AI requests carry no custom header, only their Origin
      Origin: appUrl,
      Cookie: cookie,
      ...headers,
    },
    body: JSON.stringify(body),
  });

before(async () => {
  provider = http.createServer(providerHandler);
  providerUrl = await listen(provider);

  const db = openDatabase(":memory:");
  await createUser(db, { username: "alice", password: "password-a" });
  app = http.createServer(createApp(db));
  appUrl = await listen(app);
  const res = await fetch(`${appUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "excalidraw",
    },
    body: JSON.stringify({ username: "alice", password: "password-a" }),
  });
  cookie = res.headers.get("set-cookie").split(";")[0];
});

after(() => {
  app.closeAllConnections();
  app.close();
  provider.closeAllConnections();
  provider.close();
});

beforeEach(() => {
  lastProviderRequest = null;
  config.ai.requestsPerDay = 60;
});

describe("AI features", () => {
  it("are disabled when no provider is configured", async () => {
    config.ai.provider = "";
    const res = await post("text-to-diagram/chat-streaming", {
      messages: [{ role: "user", content: "a flowchart" }],
    });
    assert.equal(res.status, 503);
  });

  it("stream text-to-diagram from Claude, without code fences", async () => {
    Object.assign(config.ai, {
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-opus-5-5",
      baseUrl: providerUrl,
      effort: "medium",
    });
    const res = await post("text-to-diagram/chat-streaming", {
      messages: [
        { role: "assistant", content: "Hi! What should I draw?" },
        { role: "user", content: "two boxes" },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-ratelimit-limit"), "60");
    const events = await readEvents(res);
    const text = events
      .filter((event) => event.type === "content")
      .map((event) => event.delta)
      .join("");
    assert.equal(text, "flowchart LR\n  A --> B\n");
    assert.equal(events.at(-1).type, "done");

    const { body, headers } = lastProviderRequest;
    // (the SDK sends the key in one header or the other)
    assert.ok(
      headers["x-api-key"] === "test-key" ||
        headers.authorization === "Bearer test-key",
    );
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.output_config, { effort: "medium" });
    // conversations sent to the API start with the user
    assert.equal(body.messages[0].role, "user");
    assert.match(body.system, /Mermaid/);
  });

  it("send wireframes as images to an OpenAI-compatible API", async () => {
    Object.assign(config.ai, {
      provider: "openai",
      apiKey: "sk-test",
      model: "my-model",
      baseUrl: `${providerUrl}/v1`,
    });
    providerReply = ["<!DOCTYPE html>", "<html></html>"];
    const res = await post("diagram-to-code/generate-streaming", {
      texts: "Login",
      image: "data:image/jpeg;base64,AAAA",
      theme: "light",
    });
    assert.equal(res.status, 200);
    const html = (await readEvents(res))
      .filter((event) => event.type === "content")
      .map((event) => event.delta)
      .join("");
    assert.equal(html, "<!DOCTYPE html><html></html>");
    const { url, body, headers } = lastProviderRequest;
    assert.equal(url, "/v1/chat/completions");
    assert.equal(headers.authorization, "Bearer sk-test");
    assert.equal(body.messages[0].role, "system");
    assert.equal(
      body.messages[1].content[0].image_url.url,
      "data:image/jpeg;base64,AAAA",
    );
  });

  it("enforce the per-user quota", async () => {
    config.ai.requestsPerDay = 1;
    const first = await post("text-to-diagram/chat-streaming", {
      messages: [{ role: "user", content: "x" }],
    });
    await first.text();
    // the earlier tests already used today's quota
    const second = await post("text-to-diagram/chat-streaming", {
      messages: [{ role: "user", content: "x" }],
    });
    assert.equal(second.status, 429);
  });

  it("refuse cross-origin requests", async () => {
    const res = await post(
      "text-to-diagram/chat-streaming",
      { messages: [{ role: "user", content: "x" }] },
      { Origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });
});
