import { useEffect, useState } from "react";

import { LoadingMessage } from "@excalidraw/excalidraw/components/LoadingMessage";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { useAtom } from "../app-jotai";
import { onUnauthorized } from "../data/api";

import {
  currentUserAtom,
  fetchCurrentUser,
  sessionExpiredAtom,
  ssoResult,
} from "./auth";
import { LoginScreen } from "./LoginScreen";

/**
 * Renders its children only for authenticated users. When the session expires
 * while the editor is open, a login overlay is displayed on top of it so that
 * no unsaved work is lost.
 */
export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { t } = useUnchainedI18n();
  const [user, setUser] = useAtom(currentUserAtom);
  const [sessionExpired, setSessionExpired] = useAtom(sessionExpiredAtom);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetchCurrentUser()
        .then((user) => {
          if (!cancelled) {
            if (user && ssoResult?.status === "done" && window.opener) {
              // signed in again through SSO in a popup, from the editor
              // (see LoginScreen): the editor takes it from here
              window.close();
            }
            setUser(user);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            // server unreachable: retry in a bit
            window.setTimeout(check, 3000);
          }
        });
    check();
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setSessionExpired(true);
      }),
    [setSessionExpired],
  );

  if (status === "loading") {
    return <LoadingMessage delay={250} />;
  }

  if (!user) {
    return (
      <LoginScreen
        message={status === "error" ? t("auth.networkError") : undefined}
        onAuthenticated={(user) => {
          setUser(user);
          setStatus("ready");
        }}
      />
    );
  }

  return (
    <>
      {children}
      {sessionExpired && (
        <LoginScreen
          isOverlay
          message={t("auth.sessionExpired")}
          onAuthenticated={(newUser) => {
            if (newUser.id !== user.id) {
              // a different account: start from a clean state
              window.location.reload();
              return;
            }
            setSessionExpired(false);
          }}
        />
      )}
    </>
  );
};
