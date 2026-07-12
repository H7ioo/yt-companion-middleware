/**
 * The control-surface console: renders the endpoint strips and fires real test requests at the
 * server named in the Base URL field.
 *
 * One page per bus. A page declares which one it is with `<body data-bus="action">`; the index
 * declares none and lists them all. Everything else — the rail, the strips, the deep-link
 * redirect — is derived from window.BUSES (assets/buses.js), so a new endpoint appears on the
 * right page by being added to that list and nowhere else.
 */
(function () {
  "use strict";

  const BUSES = window.BUSES;

  // --- Field types ---------------------------------------------------------
  // t: "path" | "text" | "textarea" | "select" | "json"
  const M = {
    read: "read", write: "write", mutate: "mutate", drop: "drop"
  };


  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const methodClass = (m) => m === "GET" ? M.read : m === "DELETE" ? M.drop : m === "PUT" ? M.mutate : m === "SSE" ? M.read : m === "WS" ? M.mutate : M.write;

  const baseInput = $("#base");
  const savedBase = localStorage.getItem("api.base");
  baseInput.value = savedBase || window.location.origin;
  baseInput.addEventListener("change", () => localStorage.setItem("api.base", baseInput.value.trim()));

  const baseURL = () => baseInput.value.trim().replace(/\/+$/, "");

  // --- JSON syntax highlight ----------------------------------------------
  function highlight(obj) {
    const json = JSON.stringify(obj, null, 2);
    return json.replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/("(\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(\.\d+)?([eE][+-]?\d+)?/g,
        (mtch, str, _e, colon, bool) => {
          if (str) return colon ? '<span class="tok-key">' + str + '</span>' + colon : '<span class="tok-str">' + str + '</span>';
          if (bool) return '<span class="tok-bool">' + mtch + '</span>';
          if (mtch === "null") return '<span class="tok-null">null</span>';
          return '<span class="tok-num">' + mtch + '</span>';
        });
  }

  // --- Build request from an endpoint's inputs -----------------------------
  function buildBody(ep, strip) {
    if (ep.raw) {
      const raw = $(".raw-body", strip).value.trim();
      if (!raw) return { ok: true, body: undefined };
      try { return { ok: true, body: JSON.parse(raw) }; }
      catch (e) { return { ok: false, err: "Body is not valid JSON: " + e.message }; }
    }
    if (!ep.body) return { ok: true, body: undefined };
    const out = {};
    for (const f of ep.body) {
      const node = $('[data-k="' + f.k + '"]', strip);
      let v = node.value;
      if (f.t === "select") {
        // Sentinel option values ("", "(toggle)") mean "omit this field".
        if (v === "" || v === "(toggle)") continue;
      }
      v = v.trim ? v.trim() : v;
      if (v === "") { if (f.req) return { ok: false, err: f.k + " is required" }; continue; }
      out[f.k] = v;
    }
    return { ok: true, body: out };
  }

  function resolvePath(ep, strip) {
    let p = ep.path;
    if (ep.pathParams) {
      for (const pp of ep.pathParams) {
        const v = $('[data-p="' + pp.k + '"]', strip).value.trim();
        if (!v) return { ok: false, err: ":" + pp.k + " is required" };
        p = p.replace(":" + pp.k, encodeURIComponent(v));
      }
    }
    return { ok: true, path: p };
  }

  // --- Fire one request ----------------------------------------------------
  async function fire(ep, strip) {
    const mon = $(".monitor", strip);
    const take = $(".take", strip);
    const pr = resolvePath(ep, strip);
    if (!pr.ok) return showLocalError(mon, pr.err);
    const bb = buildBody(ep, strip);
    if (!bb.ok) return showLocalError(mon, bb.err);

    const path = pr.path;
    const method = ep.m === "SSE" ? "GET" : ep.m;
    const headers = {};
    if (bb.body !== undefined) headers["Content-Type"] = "application/json";

    take.disabled = true;
    const eta = $(".take__eta", strip); eta.textContent = "sending…";
    const t0 = performance.now();
    try {
      const res = await fetch(baseURL() + path, {
        method, headers,
        body: bb.body !== undefined ? JSON.stringify(bb.body) : undefined,
      });
      const ms = Math.round(performance.now() - t0);
      const text = await res.text();
      let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      showResponse(mon, res.status, res.statusText, ms, parsed, path, method);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      showResponse(mon, 0, "network error", ms, { error: String(e && e.message || e),
        hint: "Is the server reachable at " + baseURL() + "? A cross-origin base URL will be blocked by CORS." }, path, method);
    } finally {
      take.disabled = false; eta.textContent = "";
      refreshTally();
    }
  }

  function statusKind(code) { return code >= 200 && code < 300 ? "ok" : code >= 400 && code < 500 ? "warn" : "err"; }

  function showResponse(mon, code, statusText, ms, body, path, method) {
    mon.classList.add("is-live");
    const kind = code === 0 ? "err" : statusKind(code);
    const label = code === 0 ? "NO RESPONSE" : code + " " + statusText.toUpperCase();
    mon.querySelector(".status").className = "status status--" + kind;
    mon.querySelector(".status").textContent = label;
    mon.querySelector(".meta").innerHTML =
      '<b>' + method + '</b> ' + path + ' &nbsp;·&nbsp; <b>' + ms + '</b> ms';
    mon.querySelector("pre").innerHTML = typeof body === "string" ? escapeHtml(body) : highlight(body);
  }
  function showLocalError(mon, msg) {
    mon.classList.add("is-live");
    mon.querySelector(".status").className = "status status--warn";
    mon.querySelector(".status").textContent = "NOT SENT";
    mon.querySelector(".meta").innerHTML = "fix the request below";
    mon.querySelector("pre").innerHTML = escapeHtml(msg);
  }
  function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // --- SSE connect/disconnect ---------------------------------------------
  function toggleSSE(ep, strip, btn) {
    const mon = $(".monitor", strip);
    if (strip._es) { strip._es.close(); strip._es = null; btn.textContent = "Connect"; btn.classList.add("take--read");
      const st = mon.querySelector(".status"); st.className = "status status--warn"; st.textContent = "DISCONNECTED"; return; }
    const path = ep.path;
    const url = baseURL() + path;
    mon.classList.add("is-live");
    const frames = [];
    const st = mon.querySelector(".status"); st.className = "status status--ok"; st.textContent = "CONNECTED";
    mon.querySelector(".meta").innerHTML = '<b>SSE</b> ' + path;
    mon.querySelector("pre").textContent = "waiting for frames…";
    let es;
    try { es = new EventSource(url); } catch (e) { return showLocalError(mon, String(e)); }
    strip._es = es;
    btn.textContent = "Disconnect"; btn.classList.remove("take--read");
    es.addEventListener("state", (e) => {
      let d; try { d = JSON.parse(e.data); } catch { d = e.data; }
      frames.unshift(d); if (frames.length > 8) frames.pop();
      mon.querySelector(".meta").innerHTML = '<b>SSE</b> ' + path + ' &nbsp;·&nbsp; <b>' + frames.length + '</b> frame(s), newest first';
      mon.querySelector("pre").innerHTML = frames.map(highlight).join("\n\n");
    });
    es.addEventListener("error", () => {
      st.className = "status status--err"; st.textContent = "STREAM ERROR";
    });
  }

  // --- WebSocket connect/disconnect ---------------------------------------
  function toggleWS(ep, strip, btn) {
    const mon = $(".monitor", strip);
    const st = mon.querySelector(".status");
    if (strip._ws) { strip._ws.close(); strip._ws = null; btn.textContent = "Connect"; btn.classList.add("take--read");
      st.className = "status status--warn"; st.textContent = "DISCONNECTED"; return; }
    const path = ep.path;
    const url = baseURL().replace(/^http/, "ws") + path;
    mon.classList.add("is-live");
    const frames = [];
    st.className = "status status--warn"; st.textContent = "CONNECTING";
    mon.querySelector(".meta").innerHTML = '<b>WS</b> ' + path;
    mon.querySelector("pre").textContent = "waiting for frames…";
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return showLocalError(mon, String(e)); }
    strip._ws = ws;
    btn.textContent = "Disconnect"; btn.classList.remove("take--read");
    ws.addEventListener("open", () => { st.className = "status status--ok"; st.textContent = "CONNECTED"; });
    ws.addEventListener("message", (e) => {
      let d; try { d = JSON.parse(e.data); } catch { d = e.data; }
      frames.unshift(d); if (frames.length > 8) frames.pop();
      mon.querySelector(".meta").innerHTML = '<b>WS</b> ' + path + ' &nbsp;·&nbsp; <b>' + frames.length + '</b> frame(s), newest first';
      mon.querySelector("pre").innerHTML = frames.map(highlight).join("\n\n");
    });
    ws.addEventListener("error", () => { st.className = "status status--err"; st.textContent = "SOCKET ERROR"; });
    ws.addEventListener("close", () => {
      if (!strip._ws) return; // deliberate disconnect already handled
      strip._ws = null; btn.textContent = "Connect"; btn.classList.add("take--read");
      st.className = "status status--warn"; st.textContent = "DISCONNECTED";
    });
  }

  // --- Deep links ----------------------------------------------------------
  // The console used to be one page, so every endpoint anchor (`/docs#post-api-action-preset`)
  // pointed at it. Those links — and the ones in the guide — must still land on the endpoint,
  // which now lives on its bus page. The owner is looked up in the data, never in a hand-kept map.
  function busOwning(anchor) {
    return BUSES.filter((b) => b.id === anchor || b.endpoints.some((ep) => slug(ep) === anchor))[0];
  }

  function followAnchor() {
    const anchor = location.hash.slice(1);
    if (!anchor || document.getElementById(anchor)) return;
    const owner = busOwning(anchor);
    if (owner && owner.id !== pageBus) location.replace("./" + owner.id + ".html#" + anchor);
  }

  // --- Render --------------------------------------------------------------
  // `<body data-bus="action">` renders that bus alone; the index declares no bus and lists them.
  const pageBus = document.body.dataset.bus || null;
  const rail = $("#rail"), buses = $("#buses");

  followAnchor();
  window.addEventListener("hashchange", followAnchor);

  for (const bus of BUSES) {
    const isPage = bus.id === pageBus;

    // Rail group. On the current bus, its endpoints; on the others, a link to their page — so the
    // rail stays a full index of the API rather than a stub of whatever page you happen to be on.
    const rg = el("div", "rail__grp");
    const heading = el("a", "rail__bus", bus.name);
    heading.href = "./" + bus.id + ".html";
    if (isPage) heading.classList.add("is-on");
    rg.appendChild(heading);
    if (isPage || !pageBus) {
      for (const ep of bus.endpoints) {
        const a = el("a");
        a.href = (isPage ? "" : "./" + bus.id + ".html") + "#" + slug(ep);
        const v = el("span", "v " + "j-" + methodClass(ep.m)); v.textContent = ep.m;
        v.style.color = "var(--" + methodClass(ep.m) + ")";
        a.appendChild(v); a.appendChild(el("span", null, ep.path.replace("/api/","").replace(/^dashboard\//,"…/")));
        rg.appendChild(a);
      }
    }
    rail.appendChild(rg);

    if (!isPage) continue;

    // Bus section — only the page's own bus gets rendered as testable strips.
    const sec = el("section", "bus"); sec.id = bus.id;
    const head = el("div", "bus__head");
    head.appendChild(el("h2", null, bus.name));
    const authBadge = el("span", "bus__auth is-open", "No auth · LAN");
    head.appendChild(authBadge);
    sec.appendChild(head);
    sec.appendChild(el("p", "bus__desc", bus.desc));

    for (const ep of bus.endpoints) sec.appendChild(renderStrip(ep));
    buses.appendChild(sec);
  }

  // The index is a router: a card per bus, with its endpoint count, linking to its page.
  if (!pageBus) {
    const grid = el("div", "buscards");
    for (const bus of BUSES) {
      const card = el("a", "buscard");
      card.href = "./" + bus.id + ".html";
      card.appendChild(el("h2", null, bus.name));
      card.appendChild(el("p", "bus__desc", bus.desc));
      card.appendChild(el("span", "micro", bus.endpoints.length + " endpoints"));
      grid.appendChild(card);
    }
    buses.appendChild(grid);
  }

  function slug(ep) { return (ep.m + ep.path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g,""); }

  function renderStrip(ep) {
    const mc = methodClass(ep.m);
    const strip = el("div", "strip strip--" + mc); strip.id = slug(ep);

    const head = el("div", "strip__head");
    head.appendChild(el("span", "jack jack--" + mc, ep.m));
    const path = el("span", "path");
    path.innerHTML = ep.path.replace(/:(\w+)/g, '<b>:$1</b>');
    head.appendChild(path);
    head.appendChild(el("span", "strip__spacer"));
    const costLabel = ep.cost === "live" ? "quota · live" : ep.cost === "cached" ? "cached · free" : "local · free";
    head.appendChild(el("span", "cost cost--" + ep.cost, costLabel));
    head.appendChild(el("span", "caret", "▸"));
    head.addEventListener("click", () => strip.classList.toggle("is-open"));
    strip.appendChild(head);

    const body = el("div", "strip__body");
    const desc = el("p", "strip__desc"); desc.innerHTML = ep.desc || ""; body.appendChild(desc);

    // path params
    if (ep.pathParams || ep.body || ep.raw) {
      const params = el("div", "params");
      if (ep.pathParams) for (const pp of ep.pathParams) params.appendChild(paramField(pp, true));
      if (ep.body) for (const f of ep.body) params.appendChild(paramField(f, false));
      if (ep.raw) {
        const wrap = el("div", "param");
        const lab = el("div", "param__label");
        lab.appendChild(mkLabel("request body"));
        lab.appendChild(el("span", "param__opt", "json"));
        wrap.appendChild(lab);
        if (ep.raw.hint) wrap.appendChild(el("span", "param__hint", ep.raw.hint));
        const ta = el("textarea", "raw-body"); ta.value = ep.raw.sample || ""; ta.spellcheck = false;
        wrap.appendChild(ta);
        params.appendChild(wrap);
      }
      body.appendChild(params);
    }

    // actions
    const actions = el("div", "strip__actions");
    const take = el("button", "take" + (mc === "read" ? " take--read" : ""));
    take.appendChild(document.createTextNode(ep.sse || ep.ws ? "Connect" : "Take"));
    actions.appendChild(take);
    actions.appendChild(el("span", "take__eta"));
    body.appendChild(actions);

    // monitor
    const mon = el("div", "monitor");
    const bar = el("div", "monitor__bar");
    bar.appendChild(el("span", "status", ""));
    bar.appendChild(el("span", "meta", ""));
    mon.appendChild(bar);
    mon.appendChild(el("pre"));
    body.appendChild(mon);

    strip.appendChild(body);
    if (ep.open) strip.classList.add("is-open");

    if (ep.sse) take.addEventListener("click", () => toggleSSE(ep, strip, take));
    else if (ep.ws) take.addEventListener("click", () => toggleWS(ep, strip, take));
    else take.addEventListener("click", () => fire(ep, strip));
    return strip;
  }

  function mkLabel(text) { const l = el("label"); l.textContent = text; return l; }
  function paramField(f, isPath) {
    const wrap = el("div", "param");
    const lab = el("div", "param__label");
    lab.appendChild(mkLabel(isPath ? ":" + f.k : f.k));
    lab.appendChild(el("span", f.req ? "param__req" : "param__opt", f.req ? "required" : "optional"));
    wrap.appendChild(lab);
    if (f.hint) wrap.appendChild(el("span", "param__hint", f.hint));
    let input;
    if (!isPath && f.t === "select") {
      input = el("select");
      for (const o of f.opts) { const opt = el("option", null, o === "" ? "(omit)" : o); opt.value = o; input.appendChild(opt); }
    } else if (!isPath && f.t === "textarea") {
      input = el("textarea"); input.spellcheck = false;
    } else {
      input = el("input"); input.spellcheck = false; input.autocomplete = "off";
      if (f.hint) input.placeholder = f.hint;
    }
    if (isPath) input.setAttribute("data-p", f.k); else input.setAttribute("data-k", f.k);
    wrap.appendChild(input);
    return wrap;
  }

  // --- Live tally ----------------------------------------------------------
  function setLamp(id, state, value) {
    const lamp = $("#" + id);
    lamp.className = "lamp" + (state ? " is-" + state : "");
    if (value != null) $("#v-" + id.replace("lamp-","")).textContent = value;
  }

  async function refreshTally() {
    try {
      const res = await fetch(baseURL() + "/api/dashboard/state");
      if (!res.ok) throw new Error(String(res.status));
      const s = await res.json();
      const live = s.status && s.status.isLive;
      setLamp("lamp-air", live ? "on" : "off", live ? "ON AIR" : "off air");
      const h = s.health;
      setLamp("lamp-health", h === "ok" ? "ok" : h === "auth_error" ? "err" : "warn", h || "unknown");
      setLamp("lamp-busy", s.busy ? "busy" : "off", s.busy ? "working" : "idle");
      const title = s.status && s.status.title;
      setLamp("lamp-title", title ? "ok" : "off", title || "—");
      if (s.quota) {
        const pct = s.quota.limit ? Math.round((s.quota.used / s.quota.limit) * 100) : 0;
        setLamp("lamp-quota", pct >= 90 ? "err" : pct >= 75 ? "warn" : "ok",
          s.quota.used + " / " + s.quota.limit);
      }
    } catch (e) {
      setLamp("lamp-health", "err", "unreachable");
      $("#v-air").textContent = "—";
    }
  }

  $("#ping").addEventListener("click", refreshTally);
  baseInput.addEventListener("change", refreshTally);
  refreshTally();
  setInterval(refreshTally, 5000);
})();