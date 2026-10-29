import { useEffect, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom, useAtomValue } from "../app-jotai";
import { changePassword, currentUserAtom } from "../auth/auth";

import "./AccountDialog.scss";

export const accountDialogOpenAtom = atom(false);

const EMPTY_FORM = { current: "", password: "", confirm: "" };

export const AccountDialog = () => {
  const { t } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(accountDialogOpenAtom);
  const user = useAtomValue(currentUserAtom);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setForm(EMPTY_FORM);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen || !user) {
    return null;
  }

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
        onKeyDown={(event) => {
          // keep the editor's shortcuts out, but let Escape close the dialog
          if (event.key !== "Escape") {
            event.stopPropagation();
          }
        }}
      />
    </label>
  );

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

      <form
        className="AccountDialog__form"
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
        {error && <div className="AccountDialog__error">{error}</div>}
        {success && (
          <div className="AccountDialog__success" role="status">
            {t("account.passwordChanged")}
          </div>
        )}
        <button
          type="submit"
          className="AccountDialog__submit"
          disabled={isSubmitting}
        >
          {t("auth.changePassword")}
        </button>
      </form>
    </Dialog>
  );
};
