import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { TrashIcon } from "@excalidraw/excalidraw/components/icons";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { appJotaiStore, atom, useAtom, useAtomValue } from "../app-jotai";
import { currentUserAtom } from "../auth/auth";
import { apiRequest } from "../data/api";

import "./AdminDialog.scss";

import type { RegistrationMode, User } from "../auth/auth";

export const adminDialogOpenAtom = atom(false);

/** accounts waiting for approval, shown in the main menu */
export const pendingUsersCountAtom = atom(0);

type AdminUser = User & { drawings: number };

const fetchUsers = async () => {
  const { users } = await apiRequest<{ users: AdminUser[] }>(
    "GET",
    "/admin/users",
  );
  appJotaiStore.set(
    pendingUsersCountAtom,
    users.filter((user) => user.status === "pending").length,
  );
  return users;
};

/** refreshes the count of accounts waiting for approval (admins only) */
export const refreshPendingUsersCount = () => {
  if (appJotaiStore.get(currentUserAtom)?.isAdmin) {
    fetchUsers().catch(() => {});
  }
};

const stopPropagation = (event: React.KeyboardEvent) => event.stopPropagation();

const UserRow = ({
  user,
  isSelf,
  langCode,
  onChange,
  onError,
}: {
  user: AdminUser;
  isSelf: boolean;
  langCode: string;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) => {
  const { t } = useUnchainedI18n();
  const [isResetting, setIsResetting] = useState(false);
  const [password, setPassword] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await onChange();
    } catch (error: any) {
      onError(error.message);
    }
  };

  const path = `/admin/users/${encodeURIComponent(user.id)}`;

  return (
    <li className="AdminDialog__user">
      <div className="AdminDialog__userMain">
        <div className="AdminDialog__userName">
          {user.username}
          {user.isAdmin && (
            <span className="AdminDialog__badge">{t("admin.adminBadge")}</span>
          )}
          {isSelf && (
            <span className="AdminDialog__badge AdminDialog__badge--muted">
              {t("admin.you")}
            </span>
          )}
        </div>
        <div className="AdminDialog__meta">
          {t("admin.userMeta", {
            date: new Date(user.createdAt).toLocaleDateString(langCode),
            count: String(user.drawings),
          })}
        </div>
        {isResetting && (
          <form
            className="AdminDialog__inlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await apiRequest("PATCH", path, { json: { password } });
                setIsResetting(false);
                setPassword("");
              });
            }}
          >
            <input
              type="password"
              autoComplete="new-password"
              placeholder={t("admin.newPassword")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={stopPropagation}
              autoFocus
            />
            <button type="submit" className="AdminDialog__link">
              {t("admin.save")}
            </button>
            <button
              type="button"
              className="AdminDialog__link AdminDialog__link--muted"
              onClick={() => setIsResetting(false)}
            >
              {t("admin.cancel")}
            </button>
          </form>
        )}
      </div>
      {user.status === "pending" ? (
        <div className="AdminDialog__actions">
          <button
            type="button"
            className="AdminDialog__button AdminDialog__button--primary"
            onClick={() =>
              run(() => apiRequest("POST", `${path}/approve`, { json: {} }))
            }
          >
            {t("admin.approve")}
          </button>
          <button
            type="button"
            className="AdminDialog__button"
            onClick={() => run(() => apiRequest("DELETE", path))}
          >
            {t("admin.reject")}
          </button>
        </div>
      ) : (
        <div className="AdminDialog__actions">
          <label
            className={clsx("AdminDialog__toggle", {
              "AdminDialog__toggle--disabled": isSelf,
            })}
          >
            <input
              type="checkbox"
              checked={user.isAdmin}
              disabled={isSelf}
              onChange={(event) =>
                run(() =>
                  apiRequest("PATCH", path, {
                    json: { isAdmin: event.target.checked },
                  }),
                )
              }
            />
            {t("admin.isAdmin")}
          </label>
          <button
            type="button"
            className="AdminDialog__link"
            onClick={() => setIsResetting(!isResetting)}
          >
            {t("admin.resetPassword")}
          </button>
          {!isSelf && (
            <button
              type="button"
              className="AdminDialog__icon"
              title={t("admin.delete")}
              aria-label={t("admin.delete")}
              onClick={() => {
                if (
                  window.confirm(
                    t("admin.deleteConfirm", { name: user.username }),
                  )
                ) {
                  run(() => apiRequest("DELETE", path));
                }
              }}
            >
              {TrashIcon}
            </button>
          )}
        </div>
      )}
    </li>
  );
};

