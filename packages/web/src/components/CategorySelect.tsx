import type { Category } from "../api.js";

interface Props {
  id: string;
  value: string | null;
  categories: Category[];
  onChange: (value: string | null) => void;
  /** Label for the empty option (semantics differ for presets vs. app defaults). */
  blankLabel?: string;
}

/**
 * Category dropdown backed by YouTube's assignable category list. An empty selection maps
 * to null — for presets that means "inherit the app default", for the defaults panel it
 * means "leave the broadcast's category untouched".
 */
export function CategorySelect({ id, value, categories, onChange, blankLabel = "— inherit default —" }: Props) {
  // If a saved value isn't in the fetched list (region change, stale id), keep it visible.
  const known = value === null || categories.some((c) => c.id === value);

  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{blankLabel}</option>
      {!known && value ? <option value={value}>{`id ${value} (not in region list)`}</option> : null}
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title} · {c.id}
        </option>
      ))}
    </select>
  );
}
