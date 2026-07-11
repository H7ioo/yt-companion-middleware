// Canonical copy + OS-specific fix steps for the `offline` firewall-guidance panel
// (PRD-06 §2, issue 019). Kept as data (not JSX) so the wording is unit-tested and can be
// re-used verbatim by the guide — the "one canonical string" wording-parity rule (PRD-06 §1.2 #10).

export interface GuidanceStep {
  readonly text: string;
  /** A terminal command the operator can copy, rendered in mono when present. */
  readonly command?: string;
}

export interface OsGuidance {
  readonly os: "Windows" | "Linux";
  readonly steps: readonly GuidanceStep[];
}

/** Panel heading. Deliberately about reach, never about sign-in — this is not the reauth flow. */
export const OFFLINE_TITLE = "Can't reach YouTube";

/** One-line plain explanation, shared with the guide. */
export const OFFLINE_EXPLANATION =
  "The app can't reach YouTube. This is usually a firewall or network problem, not a login problem — no reconnect needed.";

export const FIREWALL_GUIDANCE: readonly OsGuidance[] = [
  {
    os: "Windows",
    steps: [
      {
        text: "Allow this app (or node) to make outbound HTTPS on port 443 to *.googleapis.com.",
      },
      {
        text: "Windows Defender Firewall → Allow an app through firewall → add this app, and tick the Private and Public networks it runs on.",
      },
      {
        text: "Behind a corporate proxy or VPN? Confirm it permits *.googleapis.com on 443.",
      },
    ],
  },
  {
    os: "Linux",
    steps: [
      {
        text: "Allow outbound HTTPS on port 443 to *.googleapis.com for the app / node.",
      },
      {
        text: "ufw — allow outbound 443:",
        command: "sudo ufw allow out 443/tcp",
      },
      {
        text: "firewalld — allow outbound HTTPS, then reload:",
        command:
          "sudo firewall-cmd --permanent --add-service=https && sudo firewall-cmd --reload",
      },
    ],
  },
];
