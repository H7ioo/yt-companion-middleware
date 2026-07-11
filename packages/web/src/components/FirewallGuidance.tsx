import { useState } from "react";
import { api, type DashboardState } from "../api.js";
import {
  FIREWALL_GUIDANCE,
  OFFLINE_EXPLANATION,
  OFFLINE_TITLE,
} from "../lib/firewallGuidance.js";

interface Props {
  /** Apply freshly-fetched state so health re-evaluates; a restored link unmounts this panel. */
  applyState: (state: DashboardState) => void;
  flash: (message: string, kind?: "ok" | "err") => void;
}

/**
 * Firewall-guidance panel (PRD-06 §2, issue 019). Rendered only when `health === "offline"`: the
 * app can't reach YouTube at the network layer (firewall / DNS / no internet), which is *not* an
 * auth problem. Unlike {@link ReauthBanner} it never offers Reconnect — instead it explains the
 * network cause, lists OS-specific fix steps for Windows and Linux, and offers a "Test again"
 * button that forces a live refresh and re-evaluates health. If the link is back, the refreshed
 * state flips health away from `offline` and this panel unmounts.
 */
export function FirewallGuidance({ applyState, flash }: Props) {
  const [busy, setBusy] = useState(false);

  const testAgain = async () => {
    setBusy(true);
    try {
      const r = await api.action.refresh();
      applyState(r);
      if (r.success && r.health !== "offline") {
        flash("Reached YouTube — connection restored");
      } else {
        flash("Still can't reach YouTube. Work through the firewall steps below.", "err");
      }
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = (command: string) => {
    void navigator.clipboard
      .writeText(command)
      .then(() => flash("Command copied"));
  };

  return (
    <section id="firewall" className="firewall" role="alert" aria-labelledby="firewall-title">
      <div className="firewall__head">
        <span className="firewall__lamp" aria-hidden="true" />
        <div className="firewall__meta">
          <span className="eyebrow">Network</span>
          <h2 id="firewall-title" className="firewall__title">
            {OFFLINE_TITLE}
          </h2>
          <p className="firewall__note">{OFFLINE_EXPLANATION}</p>
        </div>
        <button
          className="btn btn--sm firewall__action"
          type="button"
          onClick={testAgain}
          disabled={busy}
        >
          {busy ? "Testing…" : "Test again"}
        </button>
      </div>

      <div className="firewall__grid">
        {FIREWALL_GUIDANCE.map((guide) => (
          <div className="firewall__os" key={guide.os}>
            <span className="firewall__os-name">{guide.os}</span>
            <ol className="firewall__steps">
              {guide.steps.map((step, i) => (
                <li key={i} className="firewall__step">
                  <span dir="auto">{step.text}</span>
                  {step.command ? (
                    <span className="firewall__cmd">
                      <code>{step.command}</code>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => copyCommand(step.command!)}
                      >
                        Copy
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
