// Backend of the editor's AI features ("Text to diagram" and "Wireframe to
// code"), replacing excalidraw.com's AI service with the provider configured
// by the administrator: Claude (Anthropic API) or any OpenAI-compatible API
// (OpenAI, Mistral, Ollama, LM Studio, vLLM…).
//
// Same endpoints and streaming format as excalidraw.com's service, so the
// editor works unchanged: server-sent events carrying
// `{"type":"content","delta":"…"}` chunks, then `[DONE]`.

import Anthropic from "@anthropic-ai/sdk";

import { config } from "./config.js";

const MAX_MESSAGES = 50;
const MAX_INPUT_CHARS = 100_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** models accepting the server-side refusal fallback (`fallbacks: "default"`) */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

const TEXT_TO_DIAGRAM_PROMPT = `You are the "text to diagram" assistant of Excalidraw, a hand-drawn style whiteboard. You turn the user's description into a Mermaid diagram, which the editor converts into editable shapes.

Output rules:
- Reply with the Mermaid definition only: no code fences, no explanation, no comments before or after.
- Prefer "flowchart" (TD or LR): it converts into fully editable shapes. sequenceDiagram, classDiagram, erDiagram and stateDiagram-v2 also convert well; other diagram types are inserted as a picture.
- Keep node labels short, write them in the user's language, and wrap labels containing special characters in double quotes.
- Use subgraphs to group related nodes when it helps readability.
- When the conversation continues, apply the requested change to your previous diagram and output the complete updated definition.`;

const DIAGRAM_TO_CODE_PROMPT = `You turn wireframes drawn in Excalidraw into working web pages.

Output rules:
- Reply with one complete, self-contained HTML document only (starting with <!DOCTYPE html>): no code fences, no explanation.
- Inline all CSS and JavaScript; don't load external resources (no CDNs, fonts or images from the Internet). Use simple inline SVG or CSS shapes for images and icons.
- Reproduce the layout, the components and all the texts of the wireframe faithfully, and make interactive elements (buttons, tabs, inputs) behave plausibly.
- Make it look clean and modern, and responsive.`;

export const getAiInfo = () => ({
  enabled: !!config.ai.provider,
  provider: config.ai.provider || null,
  model: config.ai.provider ? config.ai.model : null,
});

// rate limiting (per user, per day)
// -----------------------------------------------------------------------------

const usage = new Map();

const consumeQuota = (userId) => {
  const limit = config.ai.requestsPerDay;
  if (!limit) {
    return { allowed: true };
  }
  const now = Date.now();
  const entry = usage.get(userId);
  const current =
    entry && entry.resetAt > now
      ? entry
      : { count: 0, resetAt: now + 24 * 3600e3 };
  if (current.count >= limit) {
    usage.set(userId, current);
    return { allowed: false, limit, remaining: 0 };
  }
  current.count++;
  usage.set(userId, current);
  return { allowed: true, limit, remaining: limit - current.count };
};

// output post-processing
// -----------------------------------------------------------------------------

/**
 * Drops markdown code fences (```mermaid … ```) from a stream of text deltas,
 * in case the model adds them anyway. Works line by line, so text is held
 * back until the end of the current line.
 */
const createFenceFilter = (emit) => {
  let buffer = "";
  const emitLine = (line) => {
    if (!/^\s*```/.test(line)) {
      emit(line);
    }
  };
  return {
    push(delta) {
      buffer += delta;
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        emitLine(buffer.slice(0, index + 1));
        buffer = buffer.slice(index + 1);
      }
    },
    flush() {
      if (buffer) {
        emitLine(buffer);
        buffer = "";
      }
    },
  };
};

// providers
// -----------------------------------------------------------------------------

class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const parseDataUrl = (dataURL) => {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(
    dataURL || "",
  );
  if (!match) {
    throw new AiError(400, "Invalid image.");
  }
  if ((match[2].length * 3) / 4 > MAX_IMAGE_BYTES) {
    throw new AiError(413, "Image too large.");
  }
  return { mediaType: match[1], data: match[2] };
};

/**
 * Streams a completion from Claude. `content` items are
 * `{ type: "text", text }` or `{ type: "image", dataURL }`.
 */
const streamAnthropic = async ({ system, messages, signal, onText }) => {
  const client = new Anthropic({
    apiKey: config.ai.apiKey || undefined,
    ...(config.ai.baseUrl ? { baseURL: config.ai.baseUrl } : {}),
  });
  const params = {
    model: config.ai.model,
    max_tokens: 64000,
    system,
    output_config: { effort: config.ai.effort },
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content.map((part) =>
        part.type === "image"
          ? {
              type: "image",
              source: {
                type: "base64",
                media_type: parseDataUrl(part.dataURL).mediaType,
                data: parseDataUrl(part.dataURL).data,
              },
            }
          : { type: "text", text: part.text },
      ),
    })),
  };
  // on a policy decline, let the API retry with a suitable model
  const useFallbacks = FALLBACK_MODELS.has(config.ai.model);
  const stream = useFallbacks
    ? client.beta.messages.stream(
        {
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      )
    : client.messages.stream(params, { signal });

  try {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        onText(event.delta.text);
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new AiError(422, "The model declined this request.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiError(500, "The answer was too long and got cut off.");
    }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError(429, "The AI provider is rate limiting requests.");
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiError(502, "Invalid AI provider credentials (AI_API_KEY).");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiError(502, `AI provider error: ${error.message}`);
    }
    throw error;
  }
};

/** Streams a completion from an OpenAI-compatible chat completions API */
const streamOpenAiCompatible = async ({ system, messages, signal, onText }) => {
  const headers = { "Content-Type": "application/json" };
  if (config.ai.apiKey) {
    headers.Authorization = `Bearer ${config.ai.apiKey}`;
  }
  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: config.ai.model,
      stream: true,
      messages: [
        { role: "system", content: system },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content.some((part) => part.type === "image")
            ? message.content.map((part) =>
                part.type === "image"
                  ? {
                      type: "image_url",
                      image_url: {
                        url: `data:${
                          parseDataUrl(part.dataURL).mediaType
                        };base64,${parseDataUrl(part.dataURL).data}`,
                      },
                    }
                  : { type: "text", text: part.text },
              )
            : message.content.map((part) => part.text).join("\n"),
        })),
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new AiError(429, "The AI provider is rate limiting requests.");
    }
    throw new AiError(
      502,
      `AI provider error (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!line.trim().startsWith("data:") || data === "[DONE]") {
        continue;
      }
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) {
          onText(delta);
        }
      } catch {
        // keep-alive or partial line
      }
    }
  }
};

