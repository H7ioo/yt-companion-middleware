import { useState } from "react";
import { subjectOf, type PreparedBroadcast } from "@app/shared";
import { DeleteBroadcastDialog } from "./DeleteBroadcastDialog.js";
import { isoToLocalInput } from "../lib/prepareForm.js";
import { Skeleton } from "./Skeleton.js";

interface Props {
  /** Everything this app has made, newest first — including what has been removed. */
  items: PreparedBroadcast[];
  /**
   * Whether the record has ever been read (issue 073). The panel is invisible when there is
   * nothing to show, and "nothing to show" and "not read yet" look identical from `items` alone
   * — which is how this list used to pop into existence with the page already settled around it.
   */
  record: "loading" | "ready" | "failed";
  /** The link last copied, so only that row's button says "Copied". */
  copiedUrl: string | null;
  onCopy: (url: string) => void;
  /** Deletes it from YouTube. Called only after the operator has answered the question. */
  onDelete: (id: string) => Promise<void>;
}

/**
 * **What this app made, and what became of it** (PRD-16 §5, issue 064).
 *
 * The list is the record, so nothing ever leaves it. A retired broadcast stays exactly where it
 * was with its link struck out and the reason in its own words — a cleanup the operator cannot
 * see afterwards is indistinguishable from a broadcast that went missing, and "where did Friday
 * go?" is the question this feature would otherwise create.
 *
 * Deleting is the one press in this panel that cannot be taken back, and what it breaks is not on
 * the screen: the link is already out there, in a bulletin and three group chats. So the question
 * shows the link itself, struck through — the panel's own loud element, dying. The sibling of the
 * stream-binding confirmation in issue 051, and a confirmation for the same reason: everyone here
 * is trusted, and what is being defended against is a mis-click.
 */
export function PreparedList({ items, record, copiedUrl, onCopy, onDelete }: Props) {
  const [asking, setAsking] = useState<PreparedBroadcast | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) {
    if (record === "loading")
      return (
        <div className="prep__earlier">
          <span className="eyebrow">Made here</span>
          <Skeleton variant="prepared" label="Reading what this app has made…" rows={2} />
        </div>
      );
    if (record === "failed")
      return (
        <p className="prep__cost">
          Could not read what this app has made. The form still works; reload to try again.
        </p>
      );
    return null;
  }

  const confirm = async (record: PreparedBroadcast) => {
    setAsking(null);
    setBusyId(record.id);
    try {
      await onDelete(record.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="prep__earlier">
      <span className="eyebrow">Made here</span>
      <ul className="prep__list">
        {items.map((p) => {
          const retired = p.retiredAt !== null;
          const aired = p.airedAt !== null;
          return (
            <li key={p.id} className={`prep__item${retired ? " prep__item--retired" : ""}`}>
              <span className="prep__item-title">{p.title}</span>
              <span className="prep__item-when">
                {retired
                  ? (p.retiredReason ?? "Removed from YouTube.")
                  : aired
                    ? `Aired ${stamp(p.airedAt)}`
                    : p.scheduledStartTime
                      ? stamp(p.scheduledStartTime)
                      : "no start time"}
              </span>
              {retired ? null : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onCopy(p.watchUrl)}
                >
                  {copiedUrl === p.watchUrl ? "Copied" : "Copy link"}
                </button>
              )}
              {/* Never offered for one that aired: it is a recording people may still be
                  watching, and deleting it takes that away rather than tidying up. The stamp is
                  written by the sweep, so it lags a broadcast that went live minutes ago — the
                  route reads the channel's lifecycle state and refuses that one itself, and this
                  gate only keeps the button off a press already known to be pointless. */}
              {retired || aired ? null : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm prep__item-del"
                  onClick={() => setAsking(p)}
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <DeleteBroadcastDialog
        subject={asking ? subjectOf(asking) : null}
        onCancel={() => setAsking(null)}
        onConfirm={() => void confirm(asking!)}
      />
    </div>
  );
}

/** The operator's own clock, in the shape the panel's other timestamps use. */
function stamp(iso: string | null): string {
  return iso ? isoToLocalInput(iso).replace("T", ", ") : "";
}
