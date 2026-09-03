import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, ScrollRestoration, useNavigate } from "react-router";
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
  type SessionInfo,
} from "./api.js";
import { StatusRail } from "./components/StatusRail.js";
import { NavBar } from "./components/NavBar.js";
import { SessionNotice } from "./components/SessionNotice.js";
import { ReauthBanner } from "./components/ReauthBanner.js";
import { FirewallGuidance } from "./components/FirewallGuidance.js";
import { TargetConflictBanner } from "./components/TargetConflictBanner.js";
import { RidingModeNotice } from "./components/RidingModeNotice.js";
import { PresetForm } from "./components/PresetForm.js";
import { PresetFillModal } from "./components/PresetFillModal.js";
import { AdHocModal } from "./components/AdHocModal.js";
import { UpdateBanner } from "./components/UpdateBanner.js";
import { WhatsNewModal } from "./components/WhatsNewModal.js";
import { extractVars } from "./lib/template.js";
import { shouldAnnounce, readLastSeen, markSeen } from "./lib/whatsNew.js";
import { appInfoChanged } from "./lib/appInfo.js";
import { canAdminister } from "./lib/session.js";
import { clearConnectReturn, readConnectReturn } from "./lib/connectReturn.js";
import type { DashboardContext } from "./pages/context.js";