const streamCompletion = (args) =>
  config.ai.provider === "anthropic"
    ? streamAnthropic(args)
    : streamOpenAiCompatible(args);

// HTTP handlers
// -----------------------------------------------------------------------------

/**
 * Runs a streaming generation and relays it to the client as server-sent
 * events, in excalidraw.com's AI service format.
 */
const handleGeneration = async (req, res, { system, messages, onError }) => {
  if (!config.ai.provider) {
    return onError(
      503,
      "AI features aren't configured on this server (see AI_PROVIDER).",
    );
  }
  const quota = consumeQuota(req.user.id);
  if (quota.limit) {
    res.setHeader("X-Ratelimit-Limit", String(quota.limit));
    res.setHeader("X-Ratelimit-Remaining", String(quota.remaining));
  }
  if (!quota.allowed) {
    return onError(429, "Too many AI requests, try again later.");
  }

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  let started = false;
  const send = (chunk) => {
    if (!started) {
      started = true;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
    res.write(
      `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`,
    );
  };
  const filter = createFenceFilter((delta) => send({ type: "content", delta }));

  try {
    await streamCompletion({
      system,
      messages,
      signal: abort.signal,
      onText: (text) => filter.push(text),
    });
    filter.flush();
    send({ type: "done", finishReason: "stop" });
    send("[DONE]");
    res.end();
  } catch (error) {
    if (abort.signal.aborted) {
      return res.end();
    }
    if (!(error instanceof AiError)) {
      console.error(error);
    }
    const message =
      error instanceof AiError ? error.message : "AI generation failed.";
    if (started) {
      send({ type: "error", error: { message } });
      send("[DONE]");
      return res.end();
    }
    onError(error instanceof AiError ? error.status : 500, message);
  }
};

const validateChatMessages = (messages) => {
  if (!Array.isArray(messages) || !messages.length) {
    throw new AiError(400, "Missing messages.");
  }
  const recent = messages.slice(-MAX_MESSAGES);
  let total = 0;
  const valid = recent
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim(),
    )
    .map((message) => {
      total += message.content.length;
      return {
        role: message.role,
        content: [{ type: "text", text: message.content }],
      };
    });
  // the conversation must start with the user
  while (valid.length && valid[0].role !== "user") {
    valid.shift();
  }
  if (!valid.length) {
    throw new AiError(400, "Missing messages.");
  }
  if (total > MAX_INPUT_CHARS) {
    throw new AiError(413, "The conversation is too long.");
  }
  return valid;
};

export const textToDiagramHandler = (req, res) => {
  // the editor shows the response body as the error message
  const onError = (status, message) =>
    res.status(status).type("text/plain").send(message);
  let messages;
  try {
    messages = validateChatMessages(req.body?.messages);
  } catch (error) {
    return onError(error.status || 400, error.message);
  }
  return handleGeneration(req, res, {
    system: TEXT_TO_DIAGRAM_PROMPT,
    messages,
    onError,
  });
};

export const diagramToCodeHandler = (req, res) => {
  // the editor expects `{ statusCode, message }`
  const onError = (status, message) =>
    res.status(status).json({ statusCode: status, message });
  const { texts, image, theme } = req.body || {};
  try {
    parseDataUrl(image);
  } catch (error) {
    return onError(error.status, error.message);
  }
  const textList =
    typeof texts === "string" ? texts.slice(0, MAX_INPUT_CHARS) : "";
  return handleGeneration(req, res, {
    system: DIAGRAM_TO_CODE_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", dataURL: image },
          {
            type: "text",
            text: `Turn this wireframe into a web page (${
              theme === "dark" ? "dark" : "light"
            } theme).${
              textList ? `\n\nTexts found in the wireframe:\n${textList}` : ""
            }`,
          },
        ],
      },
    ],
    onError,
  });
};
