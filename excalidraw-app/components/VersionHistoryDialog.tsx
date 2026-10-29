import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import { exportScene } from "@excalidraw/excalidraw";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getNonDeletedElements } from "@excalidraw/element";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom, useAtomValue } from "../app-jotai";
import { DrawingsAPI } from "../data/drawings";
import { ServerData, currentDrawingAtom } from "../data/ServerData";

import "./VersionHistoryDialog.scss";

import type { Drawing, DrawingVersion } from "../data/drawings";

export const versionHistoryDialogOpenAtom = atom(false);

/** renders a version's content into `container` */
const VersionPreview = ({
  drawingId,
  versionId,
  files,
}: {
  drawingId: string;
  versionId: string;
  files: BinaryFiles;
}) => {
  const { t } = useUnchainedI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const version = await DrawingsAPI.version(drawingId, versionId);
        const elements = getNonDeletedElements(
          restoreElements(version.elements, null),
        );
        if (cancelled) {
          return;
        }
        if (!elements.length) {
          setStatus("empty");
          return;
        }
        const svg = await exportScene({
          type: "svg",
          data: {
            elements,
            appState: {
              viewBackgroundColor:
                version.appState.viewBackgroundColor ?? "#ffffff",
            },
            files,
          },
          config: { padding: 16 },
        });
        if (cancelled || !containerRef.current) {
          return;
        }
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        containerRef.current.replaceChildren(svg);
        setStatus("ready");
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drawingId, versionId, files]);

  return (
    <div className="VersionHistory__preview">
      {status === "loading" && <Spinner size="2em" />}
      {status === "empty" && <span>{t("history.emptyVersion")}</span>}
      {status === "error" && <span>{t("history.previewError")}</span>}
      <div
        ref={containerRef}
        className={clsx("VersionHistory__svg", {
          "VersionHistory__svg--hidden": status !== "ready",
        })}
      />
    </div>
  );
};

export const VersionHistoryDialog = ({
  getFiles,
  onRestored,
}: {
  getFiles: () => BinaryFiles;
  /** the restored drawing, to load in the editor */
  onRestored: (drawing: Drawing) => Promise<void>;
}) => {
  const { t, langCode } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(versionHistoryDialogOpenAtom);
  const currentDrawing = useAtomValue(currentDrawingAtom);
  const [versions, setVersions] = useState<DrawingVersion[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<BinaryFiles>({});

  const drawingId = currentDrawing?.id;
  const canEdit = currentDrawing?.role !== "view";

  const refresh = useCallback(async () => {
    if (!drawingId) {
      return;
    }
    try {
      const versions = await DrawingsAPI.versions(drawingId);
      setVersions(versions);
      setSelected((selected) =>
        selected && versions.some((version) => version.id === selected)
          ? selected
          : versions[0]?.id ?? null,
      );
      setError(null);
    } catch (error: any) {
      setError(error.message);
    }
  }, [drawingId]);

  useEffect(() => {
    if (isOpen) {
      setFiles(getFiles());
      // make sure the latest changes are on the server
      ServerData.flushSave().then(refresh);
    } else {
      setVersions(null);
      setSelected(null);
    }
  }, [isOpen, refresh, getFiles]);

  if (!isOpen || !drawingId) {
    return null;
  }

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString(langCode, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const reasonLabel = (version: DrawingVersion) =>
    version.reason === "manual"
      ? t("history.reasonManual")
      : version.reason === "before-restore"
      ? t("history.reasonBeforeRestore")
      : version.reason === "api"
      ? t("history.reasonApi")
      : t("history.reasonAuto");

  return (
    <Dialog
      size="wide"
      onCloseRequest={() => setIsOpen(false)}
      title={t("history.title", { name: currentDrawing?.name ?? "" })}
      className="VersionHistoryDialog"
    >
      <div className="VersionHistory__layout">
        <div className="VersionHistory__sidebar">
          {canEdit && (
            <button
              type="button"
              className="VersionHistory__save"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await ServerData.flushSave();
                  const versions = await DrawingsAPI.saveVersion(drawingId);
                  setVersions(versions);
                  setSelected(versions[0]?.id ?? null);
                  setError(null);
                } catch (error: any) {
                  setError(error.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("history.saveNow")}
            </button>
          )}
          <p className="VersionHistory__hint">{t("history.hint")}</p>
          {versions === null ? (
            <Spinner />
          ) : versions.length === 0 ? (
            <p className="VersionHistory__hint">{t("history.none")}</p>
          ) : (
            <ul className="VersionHistory__list">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className={clsx({ active: version.id === selected })}
                    onClick={() => setSelected(version.id)}
                  >
                    <span className="VersionHistory__date">
                      {formatDate(version.stateAt)}
                    </span>
                    <span className="VersionHistory__meta">
                      {reasonLabel(version)}
                      {version.username ? ` · ${version.username}` : ""}
                      {" · "}
                      {t("history.elements", {
                        count: String(version.elementCount),
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="VersionHistory__main">
          {error && <div className="VersionHistory__error">{error}</div>}
          {selected ? (
            <>
              <VersionPreview
                drawingId={drawingId}
                versionId={selected}
                files={files}
              />
              {canEdit && (
                <div className="VersionHistory__actions">
                  <span className="VersionHistory__hint">
                    {t("history.restoreHint")}
                  </span>
                  <button
                    type="button"
                    className="VersionHistory__restore"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(t("history.restoreConfirm"))) {
                        return;
                      }
                      setBusy(true);
                      try {
                        await ServerData.flushSave();
                        const drawing = await DrawingsAPI.restoreVersion(
                          drawingId,
                          selected,
                        );
                        await onRestored(drawing);
                        setIsOpen(false);
                      } catch (error: any) {
                        setError(error.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("history.restore")}
                  </button>
                </div>
              )}
            </>
          ) : (
            versions !== null && (
              <div className="VersionHistory__preview">
                <span>{t("history.selectVersion")}</span>
              </div>
            )
          )}
        </div>
      </div>
    </Dialog>
  );
};
