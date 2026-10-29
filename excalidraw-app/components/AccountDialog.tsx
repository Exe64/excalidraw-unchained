import { useEffect, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom } from "../app-jotai";
import {
  changePassword,
  currentUserAtom,
  disableTwoFactor,
  enableTwoFactor,
  fetchAuthConfig,
  fetchCurrentUser,
  linkSso,
  regenerateRecoveryCodes,
  setupTwoFactor,
  unlinkSso,
} from "../auth/auth";
import { CodeInput, RecoveryCodes, TotpSetup } from "../auth/TwoFactor";

import "./AccountDialog.scss";

import type { User } from "../auth/auth";

export const accountDialogOpenAtom = atom(false);

const EMPTY_FORM = { current: "", password: "", confirm: "" };

/** keep the editor's shortcuts out, but let Escape close the dialog */
const onFieldKeyDown = (event: React.KeyboardEvent) => {
  if (event.key !== "Escape") {
    event.stopPropagation();
  }
};

const Message = ({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) => (
  <>
    {error && <div className="AccountDialog__error">{error}</div>}
    {success && (
      <div className="AccountDialog__success" role="status">
        {success}
      </div>
    )}
  </>
);

const PasswordSection = () => {
  const { t } = useUnchainedI18n();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const field = (
    key: keyof typeof EMPTY_FORM,
    label: string,
    autoComplete: string,
  ) => (
    <label className="AccountDialog__field">
      <span>{label}</span>
      <input
        type="password"
        autoComplete={autoComplete}
        required
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        onKeyDown={onFieldKeyDown}
      />
    </label>
  );

  return (
    <form
      className="AccountDialog__section"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setSuccess(false);
        if (form.password !== form.confirm) {
          setError(t("auth.passwordMismatch"));
          return;
        }
        setIsSubmitting(true);
        try {
          await changePassword(form.current, form.password);
          setForm(EMPTY_FORM);
          setSuccess(true);
        } catch (error: any) {
          setError(error.message);
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      <h3>{t("auth.changePassword")}</h3>
      {field("current", t("auth.currentPassword"), "current-password")}
      {field("password", t("auth.newPassword"), "new-password")}
      {field("confirm", t("auth.passwordConfirm"), "new-password")}
      <Message
        error={error}
        success={success ? t("account.passwordChanged") : null}
      />
      <button
        type="submit"
        className="AccountDialog__submit"
        disabled={isSubmitting}
      >
        {t("auth.changePassword")}
      </button>
    </form>
  );
};

type TwoFactorView =
  | { kind: "idle" }
  | { kind: "setup"; ticket: string; secret: string; uri: string }
  | { kind: "codes"; codes: string[] }
  /** asks for a code before disabling, or before new recovery codes */
  | { kind: "confirm"; action: "disable" | "regenerate" };

const TwoFactorSection = ({
  user,
  onUserChange,
}: {
  user: User;
  onUserChange: (user: User) => void;
}) => {
  const { t } = useUnchainedI18n();
  const [view, setView] = useState<TwoFactorView>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setCode("");
    } catch (error: any) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelButton = (
    <button
      type="button"
      className="AccountDialog__secondary"
      onClick={() => {
        setView({ kind: "idle" });
        setCode("");
        setError(null);
      }}
    >
      {t("admin.cancel")}
    </button>
  );

  let content: React.ReactNode;
  if (view.kind === "setup") {
    content = (
      <form
        className="AccountDialog__stack"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            const result = await enableTwoFactor(view.ticket, code);
            onUserChange(result.user);
            setView({ kind: "codes", codes: result.recoveryCodes });
          });
        }}
      >
        <TotpSetup secret={view.secret} uri={view.uri} />
        <CodeInput value={code} onChange={setCode} />
        <Message error={error} />
        <div className="AccountDialog__row">
          <button
            type="submit"
            className="AccountDialog__submit"
            disabled={busy}
          >
            {t("tfa.verify")}
          </button>
          {cancelButton}
        </div>
      </form>
    );
  } else if (view.kind === "codes") {
    content = (
      <div className="AccountDialog__stack">
        <RecoveryCodes codes={view.codes} username={user.username} />
        <button
          type="button"
          className="AccountDialog__submit"
          onClick={() => setView({ kind: "idle" })}
        >
          {t("tfa.done")}
        </button>
      </div>
    );
  } else if (view.kind === "confirm") {
    content = (
      <form
        className="AccountDialog__stack"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            if (view.action === "disable") {
              onUserChange((await disableTwoFactor(code.trim())).user);
              setView({ kind: "idle" });
            } else {
              const { recoveryCodes } = await regenerateRecoveryCodes(
                code.trim(),
              );
              const updated = await fetchCurrentUser();
              if (updated) {
                onUserChange(updated);
              }
              setView({ kind: "codes", codes: recoveryCodes });
            }
          });
        }}
      >
        <p className="AccountDialog__hint">{t("tfa.codePrompt")}</p>
        <CodeInput
          value={code}
          onChange={setCode}
          recovery
          placeholder={t("tfa.anyCode")}
        />
        <Message error={error} />
        <div className="AccountDialog__row">
          <button
            type="submit"
            className="AccountDialog__submit"
            disabled={busy}
          >
            {view.action === "disable" ? t("tfa.disable") : t("tfa.regenerate")}
          </button>
          {cancelButton}
        </div>
      </form>
    );
  } else if (user.twoFactorEnabled) {
    content = (
      <div className="AccountDialog__stack">
        <p className="AccountDialog__hint">
          <span className="AccountDialog__status">{t("tfa.enabled")}</span>{" "}
          {t("tfa.codesLeft", { count: String(user.recoveryCodesLeft ?? 0) })}
        </p>
        {user.twoFactorRequired && (
          <p className="AccountDialog__hint">{t("tfa.required")}</p>
        )}
        <Message error={error} />
        <div className="AccountDialog__row">
          <button
            type="button"
            className="AccountDialog__secondary"
            onClick={() => setView({ kind: "confirm", action: "regenerate" })}
          >
            {t("tfa.regenerate")}
          </button>
          {!user.twoFactorRequired && (
            <button
              type="button"
              className="AccountDialog__secondary AccountDialog__secondary--danger"
              onClick={() => setView({ kind: "confirm", action: "disable" })}
            >
              {t("tfa.disable")}
            </button>
          )}
        </div>
      </div>
    );
  } else {
    content = (
      <div className="AccountDialog__stack">
        <p className="AccountDialog__hint">{t("tfa.hint")}</p>
        <Message error={error} />
        <button
          type="button"
          className="AccountDialog__submit"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setView({ kind: "setup", ...(await setupTwoFactor()) });
            })
          }
        >
          {t("tfa.enable")}
        </button>
      </div>
    );
  }

  return (
    <section className="AccountDialog__section">
      <h3>{t("tfa.title")}</h3>
      {content}
    </section>
  );
};

