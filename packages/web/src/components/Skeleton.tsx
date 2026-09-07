import type { ReactElement } from "react";

/**
 * **A panel that is loading, looking like it is loading** (PRD-16 §9, issue 073).
 *
 * Three rules the shapes here are built around.
 *
 * *First paint only.* A skeleton belongs where a panel has never held data. A refresh keeps the
 * rows that are on screen — replacing good data with grey bars every time the operator presses
 * Refresh is worse than the flash it would prevent, particularly for a list that costs quota to
 * read. So no panel decides to show these from a "loading" flag; it shows them from "nothing has
 * ever arrived here".
 *
 * *The shape is the real shape.* Each variant borrows the real row's own classes — `rundown__row`,
 * `prep__item`, `log-row` — and puts a bar where the text goes. That is not a shortcut: it is what
 * makes the arrival of data a change of content rather than a change of layout, and it keeps the
 * two in step when the real row is restyled later.
 *
 * *One announcement, not one per bar.* The bars are decoration and are hidden from assistive
 * technology outright; the panel says "reading" once, in words, through a live region.
 */
interface Props {
  /** Which real row this stands in for. */
  variant: "rundown" | "prepared" | "feed" | "log" | "cards";
  /** What the panel is waiting for, in the operator's words. Announced once. */
  label: string;
  /** How many rows to stand in. Ignored by the single-reading variants. */
  rows?: number;
}

export function Skeleton({ variant, label, rows = 3 }: Props) {
  return (
    <>
      {/* The whole of what a screen reader gets: the bars below say nothing it could use.
          Announced politely rather than as `role="status"` — a panel's status region is where
          it says what happened (the pin disagrees, the delete cleared the target), and a
          "reading…" that competes for that role is read out instead of the thing that matters. */}
      <p className="sr-only" aria-live="polite">
        {label}
      </p>
      {SHAPES[variant](rows)}
    </>
  );
}

/**
 * A stand-in for a line of text, exactly one line box tall.
 *
 * The height comes from a hidden non-breaking space in CSS rather than from a number, so a bar
 * standing in for the 14px title line and one standing in for the 12.5px facts line each end up
 * the height of the line they replace, and stay that way when the type scale moves.
 */
function Bar({ width, tone }: { width: string; tone?: "title" | "quiet" }) {
  return (
    <span
      className={`skel__bar${tone ? ` skel__bar--${tone}` : ""}`}
      style={{ width }}
    />
  );
}

/** Rows of the broadcast rundown: lamp, title, evidence line. */
function rundown(rows: number) {
  return (
    <ul className="rundown skel" aria-hidden="true">
      {counted(rows).map((i) => (
        <li key={i} className="rundown__row skel__row">
          <span className="lamp lamp--idle" />
          <span className="rundown__meta">
            <span className="rundown__head">
              <Bar width={`${58 + ((i * 13) % 26)}%`} tone="title" />
            </span>
            <span className="rundown__facts">
              <Bar width="82%" tone="quiet" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Rows of the "Made here" record: title, then the stamp at the right edge. */
function prepared(rows: number) {
  return (
    <ul className="prep__list skel" aria-hidden="true">
      {counted(rows).map((i) => (
        <li key={i} className="prep__item skel__row">
          <Bar width={`${44 + ((i * 17) % 22)}%`} />
          <span className="prep__item-when">
            <Bar width="96px" tone="quiet" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The single ingestion reading: lamp, state, meaning, stamp. */
function feed(_rows: number) {
  return (
    <div className="feed skel" aria-hidden="true">
      <span className="lamp feed__lamp lamp--idle" />
      <div className="feed__meta skel__row">
        <p className="feed__state">
          <Bar width="180px" tone="title" />
        </p>
        <p className="feed__note">
          <Bar width="260px" tone="quiet" />
        </p>
        <p className="feed__stamp">
          <Bar width="150px" tone="quiet" />
        </p>
      </div>
    </div>
  );
}

/** Rows of the activity feed: dot, time, category, message. */
function log(rows: number) {
  return (
    <ul className="log skel" aria-hidden="true">
      {counted(rows).map((i) => (
        <li key={i} className="log-row skel__row">
          <span className="lamp log-dot lamp--idle" />
          <span className="log-time">
            <Bar width="58px" tone="quiet" />
          </span>
          <span className="log-cat">
            <Bar width="44px" tone="quiet" />
          </span>
          <span className="log-msg">
            <Bar width={`${52 + ((i * 19) % 34)}%`} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Preset cards: title, the two copyable strings, the row of controls. */
function cards(rows: number) {
  return (
    <div className="preset-grid skel" aria-hidden="true">
      {counted(rows).map((i) => (
        <article key={i} className="card skel__row">
          <div className="card__title">
            <Bar width={`${56 + ((i * 15) % 30)}%`} tone="title" />
          </div>
          <div className="card__meta">
            <Bar width="70px" tone="quiet" />
            <Bar width="110px" tone="quiet" />
          </div>
          <div className="mapping">
            <Bar width="100%" tone="quiet" />
          </div>
          <div className="card__actions">
            <Bar width="88px" />
          </div>
        </article>
      ))}
    </div>
  );
}

const SHAPES: Record<Props["variant"], (rows: number) => ReactElement> = {
  rundown,
  prepared,
  feed,
  log,
  cards,
};

function counted(rows: number): number[] {
  return Array.from({ length: Math.max(1, rows) }, (_, i) => i);
}
