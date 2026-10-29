import clsx from "clsx";
import { useEffect, useState } from "react";

import { THEME } from "@excalidraw/excalidraw";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import Spinner from "@excalidraw/excalidraw/components/Spinner";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { STORAGE_KEYS } from "../app_constants";

import { fetchAuthConfig, login, register } from "./auth";

import "./LoginScreen.scss";

import type { User } from "./auth";

const getInitialTheme = () => {
  let theme: string | null = null;
  try {
    theme = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
  } catch {}
  if (theme === THEME.DARK || theme === THEME.LIGHT) {
    return theme;
  }
  if (theme === "system" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? THEME.DARK
      : THEME.LIGHT;
  }
  return THEME.LIGHT;
};

export const LoginScreen = ({
  onAuthenticated,
  isOverlay = false,
  message,
}: {
  onAuthenticated: (user: User) => void;
  /** displayed above the editor when the session expired */
  isOverlay?: boolean;
  message?: string;
}) => {
  const { t } = useUnchainedI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme] = useState(getInitialTheme);

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => setAllowRegistration(config.allowRegistration))
      .catch(() => {});
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setError(null);
    if (mode === "register" && password !== passwordConfirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setIsSubmitting(true);
    try {
      const user =
        mode === "login"
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      onAuthenticated(user);
    } catch (error: any) {
      setError(
        error.status === 401
          ? t("auth.invalidCredentials")
          : error.status === 429
          ? t("auth.tooManyAttempts")
          : error.status
          ? error.message
          : t("auth.networkError"),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={clsx("excalidraw", "unchained-auth", {
        "theme--dark": theme === THEME.DARK,
        "unchained-auth--overlay": isOverlay,
      })}
    >
      <form className="unchained-auth__card" onSubmit={onSubmit}>
        <ExcalidrawLogo withText size="normal" />
        <h1 className="unchained-auth__title">
          {mode === "login" ? t("auth.title") : t("auth.registerTitle")}
        </h1>
        {message && <p className="unchained-auth__message">{message}</p>}
        <label className="unchained-auth__field">
          <span>{t("auth.username")}</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="unchained-auth__field">
          <span>{t("auth.password")}</span>
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {mode === "register" && (
          <label className="unchained-auth__field">
            <span>{t("auth.passwordConfirm")}</span>
            <input
              name="password-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </label>
        )}
        {error && (
          <div className="unchained-auth__error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="unchained-auth__submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Spinner />
          ) : mode === "login" ? (
            t("auth.signIn")
          ) : (
            t("auth.signUp")
          )}
        </button>
        {allowRegistration && !isOverlay && (
          <button
            type="button"
            className="unchained-auth__switch"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? t("auth.toSignUp") : t("auth.toSignIn")}
          </button>
        )}
      </form>
    </div>
  );
};
