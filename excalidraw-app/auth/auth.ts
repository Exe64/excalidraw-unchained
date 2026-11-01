import { atom } from "../app-jotai";
import { API_BASE, apiRequest } from "../data/api";

export type User = {
  id: string;
  username: string;
  isAdmin: boolean;
  status: "active" | "pending";
  createdAt: number;
  /** false for accounts created through SSO */
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  // signed-in user only
  ssoLinked?: boolean;
  twoFactorRequired?: boolean;
  recoveryCodesLeft?: number;
};

export type TwoFactorPolicy = "optional" | "admins" | "all";

export type RegistrationMode = "closed" | "approval";

/** the signed-in user (null until authenticated) */
export const currentUserAtom = atom<User | null>(null);

/** set when the server rejected our session while the editor was open */
export const sessionExpiredAtom = atom(false);

export const fetchCurrentUser = async (): Promise<User | null> => {
  try {
    const { user } = await apiRequest<{ user: User }>("GET", "/auth/me");
    return user;
  } catch (error: any) {
    if (error.status === 401) {
      return null;
    }
    throw error;
  }
};

export const fetchAuthConfig = () =>
  apiRequest<{
    registrationMode: RegistrationMode;
    allowRegistration: boolean;
    /** no account exists yet: the first one is the administrator */
    needsSetup: boolean;
    /** sign-in through an OpenID Connect provider */
    sso: { name: string } | null;
    webEmbedsEnabled: boolean;
  }>("GET", "/auth/config");

/** creates the administrator account, on first launch */
export const setup = async (username: string, password: string) => {
  const { user } = await apiRequest<{ user: User }>("POST", "/auth/setup", {
    json: { username, password },
  });
  return user;
};

export type LoginResult =
  | { user: User; twoFactor?: undefined }
  /** the password is right, a code of the authenticator app is needed */
  | { twoFactor: "verify"; ticket: string }
  /** the password is right, two-factor authentication must be set up first */
  | { twoFactor: "setup"; ticket: string; secret: string; uri: string };

export const login = (username: string, password: string) =>
  apiRequest<LoginResult>("POST", "/auth/login", {
    json: { username, password },
  });

/** second step of the sign-in; `recoveryCodes` when it was just set up */
export const loginSecondFactor = (ticket: string, code: string) =>
  apiRequest<{ user: User; recoveryCodes?: string[] }>(
    "POST",
    "/auth/login/2fa",
    { json: { ticket, code } },
  );

/** requests an account, which an administrator then has to approve */
export const register = (username: string, password: string) =>
  apiRequest<{ pending: true }>("POST", "/auth/register", {
    json: { username, password },
  });

export const logout = () => apiRequest("POST", "/auth/logout");

export const changePassword = (currentPassword: string, newPassword: string) =>
  apiRequest("POST", "/auth/password", {
    json: { currentPassword, newPassword },
  });

// two-factor authentication
// -----------------------------------------------------------------------------

export const setupTwoFactor = () =>
  apiRequest<{ ticket: string; secret: string; uri: string }>(
    "POST",
    "/auth/2fa/setup",
    { json: {} },
  );

export const enableTwoFactor = (ticket: string, code: string) =>
  apiRequest<{ user: User; recoveryCodes: string[] }>(
    "POST",
    "/auth/2fa/enable",
    { json: { ticket, code } },
  );

export const disableTwoFactor = (code: string) =>
  apiRequest<{ user: User }>("POST", "/auth/2fa/disable", { json: { code } });

export const regenerateRecoveryCodes = (code: string) =>
  apiRequest<{ recoveryCodes: string[] }>("POST", "/auth/2fa/recovery-codes", {
    json: { code },
  });

// SSO
// -----------------------------------------------------------------------------

/** where the browser goes to sign in through SSO */
export const getSsoLoginUrl = (opts?: { popup?: boolean }) =>
  `${API_BASE}/auth/sso/login${opts?.popup ? "?popup=1" : ""}`;

/** links the account to the SSO provider (the browser goes there) */
export const linkSso = async () => {
  const { url } = await apiRequest<{ url: string }>("POST", "/auth/sso/link", {
    json: {},
  });
  window.location.href = url;
};

export const unlinkSso = () => apiRequest("DELETE", "/auth/sso/link");

export type SsoResult = {
  /** "linked" after linking the account */
  status?: "linked" | "done";
  /** see the sso.error* strings */
  error?: string;
};

/**
 * What the SSO flow came back with (`?sso=…` or `?sso_error=…`), read once
 * when the app starts and removed from the address bar.
 */
export const ssoResult: SsoResult | null = (() => {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const status = url.searchParams.get("sso");
  const error = url.searchParams.get("sso_error");
  if (!status && !error) {
    return null;
  }
  url.searchParams.delete("sso");
  url.searchParams.delete("sso_error");
  window.history.replaceState(window.history.state, "", url.toString());
  return {
    status: status === "linked" || status === "done" ? status : undefined,
    error: error || undefined,
  };
})();
