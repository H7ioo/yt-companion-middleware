import { describe, it, expect } from "vitest";
import {
  describeBroadcastState,
  describeIngestion,
  ACTION_GLOSSARY,
  INGESTION_GLOSSARY,
  type IngestionState,
} from "@app/shared";

describe("describeBroadcastState", () => {
  it("names the live state On Air with a LIVE badge", () => {
    const state = describeBroadcastState({ isLive: true, noTarget: false });
    expect(state.label).toBe("On Air");
    expect(state.badge).toBe("LIVE");
  });

  it("names the not-live state Idle regardless of target", () => {
    expect(describeBroadcastState({ isLive: false, noTarget: false }).label).toBe("Idle");
    expect(describeBroadcastState({ isLive: false, noTarget: true }).badge).toBe("IDLE");
  });
});

describe("ACTION_GLOSSARY", () => {
  it("gives every operator action one canonical name bound to its endpoint", () => {
    expect(ACTION_GLOSSARY.refreshState).toEqual({
      label: "Refresh from YouTube",
      endpoint: "/api/action/refresh",
    });
    expect(ACTION_GLOSSARY.refreshLists.label).toBe("Refresh lists");
    // Distinct endpoints so the two refreshes can never collapse into one another.
    expect(ACTION_GLOSSARY.refreshState.endpoint).not.toBe(
      ACTION_GLOSSARY.refreshLists.endpoint,
    );
  });
});

describe("describeIngestion", () => {
  // The three states issue 059 requires to be distinguishable, plus the honest fallback. Table
  // form on purpose: the mapping is the whole feature, and a mapping asserted case by case is one
  // an edit can quietly narrow.
  const cases: Array<{
    streamStatus: string | null;
    healthStatus: string | null;
    state: IngestionState;
    why: string;
  }> = [
    { streamStatus: "active", healthStatus: "good", state: "receiving", why: "video arriving cleanly" },
    { streamStatus: "active", healthStatus: "ok", state: "receiving", why: "arriving with minor notes" },
    { streamStatus: "active", healthStatus: null, state: "receiving", why: "arriving, quality unreported" },
    { streamStatus: "active", healthStatus: "bad", state: "problems", why: "arriving badly" },
    { streamStatus: "active", healthStatus: "noData", state: "no-data", why: "was active, nothing now" },
    { streamStatus: "error", healthStatus: "bad", state: "problems", why: "YouTube reports an error" },
    { streamStatus: "error", healthStatus: "good", state: "problems", why: "error outranks a stale good" },
    { streamStatus: "ready", healthStatus: "noData", state: "no-data", why: "key exists, encoder silent" },
    { streamStatus: "inactive", healthStatus: null, state: "no-data", why: "encoder not pushing" },
    { streamStatus: "created", healthStatus: null, state: "no-data", why: "key never used" },
    { streamStatus: null, healthStatus: null, state: "unknown", why: "nothing read yet" },
    { streamStatus: "teapot", healthStatus: "good", state: "unknown", why: "a value we do not know" },
  ];

  for (const c of cases) {
    it(`calls ${c.streamStatus}/${c.healthStatus} “${c.state}” — ${c.why}`, () => {
      expect(describeIngestion({ streamStatus: c.streamStatus, healthStatus: c.healthStatus }).state).toBe(
        c.state,
      );
    });
  }

  it("gives every state plain-language copy and a distinct key colour", () => {
    const states: IngestionState[] = ["receiving", "problems", "no-data", "unknown"];
    for (const state of states) {
      const term = INGESTION_GLOSSARY[state];
      expect(term.label.length).toBeGreaterThan(0);
      expect(term.meaning).toMatch(/\w+ \w+/);
      // Raw API vocabulary must not leak into operator copy — that is the whole point of the map.
      expect(`${term.label} ${term.meaning}`).not.toMatch(/noData|streamStatus|healthStatus/);
    }
    // "Receiving", "nothing arriving" and "arriving with problems" have to be visually distinct,
    // so they cannot share a colour.
    const colors = states.map((s) => INGESTION_GLOSSARY[s].keyColor);
    expect(new Set(colors.slice(0, 3)).size).toBe(3);
  });

  it("carries the term for the state it resolves, so a caller needs one call", () => {
    const readout = describeIngestion({ streamStatus: "active", healthStatus: "bad" });
    expect(readout).toMatchObject(INGESTION_GLOSSARY.problems);
  });
});