export const AdminDialog = () => {
  const { t, langCode } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(adminDialogOpenAtom);
  const currentUser = useAtomValue(currentUserAtom);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [registrationMode, setRegistrationMode] =
    useState<RegistrationMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    isAdmin: false,
  });

  const refresh = useCallback(async () => {
    try {
      const [users, settings] = await Promise.all([
        fetchUsers(),
        apiRequest<{ registrationMode: RegistrationMode }>(
          "GET",
          "/admin/settings",
        ),
      ]);
      setUsers(users);
      setRegistrationMode(settings.registrationMode);
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      refresh();
    } else {
      setUsers(null);
    }
  }, [isOpen, refresh]);

  if (!isOpen || !currentUser?.isAdmin) {
    return null;
  }

  const pendingUsers = users?.filter((user) => user.status === "pending");
  const activeUsers = users?.filter((user) => user.status !== "pending");

  const renderUser = (user: AdminUser) => (
    <UserRow
      key={user.id}
      user={user}
      isSelf={user.id === currentUser.id}
      langCode={langCode}
      onChange={async () => {
        setError(null);
        await refresh();
      }}
      onError={setError}
    />
  );

  return (
    <Dialog
      size="regular"
      onCloseRequest={() => setIsOpen(false)}
      title={t("admin.title")}
      className="AdminDialog"
    >
      {error && <div className="AdminDialog__error">{error}</div>}

      <section className="AdminDialog__section">
        <h3>{t("admin.registration")}</h3>
        {(["closed", "approval"] as const).map((mode) => (
          <label key={mode} className="AdminDialog__radio">
            <input
              type="radio"
              name="registration-mode"
              checked={registrationMode === mode}
              onChange={async () => {
                try {
                  const settings = await apiRequest<{
                    registrationMode: RegistrationMode;
                  }>("PUT", "/admin/settings", {
                    json: { registrationMode: mode },
                  });
                  setRegistrationMode(settings.registrationMode);
                  setError(null);
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            />
            <span>
              <strong>
                {mode === "closed"
                  ? t("admin.modeClosed")
                  : t("admin.modeApproval")}
              </strong>
              <span className="AdminDialog__meta">
                {mode === "closed"
                  ? t("admin.modeClosedHint")
                  : t("admin.modeApprovalHint")}
              </span>
            </span>
          </label>
        ))}
      </section>

      {users === null ? (
        <Spinner />
      ) : (
        <>
          {!!pendingUsers?.length && (
            <section className="AdminDialog__section">
              <h3>
                {t("admin.pending")} ({pendingUsers.length})
              </h3>
              <ul className="AdminDialog__users">
                {pendingUsers.map(renderUser)}
              </ul>
            </section>
          )}

          <section className="AdminDialog__section">
            <h3>
              {t("admin.users")} ({activeUsers?.length ?? 0})
            </h3>
            <ul className="AdminDialog__users">
              {activeUsers?.map(renderUser)}
            </ul>
          </section>

          <section className="AdminDialog__section">
            <h3>{t("admin.createUser")}</h3>
            <form
              className="AdminDialog__create"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await apiRequest("POST", "/admin/users", { json: newUser });
                  setNewUser({ username: "", password: "", isAdmin: false });
                  setError(null);
                  await refresh();
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            >
              <TextField
                label={t("auth.username")}
                value={newUser.username}
                onChange={(username) => setNewUser({ ...newUser, username })}
                onKeyDown={stopPropagation}
              />
              <label className="AdminDialog__passwordField">
                <span>{t("auth.password")}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                  onKeyDown={stopPropagation}
                />
              </label>
              <label className="AdminDialog__toggle">
                <input
                  type="checkbox"
                  checked={newUser.isAdmin}
                  onChange={(event) =>
                    setNewUser({ ...newUser, isAdmin: event.target.checked })
                  }
                />
                {t("admin.isAdmin")}
              </label>
              <button
                type="submit"
                className="AdminDialog__button AdminDialog__button--primary"
              >
                {t("admin.create")}
              </button>
            </form>
          </section>
        </>
      )}
    </Dialog>
  );
};
