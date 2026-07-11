import { useEffect, useMemo, useState } from "react";
import { api, type LogEntry, type LogCategory } from "../api.js";

/** Poll cadence for the activity feed — brisk enough to feel live, cheap on a LAN box. */
const POLL_MS = 4000;

const CATEGORY_LABEL: Record<LogCategory, string> = {
  auth: "Auth",
  network: "Network",
  quota: "Quota",
  action: "Action",
  system: "System",
};

// Auth and network failures have a fix; point the operator at the manual for the steps.
const GUIDED: ReadonlySet<LogCategory> = new Set<LogCategory>(["auth", "network"]);

type Filter = LogCategory | "all";

function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toLocaleTimeString();
}

export function ActivityPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = () =>
      api
        .logs()
        .then((rows) => {
          if (!active) return;
          setEntries(rows);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Only offer filter chips for categories that actually appear, so the control never lies.
  const present = useMemo(() => {
    const seen = new Set<LogCategory>();
    for (const e of entries) seen.add(e.category);
    return (["auth", "network", "quota", "action", "system"] as LogCategory[]).filter((c) =>
      seen.has(c),
    );
  }, [entries]);

  const shown = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Activity</h2>
        <div className="panel__head-actions log-filters" role="group" aria-label="Filter activity by category">
          <button
            type="button"
            className={`chip ${filter === "all" ? "chip--on" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {present.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${filter === c ? "chip--on" : ""}`}
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="panel__body">
        {failed && entries.length === 0 ? (
          <p className="empty" style={{ marginTop: 0 }}>
            Couldn’t reach the activity feed. It’ll reappear once the connection is back.
          </p>
        ) : shown.length === 0 ? (
          <p className="empty" style={{ marginTop: 0 }}>
            {entries.length === 0
              ? "Nothing yet. Auth, network, quota and action events will show up here."
              : "No events in this category."}
          </p>
        ) : (
          <ul className="log">
            {shown.map((e, i) => (
              <li key={`${e.ts}-${i}`} className={`log-row log-row--${e.level}`}>
                <span className={`lamp log-dot log-dot--${e.level}`} aria-hidden="true" />
                <time className="log-time mono" dateTime={e.ts}>
                  {timeOf(e.ts)}
                </time>
                <span className={`log-cat log-cat--${e.category}`}>{CATEGORY_LABEL[e.category]}</span>
                <span className="log-msg" dir="auto">
                  {e.message}
                  {GUIDED.has(e.category) ? (
                    <a className="log-fix" href="/guide" target="_blank" rel="noreferrer">
                      How to fix →
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
