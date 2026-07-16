import { describe, expect, it } from "vitest";
import { fillLink, pushFillNotification } from "./ntfy.js";
import type { NotifyState, Preset } from "@app/shared";

const preset: Preset = {
  id: "lesson stream",
  title: "Lesson {topic}",
  slug: "",
  description: "",
  privacyStatus: "public",
  category: null,
  streamBoundId: null,
  titleFallback: null,
  descriptionFallback: null,
};

const notify = (over: Partial<NotifyState> = {}): NotifyState => ({
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "masjid-fill",
  publicBaseUrl: "",
  ...over,
});

describe("fillLink", () => {
  it("builds the /fill deep link and URL-encodes the preset id", () => {
    expect(fillLink("http://host:8080/", "lesson stream")).toBe(
      "http://host:8080/fill?preset=lesson+stream",
    );
  });
});

describe("pushFillNotification", () => {
  it("POSTs the tap-to-open notification as JSON to the server root", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const doFetch = (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const ok = await pushFillNotification(notify(), preset, "http://host:8080", doFetch);
    expect(ok).toBe(true);
    expect(seen!.url).toBe("https://ntfy.sh");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.topic).toBe("masjid-fill");
    expect(body.click).toBe("http://host:8080/fill?preset=lesson+stream");
    expect(body.title).toContain("Lesson {topic}");
  });

  it("delivers a non-Latin-1 title — headers can't, which is why the body carries it", async () => {
    const arabic: Preset = { ...preset, title: "صلاة المغرب | {imam}" };
    let body: Record<string, unknown> | null = null;
    // Real fetch() rejects non-Latin-1 *header* values before any I/O; building a Request here
    // proves nothing in this payload trips that.
    const doFetch = (async (url: unknown, init?: RequestInit) => {
      void new Request(String(url), init);
      body = JSON.parse(String(init?.body));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    expect(await pushFillNotification(notify(), arabic, "http://host:8080", doFetch)).toBe(true);
    expect(body!.title).toBe("Fill “صلاة المغرب | {imam}”");
  });

  it("does nothing without a topic", async () => {
    const doFetch = (async () => {
      throw new Error("must not be called");
    }) as typeof fetch;
    expect(await pushFillNotification(notify({ ntfyTopic: " " }), preset, "http://h", doFetch)).toBe(
      false,
    );
  });

  it("reports a rejected or failed push as undelivered", async () => {
    const rejected = (async () => new Response("nope", { status: 403 })) as typeof fetch;
    expect(await pushFillNotification(notify(), preset, "http://h", rejected)).toBe(false);

    const network = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await pushFillNotification(notify(), preset, "http://h", network)).toBe(false);
  });
});
