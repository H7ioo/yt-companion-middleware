import { useEffect, useMemo, useState } from "react";
import type {
  Category,
  LiveEligibility,
  Preset,
  PreparedBroadcast,
  PrivacyStatus,
  StreamInfo,
} from "../api.js";
import { api } from "../api.js";
import { StreamSelect } from "./StreamSelect.js";
import { CategorySelect } from "./CategorySelect.js";
import { describePrepareCost, isoToLocalInput, localInputToIso } from "../lib/prepareForm.js";

const PRIVACY: PrivacyStatus[] = ["public", "unlisted", "private"];

interface Props {
  presets: Preset[];
  streams: StreamInfo[];
  categories: Category[];
  /** The YouTube API master switch — creating is two writes, and a paused install spends none. */
  apiEnabled: boolean;
  /** Riding mode disables creation, because YouTube will refuse it (issue 061). */
  eligibility: LiveEligibility | null;
  /** Refetches dashboard state, so the rail follows a broadcast that is now the next to air. */
  onPrepared: () => void;
}

/**
 * **Make tonight's broadcast now, and get the link out** (PRD-16 §2, issue 062).
 *
 * The panel exists for one artifact: the share link. Everything above it is the shortest form
 * that can produce one — a preset, a start time, the key OBS already holds — and the link itself
 * is set as a strip of tape on a cable, because that is what it is used as. It is the first
 * thing the operator copies and the last thing they check.
 *
 * Creating is its own press and never a side effect of applying a preset. A preset writes
 * metadata onto a broadcast that already exists; this puts a public link into the world, which
 * is not a thing to do by accident.
 *
 * The title goes in at creation, not after: a broadcast created blank and corrected seconds later
 * is exactly the "wrong title on air" this project has been chasing since PRD-14.
 */
export function PrepareBroadcast({
  presets,
  streams,
  categories,
  apiEnabled,
  eligibility,
  onPrepared,
}: Props) {
  const [presetId, setPresetId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [privacyStatus, setPrivacy] = useState<PrivacyStatus>("unlisted");
  const [streamId, setStreamId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedBroadcast[]>([]);
  /** The one just created — the panel's whole output, kept apart so it can lead. */
  const [fresh, setFresh] = useState<PreparedBroadcast | null>(null);
  const [copied, setCopied] = useState(false);

  const preset = useMemo(
    () => presets.find((p) => p.id === presetId) ?? null,
    [presets, presetId],
  );
  const riding = eligibility?.mode === "riding";

  useEffect(() => {
    // Free: an ownership record from our own store, not a YouTube read.
    api.broadcasts
      .prepared()
      .then(setPrepared)
      .catch(() => {
        // A list that will not load is not worth a banner over the form that still works.
      });
  }, []);

  // A preset carries its own privacy; following it keeps the form honest about what will be
  // created, and the operator can still override before pressing.
  useEffect(() => {
    if (preset) setPrivacy(preset.privacyStatus);
  }, [preset]);

  const startIso = localInputToIso(startsAt);
  const named = preset ? preset.title : title.trim();
  const ready = apiEnabled && !riding && !busy && startIso !== null && named.length > 0;

  async function create() {
    if (!startIso) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.broadcasts.prepare({
        presetId: preset?.id ?? null,
        ...(preset ? {} : { title: title.trim() }),
        privacyStatus,
        ...(streamId ? { streamId } : {}),
        ...(category === null ? {} : { category }),
        scheduledStartTime: startIso,
      });
      setFresh(result.prepared);
      setCopied(false);
      setPrepared(await api.broadcasts.prepared());
      onPrepared();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the broadcast.");
    } finally {
      setBusy(false);
    }
  }

  function copy(url: string) {
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setError("Could not copy the link — select it and copy by hand."),
    );
  }

  const earlier = prepared.filter((p) => p.id !== fresh?.id);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Prepare a broadcast</h2>
      </div>
      <div className="panel__body">
        <p className="prep__lede">
          {riding
            ? "YouTube will not let this channel create broadcasts, so there is nothing to prepare here. Make the broadcast in YouTube Studio and this app will follow it."
            : !apiEnabled
              ? "The YouTube API is paused. Resume it to create a broadcast."
              : "Creates the broadcast now, with tonight's title already on it, bound to the key OBS already holds. The link is shareable the moment it exists."}
        </p>

        {fresh ? (
          <div className="prep__made">
            <span className="eyebrow">Share this</span>
            <p className="prep__made-title">{fresh.title}</p>
            <div className="prep__link">
              <code className="mono prep__link-url">{fresh.watchUrl}</code>
              <button type="button" className="btn btn--sm" onClick={() => copy(fresh.watchUrl)}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="prep__made-note">
              It starts on its own when OBS starts, and ends when OBS stops.
            </p>
          </div>
        ) : null}

        {error ? <p className="prep__error">{error}</p> : null}

        {riding ? null : (
          <>
            <div className="field--row prep__row">
              <div className="field">
                <label htmlFor="prep-preset">From preset</label>
                <select
                  id="prep-preset"
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">— one-off, title below —</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  {preset
                    ? "The preset's title and description are written at creation."
                    : "Or type a title for a broadcast that is not one of the usual ones."}
                </span>
              </div>

              <div className="field">
                <label htmlFor="prep-title">Title</label>
                <input
                  id="prep-title"
                  value={preset ? preset.title : title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy || preset !== null}
                  placeholder="Friday service"
                />
              </div>
            </div>

            <div className="field--row prep__row">
              <div className="field">
                <label htmlFor="prep-start">Starts</label>
                <input
                  id="prep-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  disabled={busy}
                />
                <span className="hint">Your own clock. Schedule it for tonight or any day ahead.</span>
              </div>

              <div className="field">
                <label htmlFor="prep-privacy">Privacy</label>
                <select
                  id="prep-privacy"
                  value={privacyStatus}
                  onChange={(e) => setPrivacy(e.target.value as PrivacyStatus)}
                  disabled={busy}
                >
                  {PRIVACY.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field--row prep__row">
              <div className="field">
                <label htmlFor="prep-category">Category</label>
                <CategorySelect
                  id="prep-category"
                  value={category}
                  categories={categories}
                  onChange={setCategory}
                  blankLabel="— the preset's, then the app default —"
                />
              </div>

              <div className="field">
                <label htmlFor="prep-stream">Ingestion key</label>
                <StreamSelect
                  id="prep-stream"
                  value={streamId}
                  streams={streams}
                  onChange={setStreamId}
                  blankLabel="— the preset's, then the app default —"
                />
                <span className="hint">The key OBS already holds. Preparing never makes a new one.</span>
              </div>
            </div>

            <div className="prep__go">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void create()}
                disabled={!ready}
              >
                {busy ? "Creating…" : "Create broadcast"}
              </button>
              <span className="prep__cost">{describePrepareCost(category !== null)}</span>
            </div>
          </>
        )}

        {earlier.length > 0 ? (
          <div className="prep__earlier">
            <span className="eyebrow">Made here</span>
            <ul className="prep__list">
              {earlier.map((p) => (
                <li key={p.id} className="prep__item">
                  <span className="prep__item-title">{p.title}</span>
                  <span className="prep__item-when">
                    {p.scheduledStartTime
                      ? isoToLocalInput(p.scheduledStartTime).replace("T", ", ")
                      : "no start time"}
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy(p.watchUrl)}>
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
