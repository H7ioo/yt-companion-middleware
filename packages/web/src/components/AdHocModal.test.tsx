// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TARGET_GLOSSARY } from "@app/shared";
import type { DashboardState } from "../api.js";
import { AdHocModal } from "./AdHocModal.js";

afterEach(cleanup);

const state = (over: Partial<DashboardState["status"]> = {}): DashboardState =>
  ({
    status: { title: "Friday service", privacyStatus: "unlisted", isLive: false, noTarget: false, ...over },
    activePresetId: null,
    displayLabel: "Custom",
    slugPng: null,
    titlePng: null,
    health: "ok",
    healthMessage: null,
    lastRefreshedAt: null,
    busy: false,
    quota: { date: "2026-08-30", used: 0, limit: 10000, remaining: 10000 },
    undo: null,
    ingestion: null,
    apiEnabled: true,
    fillRequest: null,
    targetConflict: null,
    targetPin: null,
  }) as DashboardState;

const props = {
  categories: [],
  streams: [],
  defaultCategoryLabel: null,
  defaultStreamLabel: null,
  onCancel: () => {},
  onSubmit: async () => {},
};

describe("AdHocModal target badge", () => {
  /**
   * The badge is the operator's last check before writing a title to a public broadcast, so it
   * has to name the resource that will actually be written. It used to say "the persistent
   * container" whenever idle — a thing YouTube deleted in 2020 (issue 066).
   */
  it("names the next upcoming broadcast when nothing is on air", () => {
    render(<AdHocModal {...props} state={state()} />);
    expect(screen.getByText(`Will update ${TARGET_GLOSSARY.upcoming.label.toLowerCase()}`)).toBeDefined();
  });

  it("names the airing broadcast when a stream is live", () => {
    render(<AdHocModal {...props} state={state({ isLive: true })} />);
    expect(screen.getByText(`Will update ${TARGET_GLOSSARY.live.label.toLowerCase()}`)).toBeDefined();
  });

  it("does not promise an update when the channel has no target at all", () => {
    render(<AdHocModal {...props} state={state({ noTarget: true })} />);
    expect(screen.queryByText(/^Will update/)).toBeNull();
    expect(screen.getByText(TARGET_GLOSSARY.none.meaning)).toBeDefined();
  });
});
