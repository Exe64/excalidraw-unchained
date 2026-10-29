import { atom } from "../app-jotai";
import { apiRequest } from "../data/api";

export type User = {
  id: string;
  username: string;
  isAdmin: boolean;
  status: "active" | "pending";
  createdAt: number;
};

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
  }>("GET", "/auth/config");

/** creates the administrator account, on first launch */
export const setup = async (username: string, password: string) => {
  const { user } = await apiRequest<{ user: User }>("POST", "/auth/setup", {
    json: { username, password },
  });
  return user;
};

export const login = async (username: string, password: string) => {
  const { user } = await apiRequest<{ user: User }>("POST", "/auth/login", {
    json: { username, password },
  });
  return user;
};

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
