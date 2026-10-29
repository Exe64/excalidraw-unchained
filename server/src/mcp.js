// MCP (Model Context Protocol) server, so that AI assistants such as Claude
// can read and create diagrams in the user's drawings.
//
// Streamable HTTP transport, stateless. Authenticated with a personal access
// token, sent either as `Authorization: Bearer <token>` (preferred) or in the
// URL (`/mcp/<token>`) for clients which can't send custom headers.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { config } from "./config.js";
import {
  DrawingError,
  SKELETON_TYPES,
  addToDrawing,
  createDrawingWithContent,
  describeDrawing,
  getUserDrawing,
  listUserDrawings,
  removeElements,
  renameDrawing,
  updateElements,
} from "./drawings.js";
import { getApiTokenUser, getBearerToken } from "./tokens.js";

const INSTRUCTIONS = `This server gives access to the user's Excalidraw drawings (a hand-drawn style whiteboard).

Workflow:
- To draw something new, call create_drawing. To add to an existing drawing, call get_drawing first (to know what's there and where), then add_to_drawing.
- New content is queued and converted into Excalidraw elements by the editor when the drawing is opened (it appears live in an editor where the drawing is already open). Always give the user the drawing's URL.
- Prefer \`mermaid\` for flowcharts, sequence diagrams, class/ER diagrams and the like: the editor lays them out automatically. Use \`elements\` for free-form layouts (architecture diagrams, wireframes, annotated sketches) where you control positions.

Element format (\`elements\`): an array of objects, each with a \`type\` and absolute \`x\`/\`y\` (top-left corner, in pixels, y grows downwards):
- "rectangle", "ellipse", "diamond": width, height, optional label: {"text": "...", "fontSize": 20}. Rounded corners: "roundness": {"type": 3}.
- "text": "text" (use \\n for line breaks), optional fontSize (16 small, 20 normal, 28 large, 36 very large).
- "arrow" or "line": x/y is the start point; "points": [[0,0],[dx,dy], ...] relative to x/y (or width/height for a straight segment). Connect shapes with "start": {"id": "<shape id>"} and "end": {"id": "<shape id>"}; the editor snaps the ends to the shapes. Optional label: {"text": "..."}, "startArrowhead"/"endArrowhead": "arrow" | "triangle" | "dot" | "bar" | null.
- "frame": "children": [ids of the elements inside], "name": "...".
Give an "id" (letters, digits, - and _) to every element you'll reference from arrows or frames, or change later.
Common style properties: strokeColor and backgroundColor (hex, e.g. "#1e1e1e" black, "#e03131" red, "#2f9e44" green, "#1971c2" blue, "#f08c00" orange, "#6741d9" violet; light fills: "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff"), fillStyle ("solid" | "hachure" | "cross-hatch"), strokeWidth (1, 2, 4), strokeStyle ("solid" | "dashed" | "dotted"), roughness (0 clean, 1 hand-drawn, 2 sketchy), opacity (0-100).
Layout tips: leave ~60px between shapes, size shapes to fit their labels (about 10px per character at fontSize 20, plus padding), and group related parts in frames.`;

