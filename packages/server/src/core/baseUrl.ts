import os from "node:os";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The machine's first non-internal IPv4, preferring the common private LAN ranges over
 * virtual/VPN/container interfaces (Docker's 172.17.x, etc.) so a same-network phone gets the
 * address it can actually reach. null when the host has no non-loopback IPv4 at all.
 */
export function lanIPv4(ifaces: os.NetworkInterfaceInfo[] = allIPv4()): string | null {
  const addrs = ifaces.filter((ni) => !ni.internal).map((ni) => ni.address);
  return (
    addrs.find((a) => a.startsWith("192.168.")) ??
    addrs.find((a) => a.startsWith("10.")) ??
    addrs.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    addrs[0] ??
    null
  );
}

function allIPv4(): os.NetworkInterfaceInfo[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((ni): ni is os.NetworkInterfaceInfo => ni?.family === "IPv4");
}

/** Splits a `Host` header into hostname + optional port, tolerating an IPv6 `[::1]:8080` form. */
function splitHostPort(host: string): { hostname: string; port: string } {
  const v6 = host.match(/^(\[[^\]]+\])(?::(\d+))?$/);
  if (v6) return { hostname: v6[1], port: v6[2] ?? "" };
  const i = host.lastIndexOf(":");
  if (i === -1) return { hostname: host, port: "" };
  return { hostname: host.slice(0, i), port: host.slice(i + 1) };
}

/**
 * The base URL the operator's *phone* should open for a fill link. Priority:
 *
 * 1. An explicit `publicBaseUrl` — for anything the LAN address can't cover (a Tailscale
 *    hostname, a reverse proxy, a different subnet).
 * 2. The host Companion reached us on — already correct for the common same-network case where
 *    Companion points at the server's LAN IP.
 * 3. If that host is loopback (Companion co-located with the middleware, talking to localhost),
 *    swap the hostname for the machine's LAN IPv4, keeping the port — otherwise the phone would
 *    get a `localhost` link pointing at itself.
 *
 * Returns null only when the push cannot produce a phone-reachable link (loopback host and no
 * detectable LAN IP); the caller skips the push rather than send a dead link.
 */
export function phoneBaseUrl(
  opts: { publicBaseUrl: string; protocol: string; host: string | undefined },
  lookup: () => string | null = lanIPv4,
): string | null {
  const explicit = opts.publicBaseUrl.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const host = opts.host?.trim() ?? "";
  if (!host) {
    const ip = lookup();
    return ip ? `${opts.protocol}://${ip}` : null;
  }

  const { hostname, port } = splitHostPort(host);
  if (LOOPBACK.has(hostname)) {
    const ip = lookup();
    if (!ip) return null;
    return `${opts.protocol}://${ip}${port ? `:${port}` : ""}`;
  }
  return `${opts.protocol}://${host}`;
}
