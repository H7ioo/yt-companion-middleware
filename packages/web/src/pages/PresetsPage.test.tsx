// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import type { Preset } from "../api.js";
import type { DashboardContext } from "./context.js";
import { PresetsPage } from "./PresetsPage.js";

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: "friday",
  title: "Friday service",
  slug: "FRI",
  description: "Doors at 7",
  privacyStatus: "unlisted",
  category: null,
  streamBoundId: null,
  titleFallback: null,
  descriptionFallback: null,
  ...over,
});

/** The shell's context, stubbed down to what this page reads. */
function context(over: Partial<DashboardContext> = {}): DashboardContext {
  const noop = () => {};
  return {
    state: null,
    presets: [],
    presetsRead: "ready",
    categories: [],
    streams: [],
    settings: {} as DashboardContext["settings"],
    apiEnabled: true,
    admin: true,
    refreshing: false,
    refreshSession: noop,
    flash: noop,
    defaultCategoryLabel: null,
    defaultStreamLabel: null,
    applyPreset: noop,
    duplicatePreset: noop,
    deletePreset: noop,
    exportPresets: noop,
    importPresets: noop,
    newPreset: noop,
    editPreset: noop,
    copy: noop,
    undo: noop,
    togglePrivacy: noop,
    openAdHoc: noop,
    saveSettings: noop,
    webhookUrl: "",
    setWebhookUrl: noop,
    saveWebhook: noop,
    notify: {} as DashboardContext["notify"],
    setNotify: noop,
    saveNotify: noop,
    pushAdHoc: noop,
    ...over,
  } as DashboardContext;
}

function mount(over: Partial<DashboardContext> = {}) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context(over)} />}>
          <Route path="/" element={<PresetsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("PresetsPage, first paint (issue 073)", () => {
  it("stands skeleton cards in until the library has been read", () => {
    const { container } = mount({ presetsRead: "loading" });
    expect(container.querySelectorAll(".skel__row").length).toBe(3);
    expect(screen.getByText("Reading the presets…")).toBeTruthy();
    // The invitation is an answer, and it must not be given before the question is asked.
    expect(screen.queryByText(/No presets yet/)).toBeNull();
  });

  it("invites the first preset once the library is known to be empty", () => {
    const { container } = mount({ presetsRead: "ready" });
    expect(container.querySelector(".skel__row")).toBeNull();
    expect(screen.getByText(/No presets yet/)).toBeTruthy();
  });

  it("shows the presets it has, with no skeletons", () => {
    const { container } = mount({ presets: [preset()], presetsRead: "ready" });
    expect(screen.getByText("Friday service")).toBeTruthy();
    expect(container.querySelector(".skel__row")).toBeNull();
  });

  it("says the read failed rather than animating forever", () => {
    const { container } = mount({ presetsRead: "failed" });
    expect(container.querySelector(".skel__row")).toBeNull();
    expect(screen.getByText(/Could not read the presets/)).toBeTruthy();
  });
});
