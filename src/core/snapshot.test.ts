import { describe, expect, it } from "vitest";
import { changeSignature, type DashboardState } from "./snapshot.js";

function state(over: Partial<DashboardState> = {}): DashboardState {
  return {
    status: { title: "T", privacyStatus: "public", isLive: false, noTarget: false },
    activePresetId: null,
    health: "ok",
    healthMessage: null,
    lastRefreshedAt: "2026-07-03T00:00:00.000Z",
    busy: false,
    quota: { date: "2026-07-03", used: 0, limit: 10000, remaining: 10000 },
    undo: null,
    apiEnabled: true,
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
      changeSignature(state({ status: { title: "T", privacyStatus: "public", isLive: true, noTarget: false } })),
    );
  });

  it("changes on busy transitions", () => {
    expect(changeSignature(state())).not.toBe(changeSignature(state({ busy: true })));
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
});
