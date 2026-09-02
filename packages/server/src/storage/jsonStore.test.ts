import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "./jsonStore.js";
import { emptyStore } from "./schema.js";

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
            slug: "",
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

// Issue 067: store.json is credential material — it holds the YouTube refresh token in plaintext,
// a decision taken in issue 042 on the condition that the file itself is locked down. These modes
// are that condition. POSIX only: Windows has no mode bits for chmod to set.
describe.skipIf(process.platform === "win32")("JsonStore file permissions", () => {
  it("creates the data directory 0700 and store.json 0600 on a fresh boot", async () => {
    const nested = path.join(dir, "fresh");
    const file = path.join(nested, "store.json");
    const store = new JsonStore(file);
    await store.init();

    const dirMode = (await fs.stat(nested)).mode & 0o777;
    const fileMode = (await fs.stat(file)).mode & 0o777;
    expect(dirMode.toString(8)).toBe("700");
    expect(fileMode.toString(8)).toBe("600");
  });

  it("tightens a data directory and store that a previous version left world-readable", async () => {
    // The upgrade path, and the reason this cannot be left to the create-time mode alone: mkdir
    // ignores its mode for a directory that already exists, and writeFile ignores its mode for a
    // file that already exists. Every deployment made before this change is sitting at 0755/0644.
    const nested = path.join(dir, "legacy");
    const file = path.join(nested, "store.json");
    await fs.mkdir(nested, { recursive: true, mode: 0o755 });
    await fs.writeFile(file, JSON.stringify(emptyStore()), { encoding: "utf8", mode: 0o644 });

    await new JsonStore(file).init();

    expect(((await fs.stat(nested)).mode & 0o777).toString(8)).toBe("700");
    expect(((await fs.stat(file)).mode & 0o777).toString(8)).toBe("600");
  });

  it("keeps the store 0600 when a loose temp file survived an earlier crash", async () => {
    // The atomic write renames the temp file *over* store.json, so the temp file's mode becomes
    // the store's mode. writeFile only applies its mode when it creates the file, so a .tmp left
    // behind by a crash — at whatever mode it then had — would silently re-open the store.
    const file = path.join(dir, "store.json");
    const store = new JsonStore(file);
    await store.init();
    await fs.writeFile(`${file}.tmp`, "{}", { encoding: "utf8", mode: 0o644 });

    await store.update((s) => {
      s.defaults.defaultStreamBoundId = "abc";
    });

    expect(((await fs.stat(file)).mode & 0o777).toString(8)).toBe("600");
  });
});