const elementsSchema = z
  .array(
    z.looseObject({
      type: z.enum(SKELETON_TYPES),
      id: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
  )
  .describe(
    "Elements to draw (see the server instructions for the format). Example: " +
      '[{"type":"rectangle","id":"api","x":0,"y":0,"width":160,"height":80,"label":{"text":"API"}},' +
      '{"type":"rectangle","id":"db","x":300,"y":0,"width":160,"height":80,"label":{"text":"Database"}},' +
      '{"type":"arrow","x":160,"y":40,"points":[[0,0],[140,0]],"start":{"id":"api"},"end":{"id":"db"},"label":{"text":"SQL"}}]',
  );

const mermaidSchema = z
  .string()
  .describe(
    "A Mermaid diagram definition (flowchart, sequenceDiagram, classDiagram, erDiagram, …), converted to editable Excalidraw shapes.",
  );

const drawingIdSchema = z.string().describe("Id of the drawing");

const result = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const errorResult = (error) => ({
  isError: true,
  content: [
    {
      type: "text",
      text:
        error instanceof DrawingError
          ? error.message
          : "Unexpected error, please retry.",
    },
  ],
});

const buildServer = (db, user, baseUrl) => {
  const server = new McpServer(
    { name: "excalidraw-unchained", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  const drawingUrl = (id) => `${baseUrl}/?drawing=${encodeURIComponent(id)}`;

  const withDrawing = (row) => ({
    id: row.id,
    name: row.name,
    url: drawingUrl(row.id),
    version: row.version,
  });

  /** wraps a tool handler: maps errors to tool errors */
  const handler = (fn) => async (args) => {
    try {
      return result(await fn(args));
    } catch (error) {
      if (!(error instanceof DrawingError)) {
        console.error(error);
      }
      return errorResult(error);
    }
  };

  server.registerTool(
    "list_drawings",
    {
      title: "List drawings",
      description:
        "Lists the user's drawings and the ones shared with them (role: owner, edit or view), most recently edited first, with their id and URL.",
      annotations: { readOnlyHint: true },
    },
    handler(() => ({
      drawings: listUserDrawings(db, user.id).map((drawing) => ({
        ...drawing,
        url: drawingUrl(drawing.id),
        updatedAt: new Date(drawing.updatedAt).toISOString(),
        createdAt: new Date(drawing.createdAt).toISOString(),
      })),
    })),
  );

  server.registerTool(
    "get_drawing",
    {
      title: "Read a drawing",
      description:
        "Returns the content of a drawing: its elements (id, type, position, size, text/label, colors, arrow connections), their overall bounds, and changes still waiting to be applied by the editor.",
      inputSchema: { drawing_id: drawingIdSchema },
      annotations: { readOnlyHint: true },
    },
    handler(({ drawing_id }) => {
      const row = getUserDrawing(db, user.id, drawing_id, "view");
      return { ...describeDrawing(row), url: drawingUrl(row.id) };
    }),
  );

  server.registerTool(
    "create_drawing",
    {
      title: "Create a drawing",
      description:
        "Creates a new drawing, optionally with content (elements and/or a Mermaid diagram). Returns its URL.",
      inputSchema: {
        name: z.string().optional().describe("Name of the drawing"),
        elements: elementsSchema.optional(),
        mermaid: mermaidSchema.optional(),
      },
    },
    handler(({ name, elements, mermaid }) =>
      withDrawing(
        createDrawingWithContent(db, user.id, { name, elements, mermaid }),
      ),
    ),
  );

  server.registerTool(
    "add_to_drawing",
    {
      title: "Add to a drawing",
      description:
        "Adds elements and/or a Mermaid diagram to an existing drawing. Call get_drawing first to place new content next to the existing one. Without x/y, a Mermaid diagram is placed to the right of the existing content.",
      inputSchema: {
        drawing_id: drawingIdSchema,
        elements: elementsSchema.optional(),
        mermaid: mermaidSchema.optional(),
        x: z
          .number()
          .optional()
          .describe("Position of the Mermaid diagram (top-left)"),
        y: z.number().optional(),
      },
    },
    handler(({ drawing_id, elements, mermaid, x, y }) =>
      withDrawing(
        addToDrawing(db, getUserDrawing(db, user.id, drawing_id, "edit"), {
          elements,
          mermaid,
          x,
          y,
        }),
      ),
    ),
  );

  server.registerTool(
    "update_elements",
    {
      title: "Move or restyle elements",
      description:
        "Changes the position, size or style of existing elements (moving a shape also moves its label). To change a text or label, remove the element and add a new one.",
      inputSchema: {
        drawing_id: drawingIdSchema,
        updates: z
          .array(
            z.object({
              id: z.string(),
              x: z.number().optional(),
              y: z.number().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              angle: z.number().optional().describe("Rotation, in radians"),
              strokeColor: z.string().optional(),
              backgroundColor: z.string().optional(),
              fillStyle: z
                .enum(["solid", "hachure", "cross-hatch", "zigzag"])
                .optional(),
              strokeWidth: z.number().optional(),
              strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
              roughness: z.number().optional(),
              opacity: z.number().optional(),
            }),
          )
          .describe("One entry per element to change"),
      },
    },
    handler(({ drawing_id, updates }) => {
      const { row, updated, missing } = updateElements(
        db,
        getUserDrawing(db, user.id, drawing_id, "edit"),
        updates,
        user.id,
      );
      return { ...withDrawing(row), updated, missing };
    }),
  );

  server.registerTool(
    "remove_elements",
    {
      title: "Remove elements",
      description:
        "Removes elements from a drawing (with their labels). The previous state is kept in the drawing's version history, from which the user can restore it.",
      inputSchema: {
        drawing_id: drawingIdSchema,
        element_ids: z.array(z.string()).describe("Ids of the elements"),
      },
      annotations: { destructiveHint: true },
    },
    handler(({ drawing_id, element_ids }) => {
      const { row, removed } = removeElements(
        db,
        getUserDrawing(db, user.id, drawing_id, "edit"),
        element_ids,
        user.id,
      );
      return { ...withDrawing(row), removed };
    }),
  );

  server.registerTool(
    "rename_drawing",
    {
      title: "Rename a drawing",
      inputSchema: {
        drawing_id: drawingIdSchema,
        name: z.string(),
      },
    },
    handler(({ drawing_id, name }) =>
      withDrawing(
        renameDrawing(
          db,
          getUserDrawing(db, user.id, drawing_id, "owner"),
          name,
        ),
      ),
    ),
  );

  return server;
};

const getBaseUrl = (req) =>
  config.publicUrl || `${req.protocol}://${req.get("host")}`;

const jsonRpcError = (res, status, message) =>
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });

export const createMcpRouter = (db) => {
  const router = express.Router();
  router.use(express.json({ limit: config.maxBodySize }));

  const handle = async (req, res, token) => {
    const user = getApiTokenUser(db, token);
    if (!user) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="excalidraw"');
      return jsonRpcError(
        res,
        401,
        "Missing or invalid access token. Create one in Excalidraw: menu > API access (MCP).",
      );
    }
    const server = buildServer(db, user, getBaseUrl(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  router.post("/", (req, res) => handle(req, res, getBearerToken(req)));
  router.post("/:token", (req, res) =>
    handle(req, res, getBearerToken(req) || req.params.token),
  );

  // stateless server: no SSE stream to resume, no session to delete
  router.all(["/", "/:token"], (req, res) =>
    jsonRpcError(res, 405, "Method not allowed."),
  );

  return router;
};
