/**
 * Changes requested through the server API (e.g. by an AI assistant over MCP)
 * are stored on the drawing as "pending operations": element skeletons or
 * Mermaid diagrams. They're converted to proper Excalidraw elements here, in
 * the editor, which can measure text and lay diagrams out, then acknowledged
 * when the drawing is saved.
 */

import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  charWidth,
  getCommonBounds,
  getNonDeletedElements,
  isTextElement,
} from "@excalidraw/element";
import { getFontString } from "@excalidraw/common";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

export type PendingOp =
  | {
      id: string;
      type: "elements";
      elements: ExcalidrawElementSkeleton[];
    }
  | {
      id: string;
      type: "mermaid";
      definition: string;
      x?: number;
      y?: number;
    };

/** gap between existing content and a diagram placed next to it */
const PLACEMENT_GAP = 100;

const translate = (
  elements: ExcalidrawElement[],
  dx: number,
  dy: number,
): ExcalidrawElement[] =>
  elements.map((element) => ({
    ...element,
    x: element.x + dx,
    y: element.y + dy,
  }));

/**
 * Converts skeletons, making sure text is measured with the fonts it uses: on
 * first load the editor hasn't loaded them yet, and text measured with a
 * fallback font ends up clipped. So: convert, load the fonts the result uses,
 * and convert again with the right metrics.
 */
const convertWithFonts = async (
  skeletons: readonly ExcalidrawElementSkeleton[],
  opts: { regenerateIds: boolean },
): Promise<ExcalidrawElement[]> => {
  let elements: ExcalidrawElement[] = convertToExcalidrawElements(
    skeletons as ExcalidrawElementSkeleton[],
    opts,
  );
  const textElements = elements.filter(isTextElement);
  if (!textElements.length) {
    return elements;
  }
  const loaded = await Fonts.loadElementsFonts(textElements).catch(() => []);
  if (loaded.length) {
    for (const element of textElements) {
      charWidth.clearCache(getFontString(element));
    }
    elements = convertToExcalidrawElements(
      skeletons as ExcalidrawElementSkeleton[],
      opts,
    );
  }
  return elements;
};

export const convertPendingOps = async (
  ops: readonly PendingOp[],
  existingElements: readonly ExcalidrawElement[],
) => {
  const ids = new Set(existingElements.map((element) => element.id));
  const elements: ExcalidrawElement[] = [];
  const files: BinaryFileData[] = [];
  const errors: string[] = [];

  for (const op of ops) {
    try {
      if (op.type === "elements") {
        const skeletons = op.elements.filter(
          (skeleton) => !skeleton.id || !ids.has(skeleton.id),
        );
        // keep the ids given by the assistant, so that it can reference the
        // elements later
        const converted = await convertWithFonts(skeletons, {
          regenerateIds: false,
        });
        converted.forEach((element) => ids.add(element.id));
        elements.push(...converted);
      } else if (op.type === "mermaid") {
        const { parseMermaidToExcalidraw } = await import(
          "@excalidraw/mermaid-to-excalidraw"
        );
        const result = await parseMermaidToExcalidraw(op.definition);
        let converted = await convertWithFonts(result.elements, {
          regenerateIds: true,
        });
        if (converted.length) {
          const [minX, minY] = getCommonBounds(converted);
          let targetX = op.x;
          let targetY = op.y;
          if (targetX === undefined || targetY === undefined) {
            // to the right of everything already there
            const content = getNonDeletedElements([
              ...existingElements,
              ...elements,
            ]);
            if (content.length) {
              const [, contentMinY, contentMaxX] = getCommonBounds(content);
              targetX = contentMaxX + PLACEMENT_GAP;
              targetY = contentMinY;
            } else {
              targetX = 0;
              targetY = 0;
            }
          }
          converted = translate(converted, targetX - minX, targetY - minY);
        }
        elements.push(...converted);
        files.push(...Object.values(result.files || {}));
      }
    } catch (error: any) {
      console.error(error);
      errors.push(error.message || String(error));
    }
  }

  return { elements, files, errors };
};
