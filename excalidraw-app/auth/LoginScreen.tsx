import clsx from "clsx";
import { useEffect, useState } from "react";

import { THEME } from "@excalidraw/excalidraw";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import Spinner from "@excalidraw/excalidraw/components/Spinner";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { STORAGE_KEYS } from "../app_constants";

import {
  fetchAuthConfig,
  fetchCurrentUser,
  getSsoLoginUrl,
  login,
  loginSecondFactor,
  register,
  setup,
  ssoResult,
} from "./auth";
import { CodeInput, RecoveryCodes, TotpSetup } from "./TwoFactor";

import "./LoginScreen.scss";

import type { User } from "./auth";

/** the second step of a password sign-in */
type SecondStep =
  | { kind: "verify"; ticket: string }
  | { kind: "setup"; ticket: string; secret: string; uri: string }
  /** two-factor authentication was just set up: show the recovery codes */
  | { kind: "codes"; user: User; recoveryCodes: string[] };

const SSO_ERRORS = {
  closed: "sso.errorClosed",
  pending: "sso.errorPending",
  taken: "sso.errorTaken",
  denied: "sso.errorDenied",
  expired: "sso.errorExpired",
  unavailable: "sso.errorUnavailable",
  linked: "sso.errorLinked",
  failed: "sso.errorFailed",
} as const;

