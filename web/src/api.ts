export type PrivacyStatus = "public" | "unlisted" | "private";

export interface Preset {
  id: string;
  title: string;
  description: string;
  privacyStatus: PrivacyStatus;
  category: string | null;
  streamBoundId: string | null;
  /**
   * Whole-sentence fallback used when the field has any unresolved variable (PRD §1).
   * Optional in the client view: presets authored before templating omit them, and the
   * preset form does not yet edit them.
   */
  titleFallback?: string | null;
  descriptionFallback?: string | null;
}

export type VarSource = "provided" | "default" | "fallback";

export interface ResolvedVar {
  name: string;
  value: string | null;
  source: VarSource;
}

export interface PresetActionResult {
  success: boolean;
  resolvedVars?: ResolvedVar[];
  error?: { code: string; message: string };
}

export interface DefaultSettings {
  defaultCategory: string | null;
  defaultStreamBoundId: string | null;
}

export interface Category {
  id: string;
  title: string;
}

export interface StreamInfo {
  id: string;
  title: string;
  streamName: string | null;
}

export interface FeedbackStatus {
  title: string | null;
  privacyStatus: string | null;
  isLive: boolean;
  noTarget: boolean;
}

export interface HealthFeedback {
  status: "ok" | "degraded" | "auth_error";
  authenticated: boolean;
  message: string | null;
}

export interface QuotaSnapshot {
  date: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface DashboardState {
  status: FeedbackStatus;
  activePresetId: string | null;
  health: "ok" | "degraded" | "auth_error";
  healthMessage: string | null;
  lastRefreshedAt: string | null;
  busy: boolean;
  quota: QuotaSnapshot;
  undo: { label: string | null; capturedAt: string } | null;
}

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

export const api = {
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
  webhook: {
    get: () => req<{ url: string | null }>("/api/dashboard/webhook"),
    save: (url: string | null) =>
      req<{ url: string | null }>("/api/dashboard/webhook", {
        method: "PUT",
        body: JSON.stringify({ url: url ?? "" }),
      }),
  },
  /**
   * Subscribe to live state via SSE. Returns an unsubscribe function. `onError` fires if
   * the stream drops, so the caller can fall back to polling.
   */
  streamState: (onState: (s: DashboardState) => void, onError: () => void): (() => void) => {
    const es = new EventSource("/api/dashboard/stream");
    es.addEventListener("state", (e) => {
      try {
        onState(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener("error", onError);
    return () => es.close();
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
