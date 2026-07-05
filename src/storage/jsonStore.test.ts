import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "./jsonStore.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsonstore-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("seeds an empty store on first init and persists it", async () => {
    const file = path.join(dir, "store.json");
    const store = new JsonStore(file);
    await store.init();
    expect(store.get().presets).toEqual([]);
    // The file exists on disk after seeding.
    await expect(fs.access(file)).resolves.toBeUndefined();
  });

  it("persists updates and reloads them", async () => {
    const file = path.join(dir, "store.json");
    const a = new JsonStore(file);
    await a.init();
    await a.update((s) => {
      s.defaults.defaultCategory = "20";
    });

    const b = new JsonStore(file);
    await b.init();
    expect(b.get().defaults.defaultCategory).toBe("20");
  });

  it("serializes concurrent updates without losing writes", async () => {
    const store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((s) => {
          s.presets.push({
            id: `p${i}`,
            title: `t${i}`,
            description: "",
            privacyStatus: "public",
            category: null,
            streamBoundId: null,
            titleFallback: null,
            descriptionFallback: null,
          });
        }),
      ),
    );
    expect(store.get().presets).toHaveLength(20);
  });

  it("writes atomically (no leftover temp file after a successful write)", async () => {
    const file = path.join(dir, "store.json");
    const store = new JsonStore(file);
    await store.init();
    await store.update((s) => {
      s.defaults.defaultStreamBoundId = "abc";
    });
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
  });
});
