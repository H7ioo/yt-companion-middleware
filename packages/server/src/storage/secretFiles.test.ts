import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SECRET_FILE_MODE, tighten } from "./secretFiles.js";

/**
 * Issue 067. The modes themselves are asserted where they matter — on a real JsonStore and a real
 * AuditLog. What is left here is the one case those cannot stage: a data directory this process is
 * not allowed to chmod, which is what a bind mount owned by another uid looks like.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "secretfiles-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("tightening a path we do not own", () => {
  it("warns and carries on rather than refusing to boot", async () => {
    const file = path.join(dir, "store.json");
    await fs.writeFile(file, "{}", "utf8");
    const denied = Object.assign(new Error("EPERM"), { code: "EPERM" });
    vi.spyOn(fs, "chmod").mockRejectedValue(denied);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Not being able to lock the file down is worth shouting about; it is not worth a server that
    // will not start on show night over a bind mount owned by another uid.
    await expect(tighten(file, SECRET_FILE_MODE)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0])).toContain(file);
  });
});
