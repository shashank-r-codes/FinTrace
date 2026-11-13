const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4000/api/v1';

const ACCESS_KEY = 'fintrace_access_token';
const REFRESH_KEY = 'fintrace_refresh_token';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const tokenStorage = {
  getAccess: (): string | null => localStorage.getItem(ACCESS_KEY),
  getRefresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  setTokens: (accessToken: string, refreshToken: string): void => {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear: (): void => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshPromise: Promise<string | null> | null = null;

async function attemptTokenRefresh(): Promise<string | null> {
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          tokenStorage.clear();
          return null;
        }
        const json = (await res.json()) as {
          success: boolean;
          data?: { accessToken: string; refreshToken: string };
        };
        if (json.success && json.data) {
          tokenStorage.setTokens(json.data.accessToken, json.data.refreshToken);
          return json.data.accessToken;
        }
        tokenStorage.clear();
        return null;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const buildHeaders = (token: string | null): HeadersInit => {
    const h: Record<string, string> = { ...(options.headers ?? {}) };
    if (!isFormData && options.body !== undefined) {
      h['Content-Type'] = 'application/json';
    }
    if (!options.skipAuth && token) {
      h.Authorization = `Bearer ${token}`;
    }
    return h;
  };

  let accessToken = tokenStorage.getAccess();
  let response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: buildHeaders(accessToken),
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });

  if (response.status === 401 && !options.skipAuth) {
    const renewed = await attemptTokenRefresh();
    if (renewed) {
      accessToken = renewed;
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: buildHeaders(accessToken),
        body:
          options.body === undefined
            ? undefined
            : isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
      });
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }
    return (await response.text()) as unknown as T;
  }

  const payload = (await response.json()) as {
    success?: boolean;
    error?: { message?: string; code?: string };
    message?: string;
  };

  if (!response.ok) {
    const msg = payload.error?.message || payload.message || `Request failed (${response.status})`;
    const code = payload.error?.code || 'HTTP_ERROR';
    throw new ApiError(msg, response.status, code);
  }

  return payload as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function apiDownloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  let accessToken = tokenStorage.getAccess();

  let response = await fetch(url, {
    method: 'GET',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (response.status === 401) {
    const renewed = await attemptTokenRefresh();
    if (renewed) {
      accessToken = renewed;
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
  }

  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Ignore non-JSON error body
    }
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

