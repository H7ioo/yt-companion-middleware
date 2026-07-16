import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Category,
  type DashboardState,
  type DefaultSettings,
  type NotifyState,
  type Preset,
  type PresetInput,
  type StreamInfo,
  type AppInfo,
} from "./api.js";
import { StatusRail } from "./components/StatusRail.js";
import { ReauthBanner } from "./components/ReauthBanner.js";
import { FirewallGuidance } from "./components/FirewallGuidance.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { PresetForm } from "./components/PresetForm.js";
import { PresetFillModal } from "./components/PresetFillModal.js";
import { AdHocModal } from "./components/AdHocModal.js";
import { CategorySelect } from "./components/CategorySelect.js";
import { ActivityPanel } from "./components/ActivityPanel.js";
import { UpdateBanner } from "./components/UpdateBanner.js";
import { WhatsNewModal } from "./components/WhatsNewModal.js";
import { extractVars } from "./lib/template.js";
import { buildFillUrl } from "./lib/fillRoute.js";
import { shouldAnnounce, readLastSeen, markSeen } from "./lib/whatsNew.js";
import { appInfoChanged } from "./lib/appInfo.js";

type Toast = { message: string; kind: "ok" | "err" } | null;

const PRIVACY_PILL: Record<string, string> = {
  public: "pill--pub",
  unlisted: "pill--unl",
  private: "pill--priv",
};

