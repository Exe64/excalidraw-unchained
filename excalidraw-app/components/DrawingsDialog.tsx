import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  DotsHorizontalIcon,
  DuplicateIcon,
  LoadIcon,
  PlusIcon,
  TrashIcon,
  historyIcon,
  pencilIcon,
  searchIcon,
  usersIcon,
} from "@excalidraw/excalidraw/components/icons";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom, useAtomValue } from "../app-jotai";
import { DrawingsAPI, FoldersAPI, TrashAPI } from "../data/drawings";
import { currentDrawingAtom } from "../data/ServerData";

import "./DrawingsDialog.scss";

import type {
  DrawingSummary,
  Folder,
  Share,
  TrashedDrawing,
} from "../data/drawings";

export const drawingsDialogOpenAtom = atom(false);

type View =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "shared" }
  | { type: "folder"; id: string }
  | { type: "trash" };

const starIcon = (filled: boolean) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const stopKeys = (event: React.KeyboardEvent) => event.stopPropagation();

/** an inline text input, committed on Enter or blur */
const InlineInput = ({
  initialValue,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) {
      return;
    }
    done.current = true;
    const value = ref.current?.value.trim();
    if (value && value !== initialValue) {
      onCommit(value);
    } else {
      onCancel();
    }
  };
  return (
    <input
      ref={ref}
      className={clsx("DrawingsDialog__inlineInput", className)}
      defaultValue={initialValue}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
    />
  );
};

// -----------------------------------------------------------------------------
// sharing panel
// -----------------------------------------------------------------------------

