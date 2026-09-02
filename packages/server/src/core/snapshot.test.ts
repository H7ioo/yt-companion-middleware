import { describe, expect, it } from "vitest";
import { changeSignature, resolveDisplayLabel, type DashboardState } from "./snapshot.js";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Preset, Store } from "../storage/schema.js";

/** Minimal JsonStore stand-in exposing just the presets `resolveDisplayLabel` reads. */
function storeWith(presets: Preset[]): JsonStore {
  return { get: () => ({ presets }) as Store } as JsonStore;
}
function preset(over: Partial<Preset> = {}): Preset {
  return {
    id: "p1",
    title: "عنوان",
    slug: "",
    description: "",
    privacyStatus: "public",
    category: null,
    streamBoundId: null,
    titleFallback: null,
    descriptionFallback: null,
    ...over,
  };
}

function state(over: Partial<DashboardState> = {}): DashboardState {
  return {
    status: { broadcastId: "bc1", title: "T", privacyStatus: "public", isLive: false, noTarget: false },
    activePresetId: null,
    displayLabel: "Custom",
    slugPng: null,
    titlePng: null,
    health: "ok",
    healthMessage: null,
    lastRefreshedAt: "2026-07-03T00:00:00.000Z",
    targetPin: null,
    ingestion: null,
    busy: false,
    quota: { date: "2026-07-03", used: 0, limit: 10000, remaining: 10000 },
    undo: null,
    apiEnabled: true,
    fillRequest: null,
    targetConflict: null,
    ...over,
  };
}

describe("changeSignature", () => {
  it("ignores lastRefreshedAt heartbeat churn", () => {
    expect(changeSignature(state())).toBe(
      changeSignature(state({ lastRefreshedAt: "2026-07-03T00:01:00.000Z" })),
    );
  });

  it("changes when a visible field moves (isLive)", () => {
    expect(changeSignature(state())).not.toBe(
      changeSignature(
        state({
          status: {
            broadcastId: "bc1",
            title: "T",
            privacyStatus: "public",
            isLive: true,
            noTarget: false,
          },
        }),
      ),
    );
  });

  // The handover a title-only signature cannot see: with an auto-start encoder YouTube mints a
  // fresh broadcast moments before air, and two broadcasts can carry the same title. A surface
  // that links to the video — the embedded player (issue 065) — would go on pointing at the
  // broadcast that never aired until something else happened to move the signature.
  it("changes when the broadcast itself changes under an identical title", () => {
    expect(changeSignature(state())).not.toBe(
      changeSignature(
        state({
          status: {
            broadcastId: "bc2",
            title: "T",
            privacyStatus: "public",
            isLive: false,
            noTarget: false,
          },
        }),
      ),
    );
  });

  it("pushes a re-read ingestion answer, so the age stamp does not freeze at 'just now'", () => {
    // The reading is unchanged; only when it was taken has moved. The panel prints that age and
    // Companion exposes it as `ingestion_checked_at`, so an unpushed re-read leaves every surface
    // claiming a minutes-old answer is current.
    const reading = (checkedAt: string) => ({
      streamId: "S1",
      streamTitle: "OBS key",
      streamStatus: "active",
      healthStatus: "good",
      issues: [],
      checkedAt,
      state: "receiving" as const,
      label: "Receiving video",
      meaning: "m",
      remedy: "r",
    });
    expect(changeSignature(state({ ingestion: reading("2026-07-03T00:00:00.000Z") }))).not.toBe(
      changeSignature(state({ ingestion: reading("2026-07-03T00:02:00.000Z") })),
    );
    // Bucketed to the poll cadence: jitter within the same minute is not a push.
    expect(changeSignature(state({ ingestion: reading("2026-07-03T00:00:00.000Z") }))).toBe(
      changeSignature(state({ ingestion: reading("2026-07-03T00:00:31.000Z") })),
    );
  });

  it("changes on busy transitions", () => {
    expect(changeSignature(state())).not.toBe(changeSignature(state({ busy: true })));
  });

  it("changes when the display label moves (slug edited while active)", () => {
    expect(changeSignature(state({ displayLabel: "News" }))).not.toBe(
      changeSignature(state({ displayLabel: "Sports" })),
    );
  });

  it("changes when the API master switch is flipped", () => {
    expect(changeSignature(state())).not.toBe(changeSignature(state({ apiEnabled: false })));
  });

  it("does not react to sub-1% quota drift", () => {
    expect(changeSignature(state({ quota: { date: "d", used: 5, limit: 10000, remaining: 9995 } }))).toBe(
      changeSignature(state({ quota: { date: "d", used: 50, limit: 10000, remaining: 9950 } })),
    );
  });

  it("reacts once quota crosses a 1% bucket", () => {
    expect(changeSignature(state({ quota: { date: "d", used: 50, limit: 10000, remaining: 9950 } }))).not.toBe(
      changeSignature(state({ quota: { date: "d", used: 150, limit: 10000, remaining: 9850 } })),
    );
  });

  it("changes when a fill request is raised and again when it clears", () => {
    const pending = state({
      fillRequest: { id: "f1", presetId: "p1", requestedAt: "2026-07-03T00:00:00.000Z" },
    });
    expect(changeSignature(state())).not.toBe(changeSignature(pending));
    expect(changeSignature(pending)).not.toBe(changeSignature(state({ fillRequest: null })));
  });
});

describe("resolveDisplayLabel", () => {
  it("returns 'Custom' when no preset is active", () => {
    expect(resolveDisplayLabel(storeWith([]), null)).toBe("Custom");
  });

  it("returns 'Custom' when the active preset no longer exists", () => {
    expect(resolveDisplayLabel(storeWith([]), "gone")).toBe("Custom");
  });

  it("uses the slug when the active preset has one", () => {
    expect(resolveDisplayLabel(storeWith([preset({ slug: "Anwar" })]), "p1")).toBe("Anwar");
  });

  it("falls back to the preset id when the slug is unset", () => {
    expect(resolveDisplayLabel(storeWith([preset({ slug: "" })]), "p1")).toBe("p1");
  });

  it("treats a whitespace-only slug as unset", () => {
    expect(resolveDisplayLabel(storeWith([preset({ slug: "   " })]), "p1")).toBe("p1");
  });
});