export function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [settings, setSettings] = useState<DefaultSettings>({
    defaultCategory: null,
    defaultStreamBoundId: null,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [notify, setNotify] = useState<NotifyState>({
    ntfyServer: "https://ntfy.sh",
    ntfyTopic: "",
    publicBaseUrl: "",
  });
  const [editing, setEditing] = useState<Preset | "new" | null>(null);
  const [filling, setFilling] = useState<Preset | null>(null);
  const [adHoc, setAdHoc] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  /** Which release notes the panel is showing, if any: the running build's, or the offered one's. */
  const [whatsNew, setWhatsNew] = useState<"running" | "offered" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const flash = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Manual update re-check. The launch check is once-only, so a release published while the app
  // runs is invisible until restart without this. Refetches app info after so the banner reflects
  // a found update immediately rather than on the next 60s poll.
  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const { update } = await api.app.check();
      const info = await api.app.info();
      setAppInfo((prev) => (appInfoChanged(prev, info) ? info : prev));
      if (update.status === "downloading" || update.status === "downloaded") {
        flash(`Update v${update.version ?? "?"} found — downloading in the background`);
      } else if (update.status === "error") {
        flash(update.error ?? "Update check failed", "err");
      } else {
        flash("You're up to date");
      }
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setCheckingUpdate(false);
    }
  }, [flash]);

  const loadPresets = useCallback(
    () => api.presets.list().then(setPresets),
    [],
  );

  useEffect(() => {
    void loadPresets();
    void api.settings.get().then(setSettings);
    void api.webhook.get().then((w) => setWebhookUrl(w.url ?? ""));
    void api.notify
      .get()
      .then(setNotify)
      .catch(() => {});
    void api.categories
      .list()
      .then(setCategories)
      .catch(() => {});
    void api.streams
      .list()
      .then(setStreams)
      .catch(() => {});
  }, [loadPresets]);

  // Version + bundled release notes + updater state (PRD-09 §B.2). Polled slowly rather than
  // pushed: the updater downloads in the background over minutes, and this is the least urgent
  // thing on the screen — it must never compete with live state for attention or bandwidth.
  useEffect(() => {
    let active = true;
    const tick = () =>
      api.app
        .info()
        .then((info) => {
          if (!active) return;
          // Only replace state when a rendered field actually moved, so the once-a-minute poll is a
          // no-op for a static version chip and doesn't reconcile the whole tree (PRD-11 §2).
          setAppInfo((prev) => (appInfoChanged(prev, info) ? info : prev));
          // Announce a version change exactly once — a new build has been installed since this
          // browser last looked. Never on a fresh install (shouldAnnounce).
          if (shouldAnnounce(info.version, readLastSeen())) setWhatsNew("running");
          markSeen(info.version);
        })
        .catch(() => {});
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Live state via SSE; fall back to 5s polling if the stream drops.
  useEffect(() => {
    let active = true;
    let pollId: number | null = null;
    const apply = (s: DashboardState) => active && setState(s);

    const startPolling = () => {
      if (pollId !== null) return;
      const tick = () => api.state().then(apply).catch(() => {});
      void tick();
      pollId = window.setInterval(tick, 5000);
    };

    // Seed immediately so the rail isn't blank while the stream connects.
    void api.state().then(apply).catch(() => {});
    const close = api.streamState(apply, startPolling);

    return () => {
      active = false;
      close();
      if (pollId !== null) window.clearInterval(pollId);
    };
  }, []);

  const savePreset = async (input: PresetInput) => {
    try {
      if (editing === "new") await api.presets.create(input);
      else if (editing) await api.presets.update(editing.id, input);
      setEditing(null);
      await loadPresets();
      flash("Preset saved");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const exportPresets = async () => {
    try {
      const data = await api.presets.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `presets-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash(`Exported ${data.presets.length} preset${data.presets.length === 1 ? "" : "s"}`);
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const importPresets = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      // Accept either a full export ({ presets: [...] }) or a bare array.
      const list: unknown[] = Array.isArray(parsed) ? parsed : parsed?.presets;
      if (!Array.isArray(list)) throw new Error("File has no presets array");
      const mode =
        presets.length > 0 &&
        confirm(
          `Replace all ${presets.length} existing presets?\n\nOK = replace (restore backup, keeps IDs)\nCancel = merge (append copies with new IDs)`,
        )
          ? "replace"
          : "merge";
      const r = await api.presets.import(list, mode);
      await loadPresets();
      flash(`Imported ${r.count} preset${r.count === 1 ? "" : "s"} (${mode})`);
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const duplicatePreset = async (p: Preset) => {
    try {
      const { id: _id, ...rest } = p;
      await api.presets.create({ ...rest, title: `${p.title} (copy)` });
      await loadPresets();
      flash("Preset duplicated");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const deletePreset = async (p: Preset) => {
    if (!confirm(`Delete preset “${p.title}”?`)) return;
    try {
      await api.presets.remove(p.id);
      await loadPresets();
      flash("Preset deleted");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  // Apply now: a templated preset opens the fill popup; a plain one fires immediately.
  const applyPreset = async (p: Preset) => {
    if (extractVars(p).length > 0) {
      setFilling(p);
      return;
    }
    try {
      const r = await api.action.preset(p.id);
      if (r.success) flash(`Applied “${p.title}” to YouTube`);
      else flash(r.error?.message ?? "Action failed", "err");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  // A Companion key raised a fill request (a key can't show a popup itself — issue 003). It arrives
  // on the state push to EVERY open dashboard, and each pops its own popup — a broadcast, not an
  // exclusive claim. The operator may be watching any one of several open surfaces (the desktop
  // window on the stream PC plus a phone over Tailscale); only broadcasting guarantees the popup
  // reaches the one they're looking at. The ref pops each request id exactly once, so a closed
  // popup stays closed and the 60s-lived slot doesn't re-pop it on later frames.
  const handledFill = useRef<string | null>(null);
  useEffect(() => {
    const request = state?.fillRequest;
    if (!request || handledFill.current === request.id) return;
    handledFill.current = request.id;
    void (async () => {
      // The preset list may predate the request (e.g. created after this tab loaded) — refetch
      // before declaring it unknown.
      const preset =
        presets.find((p) => p.id === request.presetId) ??
        (await api.presets.list()).find((p) => p.id === request.presetId);
      if (preset) setFilling(preset);
      else flash(`Companion asked to fill unknown preset “${request.presetId}”`, "err");
    })();
  }, [state?.fillRequest, presets, flash]);

  const fireFilledPreset = async (presetId: string, vars: Record<string, string>) => {
    const r = await api.action.preset(presetId, vars);
    if (r.success) flash("Preset applied to YouTube");
    return r;
  };

  const saveSettings = async (next: DefaultSettings) => {
    try {
      const saved = await api.settings.save(next);
      setSettings(saved);
      flash("Defaults saved");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  // Human labels for the app defaults, so "inherit default" shows what it inherits.
  const defaultCategoryLabel = settings.defaultCategory
    ? (categories.find((c) => c.id === settings.defaultCategory)?.title ??
      `id ${settings.defaultCategory}`)
    : null;
  const apiEnabled = state?.apiEnabled ?? true;

  const defaultStreamLabel = settings.defaultStreamBoundId
    ? (streams.find((s) => s.id === settings.defaultStreamBoundId)?.title ??
      settings.defaultStreamBoundId)
    : null;

  const copy = (value: string, label: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => flash(`${label} copied`));
  };

  const togglePrivacy = async () => {
    try {
      const r = await api.action.privacy();
      if (r.success) flash("Privacy toggled");
      else flash(r.error?.message ?? "Toggle failed", "err");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const saveWebhook = async (url: string) => {
    const trimmed = url.trim();
    try {
      const saved = await api.webhook.save(trimmed || null);
      setWebhookUrl(saved.url ?? "");
      flash(saved.url ? "Webhook saved" : "Webhook cleared");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const saveNotify = async (next: NotifyState) => {
    try {
      const saved = await api.notify.save(next);
      setNotify(saved);
      flash(saved.ntfyTopic ? "Phone push saved" : "Phone push disabled");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const undo = async () => {
    try {
      const r = await api.action.undo();
      if (r.success) flash("Reverted to previous state");
      else flash(r.error?.message ?? "Undo failed", "err");
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  // Master API switch: cut YouTube calls entirely when the service is idle so Companion's
  // polling stops burning quota. Optimistically flip so the breaker responds instantly, then
  // reconcile from the server (SSE will also push the authoritative value).
  const toggleApi = async (next: boolean) => {
    setState((s) => (s ? { ...s, apiEnabled: next } : s));
    try {
      const { apiEnabled } = await api.service.save(next);
      setState((s) => (s ? { ...s, apiEnabled } : s));
      flash(apiEnabled ? "YouTube API enabled" : "YouTube API paused — no quota in use");
    } catch (e) {
      setState((s) => (s ? { ...s, apiEnabled: !next } : s));
      flash((e as Error).message, "err");
    }
  };

  const refreshSession = async () => {
    setRefreshing(true);
    try {
      const r = await api.action.refresh();
      if (r.success) {
        setState(r);
        flash("Session refreshed from YouTube");
      } else {
        flash(r.error?.message ?? "Refresh failed", "err");
      }
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setRefreshing(false);
    }
  };

  const pushAdHoc = async (
    payload: Parameters<typeof api.action.update>[0],
  ) => {
    try {
      const r = await api.action.update(payload);
      if (r.success) {
        setAdHoc(false);
        flash("Ad-hoc update pushed");
      } else {
        flash(r.error?.message ?? "Update failed", "err");
      }
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  return (
    <div className="shell">
      <StatusRail
        state={state}
        onRefresh={refreshSession}
        refreshing={refreshing}
        onToggleApi={toggleApi}
        onOpenSettings={() => setSettingsOpen(true)}
        version={appInfo?.version ?? null}
        onShowWhatsNew={() => setWhatsNew("running")}
      />

      <main className="main">
        {/* Update banner — the ONLY way an update installs: an explicit click, never mid-stream. */}
        {appInfo ? (
          <UpdateBanner
            info={appInfo}
            onShowNotes={() => setWhatsNew("offered")}
            onRetry={() => void checkForUpdates()}
            retrying={checkingUpdate}
            flash={flash}
          />
        ) : null}

        {/* Reauth banner — only for a hard auth failure, never degraded/offline (PRD-03 §4). */}
        {state?.health === "auth_error" ? (
          <ReauthBanner
            onReconnected={refreshSession}
            onOpenSettings={() => setSettingsOpen(true)}
            flash={flash}
          />
        ) : null}

        {/* Firewall guidance — a network-level fault, never reauth (PRD-06 §2, issue 019). */}
        {state?.health === "offline" ? (
          <FirewallGuidance applyState={setState} flash={flash} />
        ) : null}

        {/* Presets */}
        <section className="panel">
          <div className="panel__head">
            <h2>Presets</h2>
            <div className="panel__head-actions">
              <button
                className="btn btn--sm"
                onClick={exportPresets}
                disabled={presets.length === 0}
                title="Download all presets as a JSON backup"
              >
                Export
              </button>
              <button
                className="btn btn--sm"
                onClick={() => importInput.current?.click()}
                title="Restore or clone presets from a JSON file"
              >
                Import
              </button>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importPresets(file);
                  e.target.value = "";
                }}
              />
              <button
                className="btn btn--primary btn--sm"
                onClick={() => setEditing("new")}
              >
                + New preset
              </button>
            </div>
          </div>
          <div className="panel__body">
            {presets.length === 0 ? (
              <p className="empty">
                No presets yet. Create one to map it to a Stream Deck button.
              </p>
            ) : (
              <div className="preset-grid">
                {presets.map((p) => (
                  <article className="card" key={p.id}>
                    <div className="card__title" dir="auto">{p.title}</div>
                    {p.description ? (
                      <div className="card__desc" dir="auto">{p.description}</div>
                    ) : null}
                    <div className="card__meta">
                      <span className={`pill ${PRIVACY_PILL[p.privacyStatus]}`}>
                        {p.privacyStatus}
                      </span>
                      <span
                        className="pill"
                        title={
                          p.category
                            ? `Category override: ${p.category}`
                            : `Inherits default category: ${defaultCategoryLabel ?? "none (leave untouched)"}`
                        }
                      >
                        {p.category
                          ? `cat ${p.category}`
                          : `cat · default: ${defaultCategoryLabel ?? "none"}`}
                      </span>
                      <span
                        className="pill"
                        title={
                          p.streamBoundId
                            ? `Stream override: ${p.streamBoundId}`
                            : `Inherits default binding: ${defaultStreamLabel ?? "none (leave untouched)"}`
                        }
                      >
                        {p.streamBoundId
                          ? "stream · override"
                          : `stream · default: ${defaultStreamLabel ?? "none"}`}
                      </span>
                    </div>
                    <div
                      className="mapping"
                      title="Fill-route deep link — paste into a Companion HTTP GET action"
                    >
                      <code>{buildFillUrl(location.origin, p.id)}</code>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          copy(buildFillUrl(location.origin, p.id), "Fill URL")
                        }
                      >
                        Copy URL
                      </button>
                    </div>
                    <div
                      className="mapping"
                      title="Direct-API JSON payload for the Companion body"
                    >
                      <code>{`{ "presetId": "${p.id}" }`}</code>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          copy(`{ "presetId": "${p.id}" }`, "Payload")
                        }
                      >
                        Copy JSON
                      </button>
                    </div>
                    <div className="card__actions">
                      <button
                        className="btn btn--sm"
                        onClick={() => applyPreset(p)}
                        disabled={(state?.busy ?? false) || !apiEnabled}
                        title={apiEnabled ? undefined : "YouTube API is paused"}
                      >
                        Apply now
                      </button>
                      <button
                        className="btn btn--sm"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--sm"
                        onClick={() => duplicatePreset(p)}
                        title="Create an editable copy of this preset"
                      >
                        Duplicate
                      </button>
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => deletePreset(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Defaults + Ad-hoc */}
        <section className="panel">
          <div className="panel__head">
            <h2>Default settings</h2>
            <div className="panel__head-actions">
              <button
                className="btn btn--sm"
                onClick={undo}
                disabled={(state?.busy ?? false) || !state?.undo || !apiEnabled}
                title={
                  state?.undo
                    ? `Revert the last change${state.undo.label ? ` (was “${state.undo.label}”)` : ""}`
                    : "Nothing to undo yet"
                }
              >
                Undo
              </button>
              <button
                className="btn btn--sm"
                onClick={togglePrivacy}
                disabled={
                  (state?.busy ?? false) || (state?.status.noTarget ?? false) || !apiEnabled
                }
                title={apiEnabled ? "Flip the live target between private and public" : "YouTube API is paused"}
              >
                Toggle privacy
              </button>
              <button
                className="btn btn--sm"
                onClick={() => setAdHoc(true)}
                disabled={!apiEnabled}
                title={apiEnabled ? undefined : "YouTube API is paused"}
              >
                Ad-hoc update…
              </button>
            </div>
          </div>
          <div className="panel__body">
            <p className="empty" style={{ marginTop: 0 }}>
              Baseline used whenever a preset or ad-hoc update leaves category
              or stream binding blank.
            </p>
            <div className="field--row" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="def-cat">Default category</label>
                <CategorySelect
                  id="def-cat"
                  value={settings.defaultCategory}
                  categories={categories}
                  blankLabel="— none (leave untouched) —"
                  onChange={(value) =>
                    saveSettings({ ...settings, defaultCategory: value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="def-stream">Default stream binding</label>
                <input
                  id="def-stream"
                  list="def-stream-list"
                  defaultValue={settings.defaultStreamBoundId ?? ""}
                  placeholder="stream id / key"
                  aria-invalid={
                    settings.defaultStreamBoundId != null &&
                    streams.length > 0 &&
                    !streams.some((s) => s.id === settings.defaultStreamBoundId)
                  }
                  onBlur={(e) =>
                    saveSettings({
                      ...settings,
                      defaultStreamBoundId: e.target.value.trim() || null,
                    })
                  }
                />
                <datalist id="def-stream-list">
                  {streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.streamName ? ` · ${s.streamName}` : ""}
                    </option>
                  ))}
                </datalist>
                {settings.defaultStreamBoundId != null &&
                streams.length > 0 &&
                !streams.some((s) => s.id === settings.defaultStreamBoundId) ? (
                  <p className="field-warn">
                    ⚠ No live stream on this channel has that ID — updates that rely on the
                    default binding will fail.
                  </p>
                ) : null}
              </div>
            </div>
            <p className="empty">Changes save when you leave a field.</p>
          </div>
        </section>

        {/* Webhook */}
        <section className="panel">
          <div className="panel__head">
            <h2>State webhook</h2>
          </div>
          <div className="panel__body">
            <p className="empty" style={{ marginTop: 0 }}>
              Optional. When set, every meaningful state change (live/idle, privacy,
              health, busy) is POSTed here as{" "}
              <span className="mono">{`{ "event": "state", "state": {…} }`}</span> — so
              Companion reacts instantly instead of polling.
            </p>
            <div className="field">
              <label htmlFor="webhook-url">Webhook URL</label>
              <input
                id="webhook-url"
                type="url"
                value={webhookUrl}
                placeholder="https://…"
                onChange={(e) => setWebhookUrl(e.target.value)}
                onBlur={(e) => saveWebhook(e.target.value)}
              />
            </div>
            <p className="empty">
              Saves when you leave the field. Clear it to disable.
            </p>
          </div>
        </section>

        {/* Phone push — the ntfy leg of the Companion fill flow (issue 003 trigger). */}
        <section className="panel">
          <div className="panel__head">
            <h2>Phone push (ntfy)</h2>
          </div>
          <div className="panel__body">
            <p className="empty" style={{ marginTop: 0 }}>
              Optional. A Companion “Request fill” key pops the fill dialog in any open
              dashboard. With a topic set here it also sends an{" "}
              <a href="https://ntfy.sh" target="_blank" rel="noreferrer">
                ntfy
              </a>{" "}
              notification — tap it on your phone to open the fill page, even with no dashboard
              open. Subscribe to the same topic in the ntfy app; treat the topic name as a secret.
            </p>
            <div className="field">
              <label htmlFor="ntfy-topic">Topic</label>
              <input
                id="ntfy-topic"
                value={notify.ntfyTopic}
                placeholder="e.g. masjid-fill-8k2j — empty disables the push"
                onChange={(e) => setNotify({ ...notify, ntfyTopic: e.target.value })}
                onBlur={() => saveNotify(notify)}
              />
            </div>
            <div className="field">
              <label htmlFor="ntfy-server">ntfy server</label>
              <input
                id="ntfy-server"
                type="url"
                value={notify.ntfyServer}
                placeholder="https://ntfy.sh"
                onChange={(e) => setNotify({ ...notify, ntfyServer: e.target.value })}
                onBlur={() => saveNotify(notify)}
              />
            </div>
            <div className="field">
              <label htmlFor="ntfy-base">Public base URL (what the phone opens)</label>
              <input
                id="ntfy-base"
                type="url"
                value={notify.publicBaseUrl}
                placeholder="usually leave blank — this machine's LAN address is used"
                onChange={(e) => setNotify({ ...notify, publicBaseUrl: e.target.value })}
                onBlur={() => saveNotify(notify)}
              />
            </div>
            <p className="empty">
              Leave the base URL blank when the phone is on the same network — the link points at
              this machine's LAN address automatically. Set it only when that address won't reach
              the phone (Tailscale, another subnet, a reverse proxy). Saves when you leave a field.
            </p>
          </div>
        </section>

        {/* Activity — the in-memory event feed (PRD-06 §3). */}
        <ActivityPanel />
      </main>

      {editing ? (
        <PresetForm
          title={editing === "new" ? "New preset" : "Edit preset"}
          initial={editing === "new" ? undefined : editing}
          categories={categories}
          streams={streams}
          defaultCategoryLabel={defaultCategoryLabel}
          defaultStreamLabel={defaultStreamLabel}
          onCancel={() => setEditing(null)}
          onSubmit={savePreset}
        />
      ) : null}

      {filling ? (
        <PresetFillModal
          preset={filling}
          fire={fireFilledPreset}
          onClose={() => setFilling(null)}
        />
      ) : null}

      {adHoc ? (
        <AdHocModal
          state={state}
          categories={categories}
          streams={streams}
          defaultCategoryLabel={defaultCategoryLabel}
          defaultStreamLabel={defaultStreamLabel}
          onCancel={() => setAdHoc(false)}
          onSubmit={pushAdHoc}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          categories={categories}
          streams={streams}
          onSaveSettings={saveSettings}
          flash={flash}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {whatsNew ? (
        <WhatsNewModal
          notes={whatsNew === "offered" ? (appInfo?.updateNotes ?? null) : (appInfo?.notes ?? null)}
          kind={whatsNew}
          onClose={() => setWhatsNew(null)}
          // Only the running-version panel offers a re-check, and only on hosts with an updater.
          onCheckUpdates={
            whatsNew === "running" && appInfo && appInfo.update.status !== "unsupported"
              ? checkForUpdates
              : undefined
          }
          checkingUpdates={checkingUpdate}
        />
      ) : null}

      {toast ? (
        <div className={`toast ${toast.kind === "err" ? "toast--err" : ""}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