export const getSsoErrorKey = (code: string) =>
  SSO_ERRORS[code as keyof typeof SSO_ERRORS] ?? SSO_ERRORS.failed;

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
  const [mode, setMode] = useState<"login" | "register" | "setup">("login");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [sso, setSso] = useState<{ name: string } | null>(null);
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [ssoPopupOpen, setSsoPopupOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme] = useState(getInitialTheme);

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => {
        setAllowRegistration(config.allowRegistration);
        setSso(config.sso);
        if (config.needsSetup && !isOverlay) {
          setMode("setup");
        }
        // back from a failed SSO sign-in
        if (ssoResult?.error && !isOverlay) {
          setError(
            t(getSsoErrorKey(ssoResult.error), {
              name: config.sso?.name ?? "SSO",
            }),
          );
          // (shown once)
          delete ssoResult.error;
        }
      })
      .catch(() => {});
    // (once)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverlay]);

  // signing in again through SSO from the editor, in a popup so that nothing
  // is lost: wait until it's done
  useEffect(() => {
    if (!ssoPopupOpen) {
      return;
    }
    const interval = window.setInterval(async () => {
      try {
        const user = await fetchCurrentUser();
        if (user) {
          window.clearInterval(interval);
          onAuthenticated(user);
        }
      } catch {}
    }, 1500);
    return () => window.clearInterval(interval);
  }, [ssoPopupOpen, onAuthenticated]);

  const getErrorMessage = (error: any) =>
    error.data?.code === "pending"
      ? t("auth.pending")
      : error.data?.code === "invalid_code"
      ? t("tfa.invalidCode")
      : error.data?.code === "expired"
      ? t("tfa.expired")
      : error.status === 401
      ? t("auth.invalidCredentials")
      : error.status === 429
      ? t("auth.tooManyAttempts")
      : error.status
      ? error.message
      : t("auth.networkError");

  const onSubmitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !secondStep || secondStep.kind === "codes") {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await loginSecondFactor(secondStep.ticket, code.trim());
      if (result.recoveryCodes) {
        setSecondStep({
          kind: "codes",
          user: result.user,
          recoveryCodes: result.recoveryCodes,
        });
        setIsSubmitting(false);
        return;
      }
      onAuthenticated(result.user);
    } catch (error: any) {
      setCode("");
      if (error.data?.code === "expired") {
        // start again from the password
        setSecondStep(null);
        setPassword("");
      }
      setError(getErrorMessage(error));
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setError(null);
    setNotice(null);
    if (mode !== "login" && password !== passwordConfirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === "register") {
        await register(username.trim(), password);
        setMode("login");
        setPassword("");
        setPasswordConfirm("");
        setNotice(t("auth.registered"));
        setIsSubmitting(false);
        return;
      }
      if (mode === "setup") {
        onAuthenticated(await setup(username.trim(), password));
        return;
      }
      const result = await login(username.trim(), password);
      if (result.twoFactor) {
        setSecondStep(
          result.twoFactor === "verify"
            ? { kind: "verify", ticket: result.ticket }
            : {
                kind: "setup",
                ticket: result.ticket,
                secret: result.secret,
                uri: result.uri,
              },
        );
        setCode("");
        setUseRecoveryCode(false);
        setIsSubmitting(false);
        return;
      }
      onAuthenticated(result.user);
    } catch (error: any) {
      setError(getErrorMessage(error));
      setIsSubmitting(false);
    }
  };

  const className = clsx("excalidraw", "unchained-auth", {
    "theme--dark": theme === THEME.DARK,
    "unchained-auth--overlay": isOverlay,
  });

  if (secondStep) {
    if (secondStep.kind === "codes") {
      return (
        <div className={className}>
          <div className="unchained-auth__card">
            <ExcalidrawLogo withText size="normal" />
            <h1 className="unchained-auth__title">{t("tfa.recoveryTitle")}</h1>
            <RecoveryCodes
              codes={secondStep.recoveryCodes}
              username={secondStep.user.username}
            />
            <button
              type="button"
              className="unchained-auth__submit"
              onClick={() => onAuthenticated(secondStep.user)}
            >
              {t("tfa.continue")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={className}>
        <form className="unchained-auth__card" onSubmit={onSubmitCode}>
          <ExcalidrawLogo withText size="normal" />
          <h1 className="unchained-auth__title">
            {secondStep.kind === "setup"
              ? t("tfa.setupTitle")
              : t("tfa.loginTitle")}
          </h1>
          {secondStep.kind === "setup" ? (
            <>
              <p className="unchained-auth__message">{t("tfa.setupHint")}</p>
              <TotpSetup secret={secondStep.secret} uri={secondStep.uri} />
            </>
          ) : (
            <p className="unchained-auth__message">
              {useRecoveryCode
                ? t("tfa.recoveryLoginHint")
                : t("tfa.loginHint")}
            </p>
          )}
          <CodeInput
            value={code}
            onChange={setCode}
            recovery={useRecoveryCode}
          />
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
            {isSubmitting ? <Spinner /> : t("tfa.verify")}
          </button>
          {secondStep.kind === "verify" && (
            <button
              type="button"
              className="unchained-auth__switch"
              onClick={() => {
                setUseRecoveryCode(!useRecoveryCode);
                setCode("");
                setError(null);
              }}
            >
              {useRecoveryCode ? t("tfa.useApp") : t("tfa.useRecovery")}
            </button>
          )}
          <button
            type="button"
            className="unchained-auth__switch"
            onClick={() => {
              setSecondStep(null);
              setPassword("");
              setError(null);
            }}
          >
            {t("tfa.back")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={className}>
      <form className="unchained-auth__card" onSubmit={onSubmit}>
        <ExcalidrawLogo withText size="normal" />
        <h1 className="unchained-auth__title">
          {mode === "login"
            ? t("auth.title")
            : mode === "setup"
            ? t("auth.setupTitle")
            : t("auth.registerTitle")}
        </h1>
        {mode === "setup" && (
          <p className="unchained-auth__message">{t("auth.setupHint")}</p>
        )}
        {mode === "register" && (
          <p className="unchained-auth__message">{t("auth.registerHint")}</p>
        )}
        {message && <p className="unchained-auth__message">{message}</p>}
        {notice && (
          <div className="unchained-auth__notice" role="status">
            {notice}
          </div>
        )}
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
        {mode !== "login" && (
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
          ) : mode === "setup" ? (
            t("auth.setupSubmit")
          ) : (
            t("auth.signUp")
          )}
        </button>
        {sso && mode === "login" && (
          <>
            <div className="unchained-auth__or">
              <span>{t("sso.or")}</span>
            </div>
            {isOverlay ? (
              // keep the editor (and the unsaved changes) open
              <button
                type="button"
                className="unchained-auth__sso"
                onClick={() => {
                  window.open(
                    getSsoLoginUrl({ popup: true }),
                    "excalidraw-sso",
                    "width=520,height=680",
                  );
                  setSsoPopupOpen(true);
                }}
              >
                {t("sso.signIn", { name: sso.name })}
              </button>
            ) : (
              <a className="unchained-auth__sso" href={getSsoLoginUrl()}>
                {t("sso.signIn", { name: sso.name })}
              </a>
            )}
            {ssoPopupOpen && (
              <p className="unchained-auth__message">{t("sso.popupHint")}</p>
            )}
          </>
        )}
        {allowRegistration && !isOverlay && mode !== "setup" && (
          <button
            type="button"
            className="unchained-auth__switch"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "login" ? t("auth.toSignUp") : t("auth.toSignIn")}
          </button>
        )}
      </form>
    </div>
  );
};
