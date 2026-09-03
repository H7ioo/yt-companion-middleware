import { useOutletContext } from "react-router";
import type {
  Category,
  DashboardState,
  DefaultSettings,
  NotifyState,
  Preset,
  StreamInfo,
  api,
} from "../api.js";

/**
 * What the shell hands every page (issue: navbar + pages).
 *
 * The shell still owns the live state, the fetches and the modals — a page is a view of them, not
 * a second copy. Passing it through the router's outlet context rather than a global keeps the
 * data flow the same one-way shape the single-page dashboard had: the shell holds it, the page
 * renders it, and an action goes back up through a callback that already existed.
 */
export interface DashboardContext {
  /** Live state from the SSE stream, or null until the first frame lands. */
  state: DashboardState | null;
  presets: Preset[];
  categories: Category[];
  streams: StreamInfo[];
  settings: DefaultSettings;
  /** The master breaker. False means every YouTube call is off, so actions are disabled. */
  apiEnabled: boolean;
  /** Whether this person may be shown the admin affordances (issue 045). */
  admin: boolean;
  refreshing: boolean;
  refreshSession: () => void;
  flash: (message: string, kind?: "ok" | "err") => void;

  /** Human labels for the app defaults, so "inherit default" shows what it inherits. */
  defaultCategoryLabel: string | null;
  defaultStreamLabel: string | null;

  /** Presets */
  applyPreset: (preset: Preset) => void;
  duplicatePreset: (preset: Preset) => void;
  deletePreset: (preset: Preset) => void;
  exportPresets: () => void;
  importPresets: (file: File) => void;
  newPreset: () => void;
  editPreset: (preset: Preset) => void;
  copy: (value: string, label: string) => void;

  /** On-air actions */
  undo: () => void;
  togglePrivacy: () => void;
  openAdHoc: () => void;

  /** Settings */
  saveSettings: (next: DefaultSettings) => void;
  webhookUrl: string;
  setWebhookUrl: (url: string) => void;
  saveWebhook: (url: string) => void;
  notify: NotifyState;
  setNotify: (next: NotifyState) => void;
  saveNotify: (next: NotifyState) => void;

  /** Ad-hoc push, kept here because the modal it feeds lives in the shell. */
  pushAdHoc: (payload: Parameters<typeof api.action.update>[0]) => void;
}

export function useDashboard(): DashboardContext {
  return useOutletContext<DashboardContext>();
}