const SharePanel = ({
  drawing,
  onBack,
}: {
  drawing: DrawingSummary;
  onBack: () => void;
}) => {
  const { t } = useUnchainedI18n();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Share["role"]>("edit");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    DrawingsAPI.shares(drawing.id)
      .then(setShares)
      .catch((error) => setError(error.message));
  }, [drawing.id]);

  const run = async (action: () => Promise<Share[]>) => {
    try {
      setShares(await action());
      setError(null);
    } catch (error: any) {
      setError(error.message);
    }
  };

  return (
    <div className="DrawingsDialog__panel">
      <button type="button" className="DrawingsDialog__back" onClick={onBack}>
        ← {t("drawings.back")}
      </button>
      <h3>{t("share.title", { name: drawing.name })}</h3>
      <p className="DrawingsDialog__hint">{t("share.hint")}</p>
      <form
        className="DrawingsDialog__shareForm"
        onSubmit={(event) => {
          event.preventDefault();
          if (username.trim()) {
            run(async () => {
              const result = await DrawingsAPI.share(
                drawing.id,
                username.trim(),
                role,
              );
              setUsername("");
              return result;
            });
          }
        }}
      >
        <input
          placeholder={t("share.username")}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={stopKeys}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as Share["role"])}
        >
          <option value="edit">{t("share.roleEdit")}</option>
          <option value="view">{t("share.roleView")}</option>
        </select>
        <button type="submit" className="DrawingsDialog__primaryButton">
          {t("share.add")}
        </button>
      </form>
      {error && <div className="DrawingsDialog__error">{error}</div>}
      {shares === null ? (
        <Spinner />
      ) : shares.length === 0 ? (
        <p className="DrawingsDialog__hint">{t("share.none")}</p>
      ) : (
        <ul className="DrawingsDialog__shares">
          {shares.map((share) => (
            <li key={share.userId}>
              <span className="DrawingsDialog__shareUser">
                {share.username}
              </span>
              <select
                value={share.role}
                onChange={(event) =>
                  run(() =>
                    DrawingsAPI.share(
                      drawing.id,
                      share.username,
                      event.target.value as Share["role"],
                    ),
                  )
                }
              >
                <option value="edit">{t("share.roleEdit")}</option>
                <option value="view">{t("share.roleView")}</option>
              </select>
              <button
                type="button"
                className="DrawingsDialog__iconButton"
                title={t("share.remove")}
                aria-label={t("share.remove")}
                onClick={() =>
                  run(() => DrawingsAPI.unshare(drawing.id, share.userId))
                }
              >
                {TrashIcon}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// drawing cards
// -----------------------------------------------------------------------------

const DrawingCard = ({
  drawing,
  isCurrent,
  langCode,
  folders,
  menuOpen,
  onToggleMenu,
  onOpen,
  onRename,
  onDuplicate,
  onMove,
  onShare,
  onToggleFavorite,
  onRemove,
}: {
  drawing: DrawingSummary;
  isCurrent: boolean;
  langCode: string;
  folders: Folder[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onShare: () => void;
  onToggleFavorite: () => void;
  onRemove: () => void;
}) => {
  const { t } = useUnchainedI18n();
  const [isRenaming, setIsRenaming] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const isOwner = (drawing.role ?? "owner") === "owner";
  const thumbnail = DrawingsAPI.thumbnailUrl(drawing);

  useEffect(() => {
    if (!menuOpen) {
      setShowFolders(false);
    }
  }, [menuOpen]);

  const updated = new Date(drawing.updatedAt).toLocaleString(langCode, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li
      className={clsx("DrawingCard", {
        "DrawingCard--current": isCurrent,
        "DrawingCard--menuOpen": menuOpen,
      })}
    >
      <button
        type="button"
        className="DrawingCard__preview"
        onClick={onOpen}
        title={t("drawings.open")}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="DrawingCard__placeholder">{pencilIcon}</span>
        )}
        {isCurrent && (
          <span className="DrawingCard__badge">{t("drawings.current")}</span>
        )}
      </button>
      <button
        type="button"
        className={clsx("DrawingCard__star", {
          "DrawingCard__star--active": drawing.favorite,
        })}
        title={
          drawing.favorite ? t("drawings.unfavorite") : t("drawings.favorite")
        }
        aria-label={
          drawing.favorite ? t("drawings.unfavorite") : t("drawings.favorite")
        }
        onClick={onToggleFavorite}
      >
        {starIcon(!!drawing.favorite)}
      </button>
      <div className="DrawingCard__footer">
        <div className="DrawingCard__text">
          {isRenaming ? (
            <InlineInput
              initialValue={drawing.name}
              onCommit={(name) => {
                setIsRenaming(false);
                onRename(name);
              }}
              onCancel={() => setIsRenaming(false)}
            />
          ) : (
            <span className="DrawingCard__name" title={drawing.name}>
              {drawing.name}
            </span>
          )}
          <span className="DrawingCard__meta">
            {!isOwner && (
              <span className="DrawingCard__shared">
                {usersIcon}
                {t(
                  drawing.role === "view"
                    ? "drawings.sharedByReadOnly"
                    : "drawings.sharedBy",
                  { name: drawing.ownerUsername || "" },
                )}
              </span>
            )}
            {t("drawings.updated", { date: updated })}
          </span>
        </div>
        <button
          type="button"
          className="DrawingsDialog__iconButton"
          title={t("drawings.actions")}
          aria-label={t("drawings.actions")}
          onClick={onToggleMenu}
        >
          {DotsHorizontalIcon}
        </button>
      </div>
      {menuOpen && (
        <div className="DrawingCard__menu" role="menu">
          {showFolders ? (
            <>
              <button type="button" onClick={() => setShowFolders(false)}>
                ← {t("drawings.back")}
              </button>
              <button
                type="button"
                className={clsx({ active: !drawing.folderId })}
                onClick={() => onMove(null)}
              >
                {t("folders.none")}
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={clsx({ active: drawing.folderId === folder.id })}
                  onClick={() => onMove(folder.id)}
                >
                  {LoadIcon}
                  {folder.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" onClick={onOpen}>
                {t("drawings.open")}
              </button>
              {isOwner && (
                <button type="button" onClick={() => setIsRenaming(true)}>
                  {pencilIcon}
                  {t("drawings.rename")}
                </button>
              )}
              <button type="button" onClick={onDuplicate}>
                {DuplicateIcon}
                {t("drawings.duplicate")}
              </button>
              {isOwner && (
                <button type="button" onClick={() => setShowFolders(true)}>
                  {LoadIcon}
                  {t("drawings.moveTo")}
                </button>
              )}
              {isOwner && (
                <button type="button" onClick={onShare}>
                  {usersIcon}
                  {t("drawings.share")}
                </button>
              )}
              <button type="button" className="danger" onClick={onRemove}>
                {TrashIcon}
                {isOwner ? t("drawings.delete") : t("drawings.leave")}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
};

const TrashCard = ({
  drawing,
  langCode,
  onRestore,
  onDeleteForever,
}: {
  drawing: TrashedDrawing;
  langCode: string;
  onRestore: () => void;
  onDeleteForever: () => void;
}) => {
  const { t } = useUnchainedI18n();
  const thumbnail = DrawingsAPI.thumbnailUrl(drawing);
  const purge = new Date(drawing.purgeAt).toLocaleDateString(langCode, {
    dateStyle: "medium",
  });
  return (
    <li className="DrawingCard DrawingCard--trashed">
      <div className="DrawingCard__preview">
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="DrawingCard__placeholder">{pencilIcon}</span>
        )}
      </div>
      <div className="DrawingCard__footer">
        <div className="DrawingCard__text">
          <span className="DrawingCard__name" title={drawing.name}>
            {drawing.name}
          </span>
          <span className="DrawingCard__meta">
            {t("trash.purgedOn", { date: purge })}
          </span>
        </div>
      </div>
      <div className="DrawingCard__trashActions">
        <button type="button" onClick={onRestore}>
          {historyIcon}
          {t("trash.restore")}
        </button>
        <button type="button" className="danger" onClick={onDeleteForever}>
          {TrashIcon}
          {t("trash.deleteForever")}
        </button>
      </div>
    </li>
  );
};

// -----------------------------------------------------------------------------
// dialog
// -----------------------------------------------------------------------------

export const DrawingsDialog = ({
  onOpenDrawing,
  onNewDrawing,
  onCurrentDrawingRemoved,
  onCurrentDrawingRenamed,
}: {
  onOpenDrawing: (id: string) => Promise<void>;
  onNewDrawing: (folderId: string | null) => Promise<void>;
  /** the current drawing was deleted, or removed from the user's list */
  onCurrentDrawingRemoved: () => Promise<void>;
  onCurrentDrawingRenamed: (name: string) => void;
}) => {
  const { t, langCode } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(drawingsDialogOpenAtom);
  const currentDrawing = useAtomValue(currentDrawingAtom);
  const [view, setView] = useState<View>({ type: "all" });
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [trash, setTrash] = useState<TrashedDrawing[] | null>(null);
  const [sharing, setSharing] = useState<DrawingSummary | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [drawings, folders] = await Promise.all([
        DrawingsAPI.list(),
        FoldersAPI.list(),
      ]);
      setDrawings(drawings);
      setFolders(folders);
      setError(null);
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  const refreshTrash = useCallback(async () => {
    try {
      setTrash(await TrashAPI.list());
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSharing(null);
      setMenuFor(null);
      refresh();
    } else {
      setDrawings(null);
      setTrash(null);
    }
  }, [isOpen, refresh]);

  useEffect(() => {
    if (isOpen && view.type === "trash") {
      refreshTrash();
    }
  }, [isOpen, view, refreshTrash]);

  // close the card menu when clicking elsewhere
  useEffect(() => {
    if (!menuFor) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          ".DrawingCard--menuOpen .DrawingCard__menu, .DrawingCard--menuOpen .DrawingCard__footer",
        )
      ) {
        setMenuFor(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuFor]);

  const visibleDrawings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (drawings || []).filter((drawing) => {
      if (
        normalizedQuery &&
        !drawing.name.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      switch (view.type) {
        case "favorites":
          return drawing.favorite;
        case "shared":
          return drawing.role !== "owner";
        case "folder":
          return drawing.folderId === view.id;
        default:
          // while searching, look everywhere
          return true;
      }
    });
  }, [drawings, query, view]);

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

  const currentFolder =
    view.type === "folder"
      ? folders.find((folder) => folder.id === view.id)
      : undefined;

  const title =
    view.type === "favorites"
      ? t("drawings.favorites")
      : view.type === "shared"
      ? t("drawings.sharedWithMe")
      : view.type === "trash"
      ? t("trash.title")
      : view.type === "folder"
      ? currentFolder?.name ?? ""
      : t("drawings.all");

  const navButton = (target: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={clsx("DrawingsDialog__navItem", {
        active:
          view.type === target.type &&
          (target.type !== "folder" ||
            (view.type === "folder" && view.id === target.id)),
      })}
      onClick={() => {
        setView(target);
        setSharing(null);
        setMenuFor(null);
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <Dialog
      size="wide"
      onCloseRequest={close}
      title={t("drawings.title")}
      className="DrawingsDialog"
    >
      <div className="DrawingsDialog__layout">
        <nav className="DrawingsDialog__nav">
          {navButton({ type: "all" }, t("drawings.all"), pencilIcon)}
          {navButton(
            { type: "favorites" },
            t("drawings.favorites"),
            starIcon(false),
          )}
          {navButton({ type: "shared" }, t("drawings.sharedWithMe"), usersIcon)}

          <div className="DrawingsDialog__navHeading">
            <span>{t("folders.title")}</span>
            <button
              type="button"
              className="DrawingsDialog__iconButton"
              title={t("folders.new")}
              aria-label={t("folders.new")}
              onClick={() => setFolderEdit("new")}
            >
              {PlusIcon}
            </button>
          </div>
          {folders.map((folder) =>
            folderEdit === folder.id ? (
              <InlineInput
                key={folder.id}
                initialValue={folder.name}
                className="DrawingsDialog__navInput"
                onCommit={(name) => {
                  setFolderEdit(null);
                  run(async () => {
                    await FoldersAPI.rename(folder.id, name);
                    await refresh();
                  });
                }}
                onCancel={() => setFolderEdit(null)}
              />
            ) : (
              <div key={folder.id} className="DrawingsDialog__folder">
                {navButton(
                  { type: "folder", id: folder.id },
                  folder.name,
                  LoadIcon,
                )}
                <div className="DrawingsDialog__folderActions">
                  <button
                    type="button"
                    className="DrawingsDialog__iconButton"
                    title={t("folders.rename")}
                    aria-label={t("folders.rename")}
                    onClick={() => setFolderEdit(folder.id)}
                  >
                    {pencilIcon}
                  </button>
                  <button
                    type="button"
                    className="DrawingsDialog__iconButton"
                    title={t("folders.delete")}
                    aria-label={t("folders.delete")}
                    onClick={() => {
                      if (
                        window.confirm(
                          t("folders.deleteConfirm", { name: folder.name }),
                        )
                      ) {
                        run(async () => {
                          await FoldersAPI.remove(folder.id);
                          if (view.type === "folder" && view.id === folder.id) {
                            setView({ type: "all" });
                          }
                          await refresh();
                        });
                      }
                    }}
                  >
                    {TrashIcon}
                  </button>
                </div>
              </div>
            ),
          )}
          {folderEdit === "new" && (
            <InlineInput
              initialValue=""
              className="DrawingsDialog__navInput"
              onCommit={(name) => {
                setFolderEdit(null);
                run(async () => {
                  const folder = await FoldersAPI.create(name);
                  await refresh();
                  setView({ type: "folder", id: folder.id });
                });
              }}
              onCancel={() => setFolderEdit(null)}
            />
          )}
          {!folders.length && folderEdit !== "new" && (
            <p className="DrawingsDialog__navEmpty">{t("folders.empty")}</p>
          )}

          <div className="DrawingsDialog__navSpacer" />
          {navButton({ type: "trash" }, t("trash.title"), TrashIcon)}
        </nav>

        <div className="DrawingsDialog__content">
          {sharing ? (
            <SharePanel drawing={sharing} onBack={() => setSharing(null)} />
          ) : (
            <>
              <div className="DrawingsDialog__toolbar">
                <h3 className="DrawingsDialog__viewTitle">{title}</h3>
                {view.type !== "trash" ? (
                  <>
                    <TextField
                      icon={searchIcon}
                      placeholder={t("drawings.search")}
                      value={query}
                      onChange={setQuery}
                      onKeyDown={stopKeys}
                      type="search"
                    />
                    <FilledButton
                      size="large"
                      icon={PlusIcon}
                      label={t("drawings.new")}
                      onClick={async () => {
                        await run(() =>
                          onNewDrawing(view.type === "folder" ? view.id : null),
                        );
                        close();
                      }}
                    />
                  </>
                ) : (
                  !!trash?.length && (
                    <FilledButton
                      size="large"
                      color="danger"
                      variant="outlined"
                      icon={TrashIcon}
                      label={t("trash.empty")}
                      onClick={() => {
                        if (window.confirm(t("trash.emptyConfirm"))) {
                          run(async () => {
                            await TrashAPI.empty();
                            await refreshTrash();
                          });
                        }
                      }}
                    />
                  )
                )}
              </div>
              {view.type === "trash" && (
                <p className="DrawingsDialog__hint">{t("trash.hint")}</p>
              )}
              {error && <div className="DrawingsDialog__error">{error}</div>}

              {view.type === "trash" ? (
                trash === null ? (
                  <div className="DrawingsDialog__loading">
                    <Spinner size="2em" />
                  </div>
                ) : trash.length === 0 ? (
                  <div className="DrawingsDialog__empty">{t("trash.none")}</div>
                ) : (
                  <ul className="DrawingsDialog__grid">
                    {trash.map((drawing) => (
                      <TrashCard
                        key={drawing.id}
                        drawing={drawing}
                        langCode={langCode}
                        onRestore={() =>
                          run(async () => {
                            await TrashAPI.restore(drawing.id);
                            await Promise.all([refresh(), refreshTrash()]);
                          })
                        }
                        onDeleteForever={() => {
                          if (
                            window.confirm(
                              t("trash.deleteForeverConfirm", {
                                name: drawing.name,
                              }),
                            )
                          ) {
                            run(async () => {
                              await TrashAPI.deleteForever(drawing.id);
                              await refreshTrash();
                            });
                          }
                        }}
                      />
                    ))}
                  </ul>
                )
              ) : drawings === null ? (
                <div className="DrawingsDialog__loading">
                  <Spinner size="2em" />
                </div>
              ) : visibleDrawings.length === 0 ? (
                <div className="DrawingsDialog__empty">
                  {view.type === "shared"
                    ? t("drawings.noShared")
                    : view.type === "favorites"
                    ? t("drawings.noFavorites")
                    : t("drawings.empty")}
                </div>
              ) : (
                <ul className="DrawingsDialog__grid">
                  {visibleDrawings.map((drawing) => (
                    <DrawingCard
                      key={drawing.id}
                      drawing={drawing}
                      langCode={langCode}
                      folders={folders}
                      isCurrent={drawing.id === currentDrawing?.id}
                      menuOpen={menuFor === drawing.id}
                      onToggleMenu={() =>
                        setMenuFor(menuFor === drawing.id ? null : drawing.id)
                      }
                      onOpen={async () => {
                        setMenuFor(null);
                        if (drawing.id !== currentDrawing?.id) {
                          await run(() => onOpenDrawing(drawing.id));
                        }
                        close();
                      }}
                      onRename={(name) =>
                        run(async () => {
                          const renamed = await DrawingsAPI.rename(
                            drawing.id,
                            name,
                          );
                          if (drawing.id === currentDrawing?.id) {
                            onCurrentDrawingRenamed(renamed.name);
                          }
                          await refresh();
                        })
                      }
                      onDuplicate={() =>
                        run(async () => {
                          setMenuFor(null);
                          await DrawingsAPI.duplicate(drawing.id);
                          await refresh();
                        })
                      }
                      onMove={(folderId) =>
                        run(async () => {
                          setMenuFor(null);
                          await DrawingsAPI.move(drawing.id, folderId);
                          await refresh();
                        })
                      }
                      onShare={() => {
                        setMenuFor(null);
                        setSharing(drawing);
                      }}
                      onToggleFavorite={() =>
                        run(async () => {
                          await DrawingsAPI.setFavorite(
                            drawing.id,
                            !drawing.favorite,
                          );
                          await refresh();
                        })
                      }
                      onRemove={() => {
                        setMenuFor(null);
                        const isOwner = (drawing.role ?? "owner") === "owner";
                        if (
                          !window.confirm(
                            isOwner
                              ? t("drawings.deleteConfirm", {
                                  name: drawing.name,
                                })
                              : t("drawings.leaveConfirm", {
                                  name: drawing.name,
                                }),
                          )
                        ) {
                          return;
                        }
                        run(async () => {
                          await DrawingsAPI.remove(drawing.id);
                          if (drawing.id === currentDrawing?.id) {
                            await onCurrentDrawingRemoved();
                          }
                          await refresh();
                        });
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
};
