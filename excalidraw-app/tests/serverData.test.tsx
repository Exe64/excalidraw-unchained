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
});
