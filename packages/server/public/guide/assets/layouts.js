/**
 * Interactive Stream Deck layouts (PRD-08 §3, issue 037).
 *
 * Draws suggested key arrangements as *working* button faces and lets the reader flip the state
 * behind them — go live, degrade, go offline, get busy — so they can see how a layout reacts before
 * they own a single key.
 *
 * Two rules this file lives by:
 *
 *   1. **Mock data only. Never an API call.** No request, no socket, no event stream — on purpose:
 *      the manual is read far more often than the app is used, and a page that polled a real server
 *      would burn YouTube quota to draw a picture. `mock` below is the entire world these widgets
 *      can see, and the test enforces that no network primitive is even named in this file.
 *   2. **The colours and words are the product's, not this page's.** The values are mirrored by hand
 *      from the Companion module (`companion-module/src/transform.js` HEALTH_COLORS, the feedback
 *      `defaultStyle`s in `main.js`) and the canonical glossary (`@app/shared`), which this static
 *      page cannot import at runtime. `scripts/guide-layouts.test.mjs` imports both for real and
 *      fails if what renders here drifts off them.
 *
 * No build step, no imports: loaded with a plain <script src> from layouts.html.
 */
(function () {
  "use strict";

  /** Pack an r,g,b triple the way Companion's `combineRgb` does — kept for one-to-one comparison. */
  function rgb(r, g, b) {
    return "rgb(" + r + ", " + g + ", " + b + ")";
  }

  // --- Canonical colours (mirrored from the Companion module) ---------------
  var HEALTH_COLOR = {
    ok: rgb(0, 140, 0), //        green
    degraded: rgb(200, 120, 0), // amber
    offline: rgb(90, 98, 112), //  slate grey — issue 017's canonical offline colour
    auth_error: rgb(200, 0, 0), // red
  };
  var LIVE_RED = rgb(200, 0, 0); //     on_air feedback
  var BUSY_BLUE = rgb(0, 80, 200); //   busy feedback
  var ACTIVE_GREEN = rgb(0, 140, 0); // active_preset feedback
  var OFF_GREY = rgb(120, 120, 120); // api_disabled feedback
  var IDLE_KEY = rgb(30, 33, 40); //    a preset key at rest
  var UTIL_KEY = rgb(40, 60, 80); //    the refresh keys
  var UNDO_KEY = rgb(120, 80, 0);
  var PRIVACY_KEY = rgb(60, 60, 70);
  var TALLY_KEY = rgb(40, 40, 40); //   the on-air indicator, dark until it isn't
  var WHITE = rgb(255, 255, 255);

  // --- Canonical words (mirrored from @app/shared glossary) ------------------
  var HEALTH_LABEL = {
    ok: "Healthy",
    degraded: "Degraded",
    offline: "Offline",
    auth_error: "Auth error",
  };
  var BROADCAST_LABEL = { live: "On Air", idle: "Idle" };

  /** The one and only source these widgets read. Nothing here ever came off a network. */
  var mock = {
    isLive: false,
    health: "ok",
    busy: false,
    apiEnabled: true,
    activePresetId: null,
  };

  /** The mock channel's presets — the same shape the dashboard stores, minus everything unused. */
  var PRESETS = [
    { id: "jumuah", slug: "JUMUAH", title: "Friday sermon" },
    { id: "tarawih", slug: "TARAWIH", title: "Tarawih prayer" },
    { id: "lesson", slug: "LESSON", title: "Evening lesson" },
    { id: "quran", slug: "QURAN", title: "Quran recitation" },
  ];

  var LAYOUTS = [
    {
      id: "preset-wall",
      name: "Preset wall",
      cols: 4,
      blurb:
        "The everyday page: one key per preset on the top row, state and the two safety keys underneath. The operator never leaves this page during a service.",
      keys: [
        { kind: "preset", id: "jumuah" },
        { kind: "preset", id: "tarawih" },
        { kind: "preset", id: "lesson" },
        { kind: "preset", id: "quran" },
        { kind: "on_air" },
        { kind: "busy" },
        { kind: "undo" },
        { kind: "health" },
      ],
    },
    {
      id: "single-service",
      name: "One-service page",
      cols: 3,
      blurb:
        "A page per service, for a volunteer who runs one thing. The Arabic title image sits next to the one preset they ever press; privacy and undo are the only other keys.",
      keys: [
        { kind: "title_image" },
        { kind: "preset", id: "jumuah" },
        { kind: "privacy" },
        { kind: "on_air" },
        { kind: "undo" },
        { kind: "health" },
      ],
    },
    {
      id: "tech-desk",
      name: "Tech desk",
      cols: 4,
      blurb:
        "For whoever debugs it when YouTube misbehaves: both refreshes kept apart by name, the API kill switch, and the health lamp given a key of its own.",
      keys: [
        { kind: "preset", id: "jumuah" },
        { kind: "preset", id: "quran" },
        { kind: "refresh_state" },
        { kind: "refresh_lists" },
        { kind: "on_air" },
        { kind: "busy" },
        { kind: "api" },
        { kind: "health" },
      ],
    },
  ];

  /** Resolve a key spec against the mock state into the face Companion would draw. */
  function face(spec) {
    switch (spec.kind) {
      case "preset": {
        var preset = PRESETS.filter(function (p) {
          return p.id === spec.id;
        })[0];
        var active = mock.activePresetId === spec.id;
        return {
          key: spec.id,
          bg: active ? ACTIVE_GREEN : IDLE_KEY,
          lines: [preset.slug, active ? "· active ·" : preset.title],
          hint: "Apply preset — " + preset.title,
          press: true,
        };
      }
      case "on_air":
        return {
          key: "on_air",
          bg: mock.isLive ? LIVE_RED : TALLY_KEY,
          lines: [mock.isLive ? BROADCAST_LABEL.live : BROADCAST_LABEL.idle, "Khutbah al-Jumuah"],
          hint: "On-air indicator (no action)",
        };
      case "busy":
        return {
          key: "busy",
          bg: mock.busy ? BUSY_BLUE : rgb(0, 0, 0),
          lines: [mock.busy ? "Working…" : "Ready", "busy"],
          hint: "Busy while the middleware applies a change",
        };
      case "health":
        return {
          key: "health",
          bg: HEALTH_COLOR[mock.health],
          lines: [HEALTH_LABEL[mock.health], "health"],
          hint: "Health lamp — recolours itself from the app's health state",
        };
      case "privacy":
        return {
          key: "privacy",
          bg: PRIVACY_KEY,
          lines: ["Privacy", mock.isLive ? "public" : "private"],
          hint: "Toggle privacy",
        };
      case "undo":
        return { key: "undo", bg: UNDO_KEY, lines: ["Undo", "last change"], hint: "Undo last change" };
      case "refresh_state":
        return {
          key: "refresh_state",
          bg: UTIL_KEY,
          lines: ["Refresh", "from YouTube"],
          hint: "Refresh from YouTube — re-reads the broadcast",
        };
      case "refresh_lists":
        return {
          key: "refresh_lists",
          bg: UTIL_KEY,
          lines: ["Refresh", "lists"],
          hint: "Refresh lists — re-pulls presets, categories, streams",
        };
      case "api":
        return {
          key: "api",
          bg: mock.apiEnabled ? rgb(90, 40, 40) : OFF_GREY,
          lines: ["API", mock.apiEnabled ? "on" : "off"],
          hint: "API kill switch",
        };
      case "title_image":
        return {
          key: "title_image",
          bg: rgb(20, 22, 27),
          lines: ["خطبة الجمعة", "title image"],
          hint: "Arabic-safe title, drawn as a PNG by the middleware",
        };
      default:
        return { key: spec.kind, bg: IDLE_KEY, lines: [spec.kind, ""], hint: "" };
    }
  }

  // --- Render ---------------------------------------------------------------
  var mounts = [].slice.call(document.querySelectorAll("[data-deck]"));
  if (!mounts.length) return;

  /** Build the (static) DOM once; paint() then only writes colours and text into it. */
  function build() {
    mounts.forEach(function (mount) {
      var layout = LAYOUTS.filter(function (l) {
        return l.id === mount.getAttribute("data-deck");
      })[0];
      if (!layout) return;

      var head = document.createElement("div");
      head.className = "deck-head";
      var h = document.createElement("h4");
      h.textContent = layout.name;
      var p = document.createElement("p");
      p.textContent = layout.blurb;
      head.appendChild(h);
      head.appendChild(p);
      mount.appendChild(head);

      var deck = document.createElement("div");
      deck.className = "deck deck--sim";
      deck.setAttribute("data-layout", layout.id);
      deck.style.gridTemplateColumns = "repeat(" + layout.cols + ", 1fr)";
      deck.setAttribute("aria-label", layout.name + " — mock Stream Deck layout");

      layout.keys.forEach(function (spec) {
        var f = face(spec);
        var el = document.createElement(f.press ? "button" : "div");
        el.className = "key key--sim";
        el.setAttribute("data-key", f.key);
        el.setAttribute("data-kind", spec.kind);
        el.title = f.hint;
        if (f.press) {
          el.type = "button";
          el.addEventListener("click", function () {
            // Pressing a preset key in Companion applies it; here it just moves the mock's
            // active preset, which is what the highlight feedback keys off.
            mock.activePresetId = mock.activePresetId === spec.id ? null : spec.id;
            paint();
          });
        }
        var top = document.createElement("span");
        top.className = "key__text";
        var bottom = document.createElement("span");
        bottom.className = "key__sub";
        el.appendChild(top);
        el.appendChild(bottom);
        deck.appendChild(el);
      });
      mount.appendChild(deck);
    });
  }

  /** Repaint every key from the current mock state. The whole interaction is this function. */
  function paint() {
    mounts.forEach(function (mount) {
      var layout = LAYOUTS.filter(function (l) {
        return l.id === mount.getAttribute("data-deck");
      })[0];
      if (!layout) return;
      var keys = [].slice.call(mount.querySelectorAll(".key--sim"));
      layout.keys.forEach(function (spec, i) {
        var el = keys[i];
        if (!el) return;
        var f = face(spec);
        // The base `.key` rule paints a gradient; a bare background-color would sit behind it.
        el.style.backgroundImage = "none";
        el.style.backgroundColor = f.bg;
        el.style.color = WHITE;
        el.querySelector(".key__text").textContent = f.lines[0];
        el.querySelector(".key__sub").textContent = f.lines[1];
      });
    });

    var bar = document.querySelector(".deck-state");
    if (bar) {
      var broadcast = mock.isLive ? BROADCAST_LABEL.live : BROADCAST_LABEL.idle;
      bar.textContent =
        broadcast + " · " + HEALTH_LABEL[mock.health] + (mock.busy ? " · Working…" : "");
    }

    [].slice.call(document.querySelectorAll("[data-health]")).forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-health") === mock.health);
    });
    [].slice.call(document.querySelectorAll("[data-toggle]")).forEach(function (b) {
      var which = b.getAttribute("data-toggle");
      var on =
        which === "live" ? mock.isLive : which === "busy" ? mock.busy : !mock.apiEnabled;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  // --- Controls -------------------------------------------------------------
  [].slice.call(document.querySelectorAll("[data-toggle]")).forEach(function (b) {
    b.addEventListener("click", function () {
      var which = b.getAttribute("data-toggle");
      if (which === "live") mock.isLive = !mock.isLive;
      if (which === "busy") mock.busy = !mock.busy;
      if (which === "api") mock.apiEnabled = !mock.apiEnabled;
      paint();
    });
  });
  [].slice.call(document.querySelectorAll("[data-health]")).forEach(function (b) {
    b.addEventListener("click", function () {
      mock.health = b.getAttribute("data-health");
      paint();
    });
  });
  var reset = document.querySelector("[data-reset]");
  if (reset) {
    reset.addEventListener("click", function () {
      mock.isLive = false;
      mock.health = "ok";
      mock.busy = false;
      mock.apiEnabled = true;
      mock.activePresetId = null;
      paint();
    });
  }

  build();
  paint();
})();