type Toast = { message: string; kind: "ok" | "err" } | null;

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
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  /** Sign-in state (issue 043). Null on a deployment that does not authenticate. */
  const [session, setSession] = useState<SessionInfo | null>(null);
  // Tracked separately from `session`, as main.tsx does: "not signed in" and "not asked yet" are
  // both null, and null reads as "no accounts here, show everything" to canAdminister. Without
  // this a signed-in user would get the admin affordances — and the admin-only fetches behind
  // them — for the moment before /api/auth/me answers.
  const [askedWhoIAm, setAskedWhoIAm] = useState(false);
  /** Which release notes the panel is showing, if any: the running build's, or the offered one's. */
  const [whatsNew, setWhatsNew] = useState<"running" | "offered" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  // Pages are reached by URL, so anything that used to open a panel now navigates to one.
  const navigate = useNavigate();

  const flash = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // The hosted connect flow returns the browser here, not to a promise (issue 052): reconnecting
  // from Settings navigates to Google and comes back as a fresh page load, so the outcome is
  // waiting on the URL. Reported once, then cleared, so a reload does not replay it.
  useEffect(() => {
    const returned = readConnectReturn(new URL(window.location.href));
    if (returned) flash(returned.ok ? "YouTube connected" : returned.message, returned.ok ? "ok" : "err");
    clearConnectReturn();
  }, [flash]);

  // Manual update re-check. The launch check is once-only, so a release published while the app
  // runs is invisible until restart without this. Refetches app info after so the banner reflects
  // a found update immediately rather than on the next 60s poll.
  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const { update, checked } = await api.app.check();
      const info = await api.app.info();
      setAppInfo((prev) => (appInfoChanged(prev, info) ? info : prev));
      if (update.status === "downloading" || update.status === "downloaded") {
        flash(
          `Update v${update.version ?? "?"} found — downloading in the background`,
        );
      } else if (update.status === "error") {
        flash(update.error ?? "Update check failed", "err");
      } else if (!checked) {
        // The request was a no-op — a check was already in flight. Saying "up to date" here would
        // report a result from a check that never ran.
        flash("A check is already running");
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

  /**
   * Who is signed in (issue 043). Also the source of the expiry notice, so it is re-read after a
   * renewal rather than being patched in place. A failure leaves the state null, which reads as
   * "this deployment does not authenticate" — the safe answer, since the alternative is a login
   * screen on an install that has no accounts to sign into.
   */
  const loadSignIn = useCallback(
    () =>
      api.auth
        .me()
        .then(setSession)
        .catch(() => {})
        .finally(() => setAskedWhoIAm(true)),
    [],
  );

  /** Ends the session server-side, then reloads so the gate in main.tsx shows the login screen. */
  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    void loadSignIn();
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
  }, [loadPresets, loadSignIn]);

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
          if (shouldAnnounce(info.version, readLastSeen()))
            setWhatsNew("running");
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
      const tick = () =>
        api
          .state()
          .then(apply)
          .catch(() => {});
      void tick();
      pollId = window.setInterval(tick, 5000);
    };

    // Seed immediately so the rail isn't blank while the stream connects.
    void api
      .state()
      .then(apply)
      .catch(() => {});
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
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `presets-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash(
        `Exported ${data.presets.length} preset${data.presets.length === 1 ? "" : "s"}`,
      );
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
      // Operator-opened: never subject to the fill request's expiry close.
      fillOpenedBy.current = null;
      fillAnswered.current = false;
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
  // popup stays closed and the 30s-lived slot doesn't re-pop it on later frames.
  const handledFill = useRef<string | null>(null);
  // Which request's popup is on screen, if any. Lets the expiry push close a popup nobody
  // answered without ever touching an operator-opened one (applyPreset also drives `filling`).
  const fillOpenedBy = useRef<string | null>(null);
  // The newest request id seen on a push, kept in a ref so the async open below can tell whether
  // its request is still the current one after awaiting the preset list.
  const latestFill = useRef<string | null>(null);
  // Set once the operator types into the popup. Half-answered work is theirs, not the server's:
  // the expiry push may close an untouched popup, never one being filled in.
  const fillAnswered = useRef(false);
  useEffect(() => {
    const request = state?.fillRequest;
    latestFill.current = request?.id ?? null;
    // The slot expired (or was replaced): a request-opened popup must not outlive its moment —
    // the server signals expiry precisely so this push arrives.
    if (
      fillOpenedBy.current &&
      fillOpenedBy.current !== request?.id &&
      !fillAnswered.current
    ) {
      fillOpenedBy.current = null;
      setFilling(null);
    }
    if (!request || handledFill.current === request.id) return;
    handledFill.current = request.id;
    void (async () => {
      // The preset list may predate the request (e.g. created after this tab loaded) — refetch
      // before declaring it unknown.
      const preset =
        presets.find((p) => p.id === request.presetId) ??
        (await api.presets.list()).find((p) => p.id === request.presetId);
      // That refetch can outlive the request: by now it may have expired or been superseded.
      // Opening anyway would show a stale preset and leave fillOpenedBy pointing at a dead id,
      // so nothing could close it.
      if (latestFill.current !== request.id) return;
      if (preset) {
        fillOpenedBy.current = request.id;
        fillAnswered.current = false;
        setFilling(preset);
      } else
        flash(
          `Companion asked to fill unknown preset “${request.presetId}”`,
          "err",
        );
    })();
  }, [state?.fillRequest, presets, flash]);

  const fireFilledPreset = async (
    presetId: string,
    vars: Record<string, string>,
  ) => {
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
  // What this person is allowed to be shown (issue 045). Always true on a deployment with no
  // accounts, so the desktop and LAN dashboards look exactly as they always have — but only once
  // /api/auth/me has answered, so a user never flashes the admin controls on the way there.
  const admin = askedWhoIAm && canAdminister(session);

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
      flash(
        apiEnabled
          ? "YouTube API enabled"
          : "YouTube API paused — no quota in use",
      );
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

  // Everything a page may need, handed down through the router's outlet. The shell keeps the
  // live state, the fetches and the modals; a page is a view onto them.
  const context: DashboardContext = {
    state,
    presets,
    categories,
    streams,
    settings,
    apiEnabled,
    admin,
    refreshing,
    refreshSession,
    flash,
    defaultCategoryLabel,
    defaultStreamLabel,
    applyPreset,
    duplicatePreset,
    deletePreset,
    exportPresets,
    importPresets,
    newPreset: () => setEditing("new"),
    editPreset: setEditing,
    copy,
    undo,
    togglePrivacy,
    openAdHoc: () => setAdHoc(true),
    saveSettings,
    webhookUrl,
    setWebhookUrl,
    saveWebhook,
    notify,
    setNotify,
    saveNotify,
    pushAdHoc,
  };

  return (
    <div className="shell">
      <StatusRail
        state={state}
        onRefresh={refreshSession}
        refreshing={refreshing}
        onToggleApi={toggleApi}
        version={appInfo?.version ?? null}
        onShowWhatsNew={() => setWhatsNew("running")}
        account={session?.account ?? null}
        onSignOut={signOut}
      />

      <main className="main">
        {/* Which page is showing. Above the banners because it is the fixed furniture: an
            operator scanning for the way to Presets should never have to read a banner first. */}
        <NavBar isLive={state?.status.isLive ?? false} />

        {/* The banners sit in the shell, not on a page. Each one reports something that stops the
            whole app working, and none of them may be hidden behind a tab nobody has open. */}

        {/* Session cap notice — a signed-in browser gets one week's warning before the 90-day
            absolute cap logs it out (issue 043). Silent on every other deployment. */}
        <SessionNotice info={session} onRenewed={loadSignIn} />

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
            canAdminister={admin}
            onReconnected={refreshSession}
            onOpenSettings={() => navigate("/settings")}
            flash={flash}
          />
        ) : null}

        {/* Firewall guidance — a network-level fault, never reauth (PRD-06 §2, issue 019). */}
        {state?.health === "offline" ? (
          <FirewallGuidance applyState={setState} flash={flash} />
        ) : null}

        {/* Target conflict — healthy connection, ambiguous aim (PRD-12 §3). Shown alongside health
            banners rather than instead of them: they answer different questions. */}
        {state?.targetConflict ? (
          <TargetConflictBanner
            conflict={state.targetConflict}
            onRefresh={refreshSession}
            refreshing={refreshing}
          />
        ) : null}

        {/* Riding along — YouTube refuses to let this channel create broadcasts (issue 061). It
            explains what the operator can and cannot do on every page below, and never stands in
            for a health banner: this one is about permissions, those are about the connection. */}
        {state ? <RidingModeNotice eligibility={state.liveEligibility} /> : null}

        <Outlet context={context} />
      </main>

      {/* Scroll handling for the tabs: react-router does nothing here on its own, so leaving a
          long Activity page for Live would land you mid-page with the navbar and the banners
          off-screen. This scrolls a new page to the top and puts back where you were on
          back/forward. */}
      <ScrollRestoration />

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
          // Remount per preset: a second fill request swaps `preset` in place, and the modal's
          // `values` state would still be keyed to the previous preset's variables.
          key={filling.id}
          preset={filling}
          fire={fireFilledPreset}
          onDirty={() => {
            fillAnswered.current = true;
          }}
          onClose={() => {
            fillOpenedBy.current = null;
            fillAnswered.current = false;
            setFilling(null);
          }}
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

      {whatsNew ? (
        <WhatsNewModal
          notes={
            whatsNew === "offered"
              ? (appInfo?.updateNotes ?? null)
              : (appInfo?.notes ?? null)
          }
          kind={whatsNew}
          onClose={() => setWhatsNew(null)}
          // Only the running-version panel offers a re-check, and only on hosts with an updater.
          onCheckUpdates={
            whatsNew === "running" &&
            appInfo &&
            appInfo.update.status !== "unsupported"
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
