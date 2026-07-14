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
  it("POSTs the tap-to-open notification to the topic", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const doFetch = (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const ok = await pushFillNotification(notify(), preset, "http://host:8080", doFetch);
    expect(ok).toBe(true);
    expect(seen!.url).toBe("https://ntfy.sh/masjid-fill");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Click).toBe("http://host:8080/fill?preset=lesson+stream");
    expect(headers.Title).toContain("Lesson {topic}");
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
