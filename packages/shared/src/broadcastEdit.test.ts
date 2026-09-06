import { describe, expect, it } from "vitest";
import { setupLock } from "./broadcastEdit.js";

describe("setupLock", () => {
  it("leaves the setup open before an encoder has bound", () => {
    expect(setupLock("created").locked).toBe(false);
    expect(setupLock("ready").locked).toBe(false);
  });

  it("locks the setup once the broadcast is on air, and says so in the app's own words", () => {
    const lock = setupLock("live");
    expect(lock.locked).toBe(true);
    expect(lock.reason).toContain("on air");
  });
});
