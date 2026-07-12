/**
 * Shared nav for the operator manual.
 *
 * PAGES is the single source of truth for three things that would otherwise drift apart: the
 * sidebar, the prev/next pager, and the redirect that keeps the old single-page deep links
 * (`/guide#companion-actions`) working now that the guide is split. A section can be moved to a
 * different page by editing one line here — its bookmark follows it.
 *
 * No build step, no imports: this file is loaded with a plain <script src> from every page.
 */
(function () {
  "use strict";

  var PAGES = [
    {
      file: "index.html",
      group: "Ground",
      title: "How it works",
      sections: [["overview", "How it works"]],
    },
    {
      file: "setup.html",
      group: "Ground",
      title: "Install & run",
      sections: [
        ["setup", "Install & run"],
        ["auth", "No login (LAN-trust)"],
      ],
    },
    {
      file: "dashboard.html",
      group: "Dashboard",
      title: "The web interface",
      sections: [
        ["web", "The web interface"],
        ["templates", "Templates & fallback"],
      ],
    },
    {
      file: "api.html",
      group: "API",
      title: "HTTP API",
      sections: [
        ["action", "Action endpoints"],
        ["feedback", "Feedback endpoints"],
        ["dashboard-api", "Dashboard endpoints"],
        ["errors", "Error codes"],
      ],
    },
    {
      file: "companion.html",
      group: "Companion module",
      title: "Companion module",
      sections: [
        ["companion-conn", "Install & connect"],
        ["companion-presets", "Presets (drag-drop)"],
        ["companion-actions", "Every action"],
        ["companion-feedback", "State on the keys"],
        ["arabic", "Arabic titles on a key"],
      ],
    },
    {
      file: "fill-flow.html",
      group: "Companion module",
      title: "Redirect / fill flow",
      sections: [["companion-redirect", "Redirect / fill flow"]],
    },
  ];

  var current =
    location.pathname.split("/").pop() || "index.html";
  var currentPage =
    PAGES.filter(function (p) {
      return p.file === current;
    })[0] || PAGES[0];

  /** The page that owns an anchor, or null if no page does. */
  function ownerOf(anchor) {
    for (var i = 0; i < PAGES.length; i++) {
      for (var j = 0; j < PAGES[i].sections.length; j++) {
        if (PAGES[i].sections[j][0] === anchor) return PAGES[i];
      }
    }
    return null;
  }

  /**
   * A deep link from before the split — or a cross-page `#anchor` in the prose — lands on a page
   * that has no such element. Send it to the page that does, hash intact, so the bookmark still
   * scrolls to the right place.
   */
  function followAnchor() {
    var anchor = location.hash.slice(1);
    if (!anchor || document.getElementById(anchor)) return;
    var owner = ownerOf(anchor);
    if (owner && owner.file !== current) {
      location.replace("./" + owner.file + "#" + anchor);
    }
  }
  followAnchor();
  window.addEventListener("hashchange", followAnchor);

  // --- Sidebar -------------------------------------------------------------
  // Every page is listed, grouped as before. The current page expands into its sections, so the
  // nav reads like the old single-page table of contents rather than a bare list of files.
  var nav = document.querySelector("nav.toc");
  if (!nav) return;

  var group = null;
  PAGES.forEach(function (page) {
    if (page.group !== group) {
      group = page.group;
      var g = document.createElement("div");
      g.className = "grp";
      g.textContent = group;
      nav.appendChild(g);
    }
    var isCurrent = page.file === currentPage.file;
    if (!isCurrent) {
      var a = document.createElement("a");
      a.href = "./" + page.file;
      a.textContent = page.title;
      nav.appendChild(a);
      return;
    }
    page.sections.forEach(function (s) {
      var link = document.createElement("a");
      link.href = "#" + s[0];
      link.textContent = s[1];
      link.dataset.section = s[0];
      nav.appendChild(link);
    });
  });

  // --- Pager ---------------------------------------------------------------
  var index = PAGES.indexOf(currentPage);
  var pager = document.createElement("nav");
  pager.className = "pager";
  [
    [PAGES[index - 1], "← "],
    [PAGES[index + 1], "→ "],
  ].forEach(function (pair, i) {
    var page = pair[0];
    if (!page) return;
    var a = document.createElement("a");
    a.href = "./" + page.file;
    a.textContent = i === 0 ? "← " + page.title : page.title + " →";
    a.className = i === 0 ? "pager__prev" : "pager__next";
    pager.appendChild(a);
  });
  var main = document.querySelector("main");
  var foot = main && main.querySelector("footer");
  if (foot) main.insertBefore(pager, foot);

  // --- Highlight the section in view ---------------------------------------
  var links = [].slice.call(nav.querySelectorAll("a[data-section]"));
  var map = {};
  links.forEach(function (a) {
    map[a.dataset.section] = a;
  });
  var obs = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.remove("on");
        });
        if (map[e.target.id]) map[e.target.id].classList.add("on");
      });
    },
    { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
  );
  document.querySelectorAll("main section[id]").forEach(function (s) {
    obs.observe(s);
  });
})();
