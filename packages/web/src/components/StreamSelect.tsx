import type { StreamInfo } from "../api.js";
import { isStaleBinding, streamOptionLabel } from "../lib/streamBinding.js";

interface Props {
  id: string;
  value: string | null;
  streams: StreamInfo[];
  onChange: (value: string | null) => void;
  /** Label for the empty option — shows the resolved default so operators know what they inherit. */
  blankLabel?: string;
}

/**
 * Stream-binding dropdown backed by the channel's live streams. An empty selection maps to
 * null ("inherit the app default"). A saved id that isn't in the fetched list (stale/deleted
 * key) is kept visible as its own option so the operator can see — and clear — the bad binding.
 */
export function StreamSelect({ id, value, streams, onChange, blankLabel = "— inherit default —" }: Props) {
  const stale = isStaleBinding(value, streams);

  return (
    <select
      id={id}
      value={value ?? ""}
      aria-invalid={stale}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{blankLabel}</option>
      {stale && value ? <option value={value}>{`id ${value} (not a live stream)`}</option> : null}
      {streams.map((s) => (
        <option key={s.id} value={s.id}>
          {streamOptionLabel(s)}
        </option>
      ))}
    </select>
  );
}
