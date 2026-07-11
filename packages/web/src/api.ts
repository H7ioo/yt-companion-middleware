// The API contract lives in @app/shared — the single source of truth the server validates
// against (PRD-04 §2). These types are re-exported so the web components' existing
// `import ... from "../api.js"` sites keep resolving; adding a field to a shared schema is now
// a type error here until the UI handles it. Do not hand-redeclare these interfaces.
export type {
  PrivacyStatus,
  Preset,
  DefaultSettings,
  VarSource,
  ResolvedVar,
  PresetActionResult,
  Category,
  StreamInfo,
  FeedbackStatus,
  HealthFeedback,
  QuotaSnapshot,
  DashboardState,
  SetupStatus,
  LogEntry,
  LogLevel,
  LogCategory,
} from "@app/shared";

import type {
  Preset,
  DefaultSettings,
  PresetActionResult,
  Category,
  StreamInfo,
  DashboardState,
  PrivacyStatus,
  SetupStatus,
  CredentialsState,
  LogEntry,
} from "@app/shared";

/** Preset payload for create/update — the full preset minus its server-assigned id. */
export type PresetInput = Omit<Preset, "id">;

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/** Credentials the setup screen submits — structurally the persisted credentials schema. */
export type CredentialsInput = CredentialsState;

export const api = {
  setup: {
    status: () => req<SetupStatus>("/api/setup/status"),
    save: (creds: CredentialsInput) =>
      req<{ ok: boolean; restarting: boolean }>("/api/setup", {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    /**
     * Runs the in-app OAuth flow: the server opens the system browser and waits for consent, so
     * this request stays open until the user finishes (or the flow errors). No token is returned.
     * Pass an override client (the operator's own ID/secret) to run against it instead of the
     * bundled client; omit it for the one-click bundled path.
     */
    connect: (override?: { clientId: string; clientSecret: string }) =>
      req<{ ok: boolean }>("/api/setup/oauth/start", {
        method: "POST",
        body: JSON.stringify(override ?? {}),
      }),
    /**
     * Disconnects the channel: the server discards the stored refresh token and reboots into setup
     * mode. No secret is sent or returned — only the ok/restarting acknowledgement.
     */
    disconnect: () =>
      req<{ ok: boolean; restarting: boolean }>("/api/setup/disconnect", { method: "POST" }),
  },
  presets: {
    list: () => req<Preset[]>("/api/dashboard/presets"),
    create: (input: PresetInput) =>
      req<Preset>("/api/dashboard/presets", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: PresetInput) =>
      req<Preset>(`/api/dashboard/presets/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    remove: (id: string) =>
      req<{ success: boolean }>(`/api/dashboard/presets/${id}`, { method: "DELETE" }),
    export: () =>
      req<{ version: number; exportedAt: string; presets: Preset[] }>(
        "/api/dashboard/presets/export",
      ),
    import: (presets: unknown[], mode: "replace" | "merge") =>
      req<{ success: boolean; count: number; presets: Preset[] }>(
        "/api/dashboard/presets/import",
        { method: "POST", body: JSON.stringify({ presets, mode }) },
      ),
  },
  settings: {
    get: () => req<DefaultSettings>("/api/dashboard/settings"),
    save: (s: DefaultSettings) =>
      req<DefaultSettings>("/api/dashboard/settings", { method: "PUT", body: JSON.stringify(s) }),
  },
  categories: {
    list: () => req<Category[]>("/api/dashboard/categories"),
  },
  streams: {
    list: () => req<StreamInfo[]>("/api/dashboard/streams"),
  },
  state: () => req<DashboardState>("/api/dashboard/state"),
  /** The activity ring buffer (newest-first) for the dashboard Activity panel (PRD-06 §3). */
  logs: () => req<LogEntry[]>("/api/dashboard/logs"),
  webhook: {
    get: () => req<{ url: string | null }>("/api/dashboard/webhook"),
    save: (url: string | null) =>
      req<{ url: string | null }>("/api/dashboard/webhook", {
        method: "PUT",
        body: JSON.stringify({ url: url ?? "" }),
      }),
  },
  service: {
    get: () => req<{ apiEnabled: boolean }>("/api/dashboard/service"),
    save: (apiEnabled: boolean) =>
      req<{ apiEnabled: boolean }>("/api/dashboard/service", {
        method: "PUT",
        body: JSON.stringify({ apiEnabled }),
      }),
  },
  /**
   * Subscribe to live state. Prefers a WebSocket (the transport Bitfocus Companion favours);
   * if the socket drops or never opens, falls back to SSE, which itself auto-reconnects. When
   * SSE also errors, `onError` fires so the caller can fall back to 5s polling. Returns an
   * unsubscribe function that tears down whichever transport is active.
   */
  streamState: (onState: (s: DashboardState) => void, onError: () => void): (() => void) => {
    let closed = false;
    let active: (() => void) | null = null;

    const startSSE = () => {
      if (closed) return;
      const es = new EventSource("/api/dashboard/stream");
      es.addEventListener("state", (e) => {
        try {
          onState(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("error", onError);
      active = () => es.close();
    };

    const startWS = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}//${location.host}/api/dashboard/ws`);
      } catch {
        startSSE();
        return;
      }
      ws.addEventListener("message", (e) => {
        try {
          const frame = JSON.parse((e as MessageEvent).data);
          if (frame?.event === "state" && frame.state) onState(frame.state as DashboardState);
        } catch {
          /* ignore malformed frame */
        }
      });
      // A drop (or a socket that never opened) falls through to SSE.
      ws.addEventListener("close", () => {
        if (!closed) startSSE();
      });
      active = () => ws.close();
    };

    startWS();
    return () => {
      closed = true;
      active?.();
    };
  },
  action: {
    preset: (presetId: string, vars?: Record<string, string>) =>
      req<PresetActionResult>("/api/dashboard/action/preset", {
        method: "POST",
        body: JSON.stringify(vars && Object.keys(vars).length > 0 ? { presetId, vars } : { presetId }),
      }),
    update: (payload: {
      title: string;
      description?: string;
      privacyStatus?: PrivacyStatus;
      category?: string | null;
      streamBoundId?: string | null;
    }) =>
      req<{ success: boolean; error?: { message: string } }>("/api/dashboard/action/update", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    privacy: (status?: PrivacyStatus) =>
      req<{ success: boolean; error?: { message: string } }>("/api/dashboard/action/privacy", {
        method: "POST",
        body: JSON.stringify(status ? { status } : { mode: "toggle" }),
      }),
    undo: () =>
      req<{ success: boolean; error?: { message: string } }>("/api/dashboard/action/undo", {
        method: "POST",
      }),
    /** Force a live re-fetch of the YouTube session (title/status/etc.) into the cache. */
    refresh: () =>
      req<DashboardState & { success: boolean; error?: { message: string } }>(
        "/api/dashboard/action/refresh",
        { method: "POST" },
      ),
  },
};
