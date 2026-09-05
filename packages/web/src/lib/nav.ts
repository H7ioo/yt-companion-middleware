/**
 * The dashboard's pages, in the order the operator meets them (navbar + pages).
 *
 * One list feeds both the router and the navbar, so a page can never exist without a way in —
 * the failure that turns a route into dead code. The order is the shift itself: what is airing
 * now, the presets a Companion key fires, the broadcast being made for later, everything already
 * on the channel, what has happened, and the wiring that is set once.
 */
export interface NavPage {
  /** Route path. The Live page is the index route and owns "/". */
  path: string;
  /** Tab label. Sentence case, one word where one word will do. */
  label: string;
  /** What the page answers, shown as the tab's tooltip. */
  hint: string;
}

export const NAV_PAGES: NavPage[] = [
  { path: "/", label: "Live", hint: "What is airing, what is arriving, and what the audience sees" },
  { path: "/presets", label: "Presets", hint: "The one-press updates a Companion key fires" },
  { path: "/schedule", label: "Schedule", hint: "Make and schedule the broadcast that airs later" },
  { path: "/broadcasts", label: "Broadcasts", hint: "Every broadcast on the channel, and what can be done to it" },
  { path: "/activity", label: "Activity", hint: "Every action this app has taken, newest first" },
  { path: "/settings", label: "Settings", hint: "Connection, people, defaults and notifications" },
];
