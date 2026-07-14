import { describe, expect, it } from "vitest";
import type os from "node:os";
import { lanIPv4, phoneBaseUrl } from "./baseUrl.js";

/** A minimal NetworkInterfaceInfo — only the fields lanIPv4 reads. */
const nic = (address: string, internal = false) =>
  ({ address, internal, family: "IPv4" }) as os.NetworkInterfaceInfo;

describe("lanIPv4", () => {
  it("prefers a 192.168.x address over a container/VPN one", () => {
    expect(lanIPv4([nic("172.17.0.1"), nic("192.168.1.50")])).toBe("192.168.1.50");
  });

  it("falls back through the private ranges, then to any non-internal IPv4", () => {
    expect(lanIPv4([nic("172.17.0.1"), nic("10.0.0.7")])).toBe("10.0.0.7");
    expect(lanIPv4([nic("100.64.0.3")])).toBe("100.64.0.3");
  });

  it("ignores loopback interfaces and reports none when that is all there is", () => {
    expect(lanIPv4([nic("127.0.0.1", true)])).toBeNull();
  });
});

describe("phoneBaseUrl", () => {
  const lan = () => "192.168.1.50";

  it("uses an explicit public base URL above everything, trimming a trailing slash", () => {
    const base = phoneBaseUrl(
      { publicBaseUrl: "https://studio.tail1234.ts.net/", protocol: "http", host: "10.0.0.2:8080" },
      lan,
    );
    expect(base).toBe("https://studio.tail1234.ts.net");
  });

  it("keeps the host Companion reached us on — the plain same-network case needs no config", () => {
    const base = phoneBaseUrl(
      { publicBaseUrl: "", protocol: "http", host: "192.168.1.50:8080" },
      lan,
    );
    expect(base).toBe("http://192.168.1.50:8080");
  });

  it("swaps a loopback host for the LAN IP, keeping the port", () => {
    expect(phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: "localhost:8080" }, lan)).toBe(
      "http://192.168.1.50:8080",
    );
    expect(phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: "127.0.0.1:8080" }, lan)).toBe(
      "http://192.168.1.50:8080",
    );
    expect(phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: "[::1]:8080" }, lan)).toBe(
      "http://192.168.1.50:8080",
    );
  });

  it("reports no usable base when the host is loopback and there is no LAN IP", () => {
    expect(
      phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: "localhost:8080" }, () => null),
    ).toBeNull();
  });

  it("handles a host with no port", () => {
    expect(phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: "localhost" }, lan)).toBe(
      "http://192.168.1.50",
    );
    expect(phoneBaseUrl({ publicBaseUrl: "", protocol: "http", host: undefined }, lan)).toBe(
      "http://192.168.1.50",
    );
  });
});
