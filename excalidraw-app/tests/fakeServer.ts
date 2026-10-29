import { vi } from "vitest";

/**
 * Minimal in-memory implementation of the server API (see /server) so that
 * the app can be rendered in tests as a signed-in user.
 */
export const installFakeServer = () => {
  const now = Date.now();
  const drawings = new Map<string, any>([
    [
      "drawing-1",
      {
        id: "drawing-1",
        name: "Test drawing",
        version: 1,
        createdAt: now,
        updatedAt: now,
        elements: [],
        appState: {},
      },
    ],
  ]);
  let library: any = null;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const handle = async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url, window.location.origin);
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const summary = ({ elements, appState, ...rest }: any) => rest;

    if (pathname === "/api/auth/me" || pathname === "/api/auth/login") {
      return json(200, {
        user: { id: "user-1", username: "tester", isAdmin: false },
      });
    }
    if (pathname === "/api/auth/config") {
      return json(200, { allowRegistration: false });
    }
    if (pathname === "/api/library") {
      if (method === "PUT") {
        library = body;
        return json(200, { ok: true });
      }
      return json(200, { library });
    }
    if (pathname === "/api/drawings") {
      if (method === "POST") {
        const id = `drawing-${drawings.size + 1}`;
        const drawing = {
          id,
          name: body?.name || `Untitled ${drawings.size + 1}`,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          elements: body?.elements || [],
          appState: body?.appState || {},
        };
        drawings.set(id, drawing);
        return json(201, { drawing });
      }
      return json(200, { drawings: [...drawings.values()].map(summary) });
    }
    const match = pathname.match(/^\/api\/drawings\/([^/]+)(\/version)?$/);
    if (match) {
      const drawing = drawings.get(decodeURIComponent(match[1]));
      if (!drawing) {
        return json(404, { error: "not found" });
      }
      if (match[2]) {
        return json(200, {
          version: drawing.version,
          updatedAt: drawing.updatedAt,
        });
      }
      if (method === "PUT") {
        const applied = new Set(body.appliedOps || []);
        Object.assign(drawing, {
          pendingOps: (drawing.pendingOps || []).filter(
            (op: any) => !applied.has(op.id),
          ),
          name: body.name || drawing.name,
          elements: body.elements,
          appState: body.appState,
          version: drawing.version + 1,
          updatedAt: Date.now(),
        });
        return json(200, {
          version: drawing.version,
          updatedAt: drawing.updatedAt,
          name: drawing.name,
        });
      }
      return json(200, { drawing });
    }
    return json(404, { error: "not found" });
  };

  const originalFetch = window.fetch;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/") || url.includes("/api/")) {
      return handle(url, init);
    }
    return originalFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  return { drawings, fetchMock };
};
