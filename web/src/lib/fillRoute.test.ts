import { describe, expect, it } from "vitest";
import { isHttpUrl, parseFillRoute } from "./fillRoute.js";

describe("parseFillRoute", () => {
  it("returns null for a non-/fill path", () => {
    expect(parseFillRoute({ pathname: "/", search: "?preset=p1" })).toBeNull();
  });

  it("returns null when preset is missing", () => {
    expect(parseFillRoute({ pathname: "/fill", search: "?redirect=http://x" })).toBeNull();
  });

  it("extracts preset and an http(s) redirect", () => {
    expect(
      parseFillRoute({ pathname: "/fill", search: "?preset=p1&redirect=http://192.168.1.9:8000/done" }),
    ).toEqual({ presetId: "p1", redirect: "http://192.168.1.9:8000/done" });
  });

  it("keeps preset but nulls a non-http(s) redirect", () => {
    expect(
      parseFillRoute({ pathname: "/fill", search: "?preset=p1&redirect=javascript:alert(1)" }),
    ).toEqual({ presetId: "p1", redirect: null });
  });

  it("nulls redirect when it is absent", () => {
    expect(parseFillRoute({ pathname: "/fill", search: "?preset=p1" })).toEqual({
      presetId: "p1",
      redirect: null,
    });
  });

  it("decodes an encoded redirect value", () => {
    const redirect = "https://companion.local/instance/x?feedback=ok";
    expect(
      parseFillRoute({ pathname: "/fill", search: `?preset=p1&redirect=${encodeURIComponent(redirect)}` }),
    ).toEqual({ presetId: "p1", redirect });
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://a.b")).toBe(true);
    expect(isHttpUrl("https://a.b")).toBe(true);
  });

  it("rejects other schemes and garbage", () => {
    expect(isHttpUrl("ftp://a.b")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});
