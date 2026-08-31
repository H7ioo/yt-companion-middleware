import type { SessionInfo } from "../api.js";

/**
 * What the dashboard does with its sign-in state (issue 043).
 *
 * Kept as plain functions rather than logic inside App: "is this deployment even authenticating"
 * has three answers, not two, and the one that must never be got wrong — a desktop install with
 * no accounts — is the one that would otherwise show a login screen nobody can pass.
 */

/** True only when the deployment authenticates and this browser is not signed in. */
export function showLogin(info: SessionInfo | null): boolean {
  if (!info) return false;
  return info.authRequired && !info.authenticated;
}

/**
 * Whether this browser may see the admin-only controls (issue 045): connecting and disconnecting
 * YouTube, and the roles of the people here. The dashboard hides what the signed-in person cannot
 * do rather than offering it and answering 403 — a button that always fails is worse than no
 * button, and this is the only place the two roles differ visually.
 *
 * A deployment with no accounts says yes to everything, for the same reason it shows no login
 * screen: the desktop and LAN installs have one operator, no roles, and nobody to ask.
 *
 * This is a display rule, never a security one. The guard on the server is what actually refuses;
 * this only decides what is worth rendering.
 */
export function canAdminister(info: SessionInfo | null): boolean {
  if (!info || !info.authRequired) return true;
  return info.account?.role === "admin";
}

/** Whole days from now until the session's absolute cap, rounded down. */
export function daysUntilExpiry(info: SessionInfo, now: number = Date.now()): number {
  if (!info.absoluteExpiresAt) return 0;
  return Math.max(0, Math.floor((Date.parse(info.absoluteExpiresAt) - now) / 86_400_000));
}

/**
 * The notice shown above the dashboard as a session approaches its 90-day cap, or null while
 * there is nothing to say. It names the deadline in days because "expiring soon" tells an
 * operator nothing about whether it will happen during tonight's stream.
 */
export function expiryNotice(info: SessionInfo | null, now: number = Date.now()): string | null {
  if (!info?.authenticated || !info.expiringSoon) return null;
  const days = daysUntilExpiry(info, now);
  if (days <= 0) return "Your sign-in expires today. Stay signed in to avoid being interrupted.";
  if (days === 1) return "Your sign-in expires tomorrow. Stay signed in to avoid being interrupted.";
  return `Your sign-in expires in ${days} days. Stay signed in to avoid being interrupted.`;
}
