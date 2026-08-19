import { useEffect, useState } from "react";
import { api, type BroadcastCandidate, type TargetPin } from "../api.js";

interface Props {
  pin: TargetPin | null;
  /**
   * The YouTube API master switch. Reading the candidate list is a live call, and the switch's
   * whole promise is that a paused install spends no quota — so while it is off the picker shows
   * the pin it already knows about and asks for nothing.
   */
  apiEnabled: boolean;
  /** Refetches dashboard state so the rail's Target readout follows the change immediately. */
  onChanged: () => void;
}

/**
 * Picks the broadcast every action writes to.
 *
 * Presented as a patch bay rather than a dropdown, deliberately: the reason this control exists
 * is that the app cannot tell two similarly-named broadcasts apart, and neither can the operator
 * from the title alone. A collapsed `<select>` would hide the three things that actually
 * discriminate — when it is due, how close to air YouTube considers it, and its id — which is
 * the whole content of the decision. Every candidate stays on screen with its evidence.
 *
 * "Automatic" is a first-class row, not an absent state, so choosing to let the app decide reads
 * as a choice rather than as having failed to pick.
 */
export function TargetPicker({ pin, apiEnabled, onChanged }: Props) {
  const [candidates, setCandidates] = useState<BroadcastCandidate[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      setCandidates(await api.target.candidates());
    } catch (err) {
      // Left null, not emptied: an empty list means "this channel has no broadcasts", which the
      // UI reads as proof a pinned broadcast is gone. A failed read is not evidence of anything.
      setError(
        err instanceof Error
          ? err.message
          : "Could not read the broadcast list.",
      );
    }
  }

  useEffect(() => {
    if (!apiEnabled) return;
    void load();
  }, [apiEnabled]);

  async function choose(candidate: BroadcastCandidate | null) {
    setSaving(true);
    setError(null);
    try {
      await api.target.pin(candidate?.id ?? null, candidate?.title ?? null);
      onChanged();
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the target.",
      );
    } finally {
      setSaving(false);
    }
  }

  const live = candidates?.find((c) => c.isLive) ?? null;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Edit target</h2>
        <div className="panel__head-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void load()}
            disabled={saving || !apiEnabled}
            title={apiEnabled ? undefined : "YouTube API is paused"}
          >
            Reload list
          </button>
        </div>
      </div>
      <div className="panel__body">
        <p className="patch__lede">
          {!apiEnabled
            ? `The YouTube API is paused, so the broadcast list is not being read. ${
                pin
                  ? `Actions will target “${pin.label ?? pin.id}” once you resume.`
                  : "Resume it to choose a target."
              }`
            : live
              ? "You are on air. Actions edit the live broadcast until it ends, whatever is chosen here."
              : "Actions edit this broadcast. Choose it yourself when more than one is waiting and only you can tell them apart."}
        </p>

        {error ? <p className="patch__error">{error}</p> : null}

        {apiEnabled ? (
          <div
            className="patch"
            role="radiogroup"
            aria-label="Broadcast to edit"
          >
            <PatchRow
              selected={pin === null}
              disabled={saving}
              onSelect={() => void choose(null)}
              lamp="lamp--ready"
              title="Choose automatically"
              note="Ranks the waiting broadcasts and edits the one closest to going live."
            />

            {candidates === null ? (
              // Nothing to say while a load is failing — the error above already said it.
              error ? null : (
                <p className="patch__empty">Reading the channel…</p>
              )
            ) : candidates.length === 0 ? (
              <p className="patch__empty">
                No broadcasts on the channel. Create one in YouTube Studio, or
                go live.
              </p>
            ) : (
              candidates.map((c) => (
                <PatchRow
                  key={c.id}
                  selected={pin?.id === c.id}
                  disabled={saving || c.isLive}
                  onSelect={() => void choose(c)}
                  lamp={
                    c.isLive
                      ? "lamp--live"
                      : c.wouldPick
                        ? "lamp--ready"
                        : "lamp--idle"
                  }
                  title={c.title}
                  note={describe(c)}
                  id={c.id}
                />
              ))
            )}
          </div>
        ) : null}

        {apiEnabled &&
        pin &&
        candidates !== null &&
        !candidates.some((c) => c.id === pin.id) ? (
          <p className="patch__error">
            The pinned broadcast “{pin.label ?? pin.id}” is no longer on the
            channel. Pick another, or choose automatically.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface RowProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  lamp: string;
  title: string;
  note: string;
  id?: string;
}

function PatchRow({
  selected,
  disabled,
  onSelect,
  lamp,
  title,
  note,
  id,
}: RowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`patch__row${selected ? " patch__row--on" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={`lamp ${lamp}`} aria-hidden="true" />
      <span className="patch__meta">
        <span className="patch__title">{title}</span>
        <span className="patch__note">{note}</span>
      </span>
      {id ? <span className="patch__id mono">{id}</span> : null}
    </button>
  );
}

/** The evidence that separates one waiting broadcast from another, in one line. */
function describe(c: BroadcastCandidate): string {
  if (c.isLive) return "On air now";
  const parts: string[] = [];
  if (c.scheduledStartTime) parts.push(when(c.scheduledStartTime));
  if (c.lifeCycleStatus)
    parts.push(LIFECYCLE[c.lifeCycleStatus] ?? c.lifeCycleStatus);
  if (c.wouldPick) parts.push("the automatic choice");
  return parts.join(" · ");
}

/** YouTube's lifecycle values, said the way an operator would say them. */
const LIFECYCLE: Record<string, string> = {
  created: "no encoder yet",
  ready: "encoder bound",
  testing: "encoder bound, previewing",
  live: "on air",
};

function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "no start time";
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  if (mins >= -1 && mins <= 1) return "starts about now";
  const rel =
    Math.abs(mins) < 90
      ? `${Math.abs(mins)} min`
      : `${Math.round(Math.abs(mins) / 60)} h`;
  const stamp = at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return mins > 0 ? `in ${rel} · ${stamp}` : `due ${rel} ago · ${stamp}`;
}
