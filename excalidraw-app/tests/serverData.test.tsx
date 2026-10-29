import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";

import { installFakeServer } from "./fakeServer";

const { h } = window;

describe("server-side drawings", () => {
  it("loads the current drawing from the server and saves changes to it", async () => {
    const { drawings, fetchMock } = installFakeServer();
    const drawing = drawings.get("drawing-1");
    drawing.name = "Architecture";
    drawing.elements = [
      API.createElement({ type: "rectangle", id: "A", width: 100 }),
    ];

    await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(h.elements.map((element) => element.id)).toEqual(["A"]);
    });
    expect(h.state.name).toBe("Architecture");
    expect(new URLSearchParams(window.location.search).get("drawing")).toBe(
      "drawing-1",
    );

    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "B" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(
      () => {
        expect(drawing.elements.map((element: any) => element.id)).toEqual([
          "A",
          "B",
        ]);
      },
      { timeout: 3000 },
    );
    expect(drawing.version).toBe(2);

    const saveRequest = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/drawings/drawing-1") &&
        init?.method === "PUT",
    );
    expect(JSON.parse(saveRequest![1]!.body as string)).toMatchObject({
      name: "Architecture",
      baseVersion: 1,
    });
  });

  it("converts changes requested through the API and acknowledges them", async () => {
    const { drawings } = installFakeServer();
    const drawing = drawings.get("drawing-1");
    drawing.pendingOps = [
      {
        id: "op-1",
        type: "elements",
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
          {
            type: "rectangle",
            id: "db",
            x: 300,
            y: 0,
            width: 160,
            height: 80,
          },
          {
            type: "arrow",
            id: "link",
            x: 160,
            y: 40,
            points: [
              [0, 0],
              [140, 0],
            ],
            start: { id: "api" },
            end: { id: "db" },
          },
        ],
      },
    ];

    await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(h.elements.map((element) => element.type).sort()).toEqual([
        "arrow",
        "rectangle",
        "rectangle",
        "text",
      ]);
    });
    const arrow = h.elements.find((element) => element.id === "link") as any;
    expect(arrow.startBinding?.elementId).toBe("api");
    expect(arrow.endBinding?.elementId).toBe("db");

    // saved, and the operation acknowledged
    await waitFor(
      () => {
        expect(drawing.pendingOps).toEqual([]);
        expect(drawing.elements.length).toBe(4);
      },
      { timeout: 3000 },
    );
  });
});
