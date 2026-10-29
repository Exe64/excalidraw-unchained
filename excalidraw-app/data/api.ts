/**
 * Thin client for the Excalidraw Unchained server (see /server). All requests
 * are same-origin and authenticated with the session cookie.
 */

export class ApiError extends Error {
  status: number;
  data: Record<string, any>;

  constructor(status: number, message: string, data: Record<string, any>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** called whenever the server tells us the session is gone/expired */
export const onUnauthorized = (listener: UnauthorizedListener) => {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
};

export const API_BASE = `${import.meta.env.VITE_APP_API_URL || ""}/api`;

export const apiRequest = async <T = any>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: {
    json?: unknown;
    body?: BodyInit;
    keepalive?: boolean;
    signal?: AbortSignal;
    /** return the raw response body as an ArrayBuffer */
    binary?: boolean;
  } = {},
): Promise<T> => {
  const headers: Record<string, string> = {
    // required by the server on mutating requests (CSRF protection)
    "X-Requested-With": "excalidraw",
  };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/octet-stream";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body,
    credentials: "same-origin",
    // browsers reject keepalive requests with bodies over 64KiB
    keepalive:
      opts.keepalive && (typeof body !== "string" || body.length < 60000),
    signal: opts.signal,
  });

  if (!response.ok) {
    let data: Record<string, any> = {};
    try {
      data = await response.json();
    } catch {
      // not JSON
    }
    if (response.status === 401 && !path.startsWith("/auth/")) {
      unauthorizedListeners.forEach((listener) => listener());
    }
    throw new ApiError(
      response.status,
      data.error || response.statusText || "Request failed",
      data,
    );
  }

  if (opts.binary) {
    return (await response.arrayBuffer()) as T;
  }
  return response.json();
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
};

export const base64ToBytes = (base64: string) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};
