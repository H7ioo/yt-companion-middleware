import { describe, expect, it } from "vitest";
import { deriveActiveFlow } from "./setupStatus.js";

const creds = (over: Partial<{ clientId: string; clientSecret: string; refreshToken: string }> = {}) => ({
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  ...over,
});

describe("deriveActiveFlow", () => {
  it("is null when the server is not configured", () => {
    expect(deriveActiveFlow(creds(), { configured: false })).toBeNull();
  });

  it("is 'bundled' when the stored client matches the bundled client", () => {
    const c = creds({ clientId: "bundled.apps", clientSecret: "s", refreshToken: "1//x" });
    expect(deriveActiveFlow(c, { configured: true, bundledClientId: "bundled.apps" })).toBe("bundled");
  });

  it("is 'override' when the stored client differs from the bundled client", () => {
    const c = creds({ clientId: "mine.apps", clientSecret: "s", refreshToken: "1//x" });
    expect(deriveActiveFlow(c, { configured: true, bundledClientId: "bundled.apps" })).toBe("override");
  });

  it("is 'override' when there is a stored client but no bundled client to compare against", () => {
    const c = creds({ clientId: "mine.apps", clientSecret: "s", refreshToken: "1//x" });
    expect(deriveActiveFlow(c, { configured: true })).toBe("override");
  });

  it("is 'env' when configured but no credentials are stored (supplied via env/CLI)", () => {
    expect(deriveActiveFlow(creds(), { configured: true, bundledClientId: "bundled.apps" })).toBe("env");
  });
});
