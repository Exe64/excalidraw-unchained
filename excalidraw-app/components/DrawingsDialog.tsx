import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  DuplicateIcon,
  PlusIcon,
  TrashIcon,
  pencilIcon,
  searchIcon,
} from "@excalidraw/excalidraw/components/icons";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom, useAtomValue } from "../app-jotai";
import { DrawingsAPI } from "../data/drawings";
import { currentDrawingAtom } from "../data/ServerData";

import "./DrawingsDialog.scss";

import type { DrawingSummary } from "../data/drawings";

export const drawingsDialogOpenAtom = atom(false);

const DrawingRow = ({
  drawing,
  isCurrent,
  langCode,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  drawing: DrawingSummary;
  isCurrent: boolean;
  langCode: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) => {
  const { t } = useUnchainedI18n();
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const commitRename = () => {
    const name = inputRef.current?.value.trim();
    setIsRenaming(false);
    if (name && name !== drawing.name) {
      onRename(name);
    }
  };

  const updated = new Date(drawing.updatedAt).toLocaleString(langCode, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li
      className={clsx("DrawingsDialog__row", {
        "DrawingsDialog__row--current": isCurrent,
      })}
    >
      {isRenaming ? (
        <input
          ref={inputRef}
          className="DrawingsDialog__renameInput"
          defaultValue={drawing.name}
          onBlur={commitRename}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              commitRename();
            } else if (event.key === "Escape") {
              setIsRenaming(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="DrawingsDialog__open"
          onClick={onOpen}
          title={t("drawings.open")}
        >
          <span className="DrawingsDialog__name">{drawing.name}</span>
          <span className="DrawingsDialog__meta">
            {isCurrent && (
              <span className="DrawingsDialog__badge">
                {t("drawings.current")}
              </span>
            )}
            {t("drawings.updated", { date: updated })}
          </span>
        </button>
      )}
      <div className="DrawingsDialog__actions">
        <button
          type="button"
          className="DrawingsDialog__action"
          title={t("drawings.rename")}
          aria-label={t("drawings.rename")}
          onClick={() => setIsRenaming(true)}
        >
          {pencilIcon}
        </button>
        <button
          type="button"
          className="DrawingsDialog__action"
          title={t("drawings.duplicate")}
          aria-label={t("drawings.duplicate")}
          onClick={onDuplicate}
        >
          {DuplicateIcon}
        </button>
        <button
          type="button"
          className="DrawingsDialog__action DrawingsDialog__action--danger"
          title={t("drawings.delete")}
          aria-label={t("drawings.delete")}
          onClick={onDelete}
        >
          {TrashIcon}
        </button>
      </div>
    </li>
  );
};

export const DrawingsDialog = ({
  onOpenDrawing,
  onNewDrawing,
  onCurrentDrawingDeleted,
  onCurrentDrawingRenamed,
}: {
  onOpenDrawing: (id: string) => Promise<void>;
  onNewDrawing: () => Promise<void>;
  onCurrentDrawingDeleted: () => Promise<void>;
  onCurrentDrawingRenamed: (name: string) => void;
}) => {
  const { t, langCode } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(drawingsDialogOpenAtom);
  const currentDrawing = useAtomValue(currentDrawingAtom);
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDrawings(await DrawingsAPI.list());
      setError(null);
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      refresh();
    } else {
      setDrawings(null);
    }
  }, [isOpen, refresh]);

  const filteredDrawings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (drawings || []).filter((drawing) =>
      drawing.name.toLowerCase().includes(normalizedQuery),
    );
  }, [drawings, query]);

  if (!isOpen) {
    return null;
  }

  const close = () => setIsOpen(false);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (error: any) {
      setError(error.message);
    }
  };

  return (
    <Dialog
      size="small"
      onCloseRequest={close}
      title={t("drawings.title")}
      className="DrawingsDialog"
    >
      <div className="DrawingsDialog__toolbar">
        <TextField
          icon={searchIcon}
          placeholder={t("drawings.search")}
          value={query}
          onChange={setQuery}
          onKeyDown={(event) => event.stopPropagation()}
          fullWidth
          type="search"
        />
        <FilledButton
          size="large"
          icon={PlusIcon}
          label={t("drawings.new")}
          onClick={async () => {
            await run(onNewDrawing);
            close();
          }}
        />
      </div>
      {error && <div className="DrawingsDialog__error">{error}</div>}
      {drawings === null ? (
        <div className="DrawingsDialog__loading">
          <Spinner size="2em" />
        </div>
      ) : filteredDrawings.length === 0 ? (
        <div className="DrawingsDialog__empty">{t("drawings.empty")}</div>
      ) : (
        <ul className="DrawingsDialog__list">
          {filteredDrawings.map((drawing) => (
            <DrawingRow
              key={drawing.id}
              drawing={drawing}
              langCode={langCode}
              isCurrent={drawing.id === currentDrawing?.id}
              onOpen={async () => {
                if (drawing.id !== currentDrawing?.id) {
                  await run(() => onOpenDrawing(drawing.id));
                }
                close();
              }}
              onRename={(name) =>
                run(async () => {
                  const renamed = await DrawingsAPI.rename(drawing.id, name);
                  if (drawing.id === currentDrawing?.id) {
                    onCurrentDrawingRenamed(renamed.name);
                  }
                  await refresh();
                })
              }
              onDuplicate={() =>
                run(async () => {
                  await DrawingsAPI.duplicate(drawing.id);
                  await refresh();
                })
              }
              onDelete={() => {
                if (
                  !window.confirm(
                    t("drawings.deleteConfirm", { name: drawing.name }),
                  )
                ) {
                  return;
                }
                run(async () => {
                  await DrawingsAPI.remove(drawing.id);
                  if (drawing.id === currentDrawing?.id) {
                    await onCurrentDrawingDeleted();
                  }
                  await refresh();
                });
              }}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
};
