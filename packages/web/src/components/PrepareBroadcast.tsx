import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
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
import { PreparedList } from "./PreparedList.js";
import { ApiError } from "../api.js";
import { CategorySelect } from "./CategorySelect.js";
import { describePrepareCost, isoToLocalInput, localInputToIso } from "../lib/prepareForm.js";
import { bindingLabel } from "../lib/streamBinding.js";
import { extractVars, resolvePresetText } from "../lib/template.js";

const PRIVACY: PrivacyStatus[] = ["public", "unlisted", "private"];

interface Props {
  presets: Preset[];
  streams: StreamInfo[];
  categories: Category[];
  /** The YouTube API master switch — creating is two writes, and a paused install spends none. */
  apiEnabled: boolean;
  /** Riding mode disables creation, because YouTube will refuse it (issue 061). */
  eligibility: LiveEligibility | null;
  /**
   * The app default category, so the cost line can say what the preparation will actually spend:
   * a category the operator never picked here still costs the read and the write that set it.
   */
  defaultCategory: string | null;
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
  defaultCategory,
  onPrepared,
}: Props) {
  const [presetId, setPresetId] = useState<string>("");
  const [title, setTitle] = useState("");
  // Public, matching the server's own fallback (issue 074). The channel exists to broadcast
  // publicly; a default of `unlisted` is the one that goes wrong without anyone noticing.
  const [privacyStatus, setPrivacy] = useState<PrivacyStatus>("public");
  const [streamId, setStreamId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedBroadcast[]>([]);
  /** The one just created — the panel's whole output, kept apart so it can lead. */
  const [fresh, setFresh] = useState<PreparedBroadcast | null>(null);
  /** What the broadcast is missing when only part of the preparation landed. */
  const [warning, setWarning] = useState<string | null>(null);
  /** The link last copied, not a bare flag: two Copy buttons must not both say "Copied". */
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  /** Values for a templated preset's `{name}` variables, exactly as the fill popup collects them. */
  const [vars, setVars] = useState<Record<string, string>>({});
  /**
   * The channel is too full for another broadcast (issue 064). Held apart from the error text
   * because it is the one refusal here the operator can fix with a press rather than a decision.
   */
  const [channelFull, setChannelFull] = useState(false);

  const preset = useMemo(
    () => presets.find((p) => p.id === presetId) ?? null,
    [presets, presetId],
  );
  const riding = eligibility?.mode === "riding";

  // A templated preset is prepared with the same variables the apply path takes. Without them the
  // insert either refuses (MISSING_TEMPLATE_VARS) or creates the broadcast under the preset's
  // fallback text — neither is what the operator read on the button.
  const varFields = useMemo(() => (preset ? extractVars(preset) : []), [preset]);
  const resolved = useMemo(
    () => (preset ? resolvePresetText(preset, vars) : null),
    [preset, vars],
  );

  // Variables belong to the preset that declared them; carrying values across a change would
  // send a value for a name the new preset does not have.
  useEffect(() => {
    setVars({});
  }, [presetId]);

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
  // created, and the operator can still override before pressing. Clearing the preset returns
  // the field to the app default, so a preset's unlisted does not linger on a free-form
  // broadcast the operator meant to be public.
  useEffect(() => {
    setPrivacy(preset ? preset.privacyStatus : "public");
  }, [preset]);

  const startIso = localInputToIso(startsAt);
  const named = preset ? (resolved?.title ?? "") : title.trim();
  const ready =
    apiEnabled &&
    !riding &&
    !busy &&
    startIso !== null &&
    named.length > 0 &&
    (resolved?.missing.length ?? 0) === 0;

  /**
   * What the broadcast will actually be filed under — the form's own pick, then the preset's,
   * then the app default. The cost line reads this rather than the field, because an inherited
   * category costs the same read and write as a chosen one.
   */
  const effectiveCategory = category ?? preset?.category ?? defaultCategory;

  async function create() {
    if (!startIso) return;
    setBusy(true);
    setError(null);
    // Blanks are left out so the server applies the inline default or the field's fallback,
    // exactly as the fill popup does.
    const sending = Object.fromEntries(Object.entries(vars).filter(([, v]) => v.trim() !== ""));

    let result: Awaited<ReturnType<typeof api.broadcasts.prepare>>;
    try {
      result = await api.broadcasts.prepare({
        presetId: preset?.id ?? null,
        ...(preset ? {} : { title: title.trim() }),
        ...(preset && Object.keys(sending).length > 0 ? { vars: sending } : {}),
        privacyStatus,
        ...(streamId ? { streamId } : {}),
        ...(category === null ? {} : { category }),
        scheduledStartTime: startIso,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the broadcast.");
      setChannelFull(err instanceof ApiError && err.code === "BROADCAST_LIMIT_REACHED");
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }

    // Past this line the broadcast exists. Nothing below may be reported as "could not create":
    // a refresh that fails is a stale list, not a broadcast that was never made.
    setFresh(result.prepared);
    setWarning(result.warning);
    setChannelFull(false);
    setCopiedUrl(null);
    await reload();
  }

  /** Removes one, after the list has asked the question. */
  async function remove(id: string) {
    try {
      await api.broadcasts.deletePrepared(id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the broadcast.");
    }
    await reload();
  }

  /** Clears the ghosts on the operator's press — the answer to a channel that is too full. */
  async function clearOld() {
    setBusy(true);
    try {
      const { retired } = await api.broadcasts.retire();
      setError(
        retired.length === 0
          ? "Nothing here was old enough to remove. The broadcasts filling the channel were not made by this app — delete them in YouTube Studio."
          : null,
      );
      setChannelFull(retired.length === 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the old broadcasts.");
    } finally {
      setBusy(false);
    }
    await reload();
  }

  async function reload() {
    try {
      setPrepared(await api.broadcasts.prepared());
    } catch {
      // A list that will not reload does not change what is on the channel.
    }
    onPrepared();
  }

  function copy(url: string) {
    void navigator.clipboard.writeText(url).then(
      () => setCopiedUrl(url),
      () => setError("Could not copy the link — select it and copy by hand."),
    );
  }

  // The one just made is in this list too, not filtered out of it. The strip above is the
  // artifact — the link to hand out — and the list is the record of what exists on the channel;
  // the row is where a preparation made with the wrong title is deleted, which is the likeliest
  // deletion there is (issue 064).

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
                {copiedUrl === fresh.watchUrl ? "Copied" : "Copy link"}
              </button>
            </div>
            {/* A half-finished preparation is the headline and replaces the details outright —
                a tidy summary sitting beside "the key never bound" reads as if all is well. */}
            {warning ? (
              <p className="prep__warning">{warning}</p>
            ) : (
              <dl className="prep__made-details" data-testid="prep-made-details">
                <div>
                  <dt>Starts</dt>
                  <dd>{stamp(fresh.scheduledStartTime)}</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>{fresh.privacyStatus ?? "as YouTube left it"}</dd>
                </div>
                <div>
                  <dt>Key</dt>
                  <dd>{bindingLabel(fresh.streamId, streams)}</dd>
                </div>
              </dl>
            )}
            {/* Where the broadcast lives from here (issue 069). This panel makes one and stops;
                retiming, retitling and deleting are the collection's page, not this form's. */}
            <p className="prep__made-note">
              Find it on <Link to="/broadcasts">Broadcasts</Link> to change or remove it.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="prep__error">
            <p>{error}</p>
            {channelFull ? (
              <button type="button" className="btn btn--sm" onClick={() => void clearOld()} disabled={busy}>
                {busy ? "Clearing…" : "Clear old broadcasts"}
              </button>
            ) : null}
          </div>
        ) : null}

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
                  // The preset's title *as it will be created* — the raw `{topic}` template is
                  // not what goes on air, and showing it here is how a broadcast gets named
                  // after a placeholder.
                  value={preset ? (resolved?.title ?? "") : title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy || preset !== null}
                  placeholder="Friday service"
                />
              </div>
            </div>

            {varFields.length > 0 ? (
              <div className="field--row prep__row prep__vars">
                {varFields.map((v) => (
                  <div className="field" key={v.name}>
                    <label htmlFor={`prep-var-${v.name}`}>{v.name}</label>
                    <input
                      id={`prep-var-${v.name}`}
                      value={vars[v.name] ?? ""}
                      placeholder={
                        v.default != null ? v.default : v.required ? "required" : "leave blank for fallback"
                      }
                      aria-invalid={v.required && (vars[v.name] ?? "").trim() === ""}
                      disabled={busy}
                      onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ) : null}

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

            {/* The most consequential thing about the broadcast being made, said before it is
                made rather than only in the receipt afterwards (issue 074). */}
            <p className="prep__terms">
              It starts when OBS starts, and ends when OBS stops. Nothing else has to be pressed.
            </p>

            <div className="prep__go">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void create()}
                disabled={!ready}
              >
                {busy ? "Creating…" : "Create broadcast"}
              </button>
              <span className="prep__cost">{describePrepareCost(effectiveCategory !== null)}</span>
            </div>
          </>
        )}

        <PreparedList
          items={prepared}
          copiedUrl={copiedUrl}
          onCopy={copy}
          onDelete={remove}
        />
      </div>
    </section>
  );
}

/** The operator's own clock, in the shape the panel's other timestamps use. */
function stamp(iso: string | null): string {
  return iso ? isoToLocalInput(iso).replace("T", ", ") : "no start time";
}