const SsoSection = ({
  user,
  name,
  onUserChange,
}: {
  user: User;
  name: string;
  onUserChange: (user: User) => void;
}) => {
  const { t } = useUnchainedI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="AccountDialog__section">
      <h3>{t("sso.title")}</h3>
      <p className="AccountDialog__hint">
        {user.ssoLinked
          ? user.hasPassword
            ? t("sso.linkedTo", { name })
            : t("sso.noPassword", { name })
          : t("sso.notLinked", { name })}
      </p>
      <Message error={error} />
      {!user.ssoLinked ? (
        <button
          type="button"
          className="AccountDialog__submit"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              // the browser goes to the provider, and comes back
              await linkSso();
            } catch (error: any) {
              setError(error.message);
              setBusy(false);
            }
          }}
        >
          {t("sso.link", { name })}
        </button>
      ) : (
        user.hasPassword && (
          <button
            type="button"
            className="AccountDialog__secondary"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t("sso.unlinkConfirm", { name }))) {
                return;
              }
              setBusy(true);
              try {
                await unlinkSso();
                onUserChange({ ...user, ssoLinked: false });
              } catch (error: any) {
                setError(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("sso.unlink")}
          </button>
        )
      )}
    </section>
  );
};

export const AccountDialog = () => {
  const { t } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(accountDialogOpenAtom);
  const [user, setUser] = useAtom(currentUserAtom);
  const [sso, setSso] = useState<{ name: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    fetchAuthConfig()
      .then((config) => setSso(config.sso))
      .catch(() => {});
    // the account's latest state (two-factor authentication, SSO…)
    fetchCurrentUser()
      .then((user) => user && setUser(user))
      .catch(() => {});
  }, [isOpen, setUser]);

  if (!isOpen || !user) {
    return null;
  }

  return (
    <Dialog
      size="small"
      onCloseRequest={() => setIsOpen(false)}
      title={t("account.title")}
      className="AccountDialog"
    >
      <div className="AccountDialog__identity">
        <span className="AccountDialog__username">{user.username}</span>
        {user.isAdmin && (
          <span className="AccountDialog__badge">{t("admin.adminBadge")}</span>
        )}
      </div>

      {user.hasPassword && <PasswordSection />}
      {user.hasPassword && (
        <TwoFactorSection user={user} onUserChange={setUser} />
      )}
      {sso && <SsoSection user={user} name={sso.name} onUserChange={setUser} />}
    </Dialog>
  );
};
