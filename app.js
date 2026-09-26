/* PriceDrop QA News — RSS reader PWA */
(() => {
  "use strict";
  const PAGE = 40;
  const PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  ];
  const $ = (id) => document.getElementById(id);

  // ---------- safe storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pdn." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pdn." + k, JSON.stringify(v)); } catch {} },
  };

  const state = {
    data: { updated: 0, sources: [], items: [] },
    custom: store.get("custom", []),          // [{id,name,url,cat}]
    customItems: [],
    customStatus: {},
    off: new Set(store.get("off", [])),       // disabled source ids
    saved: store.get("saved", []),            // full item objects
    read: new Set(store.get("read", [])),
    tab: "all",
    source: "",
    q: "",
    shown: PAGE,
  };

  // ---------- helpers ----------
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = (t) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  };
  const dayLabel = (t) => {
    const d = new Date(t), now = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(now) - start(d)) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  };
  const initials = (name = "") => name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "N";
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return "c" + (h >>> 0).toString(36); };

  function allSources() {
    return [...state.data.sources, ...state.custom.map((c) => ({
      ...c, custom: true, site: safeOrigin(c.url),
      status: state.customStatus[c.id] || "loading",
      count: state.customItems.filter((i) => i.s === c.id).length,
    }))];
  }
  function srcById(id) { return allSources().find((s) => s.id === id) || { name: id, cat: "tech" }; }
  function safeOrigin(u) { try { return new URL(u).origin; } catch { return ""; } }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- data ----------
  async function loadMain() {
    const res = await fetch("data/news.json?v=" + Math.floor(Date.now() / 60000), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  }

  function parseXml(text, feed) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("not a valid RSS feed");
    const nodes = [...doc.querySelectorAll("item, entry")].slice(0, 30);
    if (!nodes.length) throw new Error("no stories found");
    const txt = (el, sel) => { const n = el.getElementsByTagName(sel)[0]; return n ? n.textContent.trim() : ""; };
    const strip = (h) => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
    return nodes.map((n) => {
      let link = txt(n, "link");
      if (!link) { const l = n.querySelector("link[href]"); link = l ? l.getAttribute("href") : txt(n, "guid"); }
      const html = txt(n, "description") || txt(n, "summary") || txt(n, "content");
      let x = strip(html); if (x.length > 220) x = x.slice(0, 217).replace(/\s+\S*$/, "") + "…";
      const m = n.getElementsByTagName("media:thumbnail")[0] || n.getElementsByTagName("media:content")[0];
      const imgMatch = html.match(/<img[^>]+src=["']([^"']+)/i);
      const i = (m && m.getAttribute("url")) || (imgMatch ? imgMatch[1] : "");
      const d = Date.parse(txt(n, "pubDate") || txt(n, "published") || txt(n, "updated")) || Date.now();
      return { t: strip(txt(n, "title")), l: link, s: feed.id, d, x, i, c: [feed.cat] };
    }).filter((it) => it.t && /^https?:/.test(it.l));
  }

  async function loadCustomFeed(feed) {
    let lastErr;
    for (const p of PROXIES) {
      try {
        const res = await fetch(p(feed.url));
        if (!res.ok) throw new Error("HTTP " + res.status);
        return parseXml(await res.text(), feed);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async function loadCustom() {
    const results = await Promise.all(state.custom.map(async (f) => {
      try { const items = await loadCustomFeed(f); state.customStatus[f.id] = "ok"; return items; }
      catch (e) { state.customStatus[f.id] = e.message || "could not load"; return []; }
    }));
    state.customItems = results.flat();
  }

  async function refresh(manual) {
    const btn = $("refreshBtn");
    btn.classList.add("spin");
    if (!state.data.items.length) renderSkeleton();
    try {
      await Promise.all([loadMain().catch((e) => { if (!state.data.items.length) throw e; }), loadCustom()]);
      if (manual) toast("News updated");
    } catch (e) {
      if (!state.data.items.length && !state.customItems.length) {
        $("list").innerHTML = "";
        showEmpty("Could not load the news", navigator.onLine === false ? "You're offline. Connect to the internet and tap refresh." : "The news file didn't load. Tap refresh to try again.");
      }
    } finally {
      btn.classList.remove("spin");
      render();
    }
  }

  // ---------- filtering ----------
  function items() {
    if (state.tab === "saved") return state.saved.slice().sort((a, b) => b.d - a.d);
    const seen = new Set();
    let list = [...state.data.items, ...state.customItems].filter((it) => {
      if (seen.has(it.l)) return false; seen.add(it.l); return true;
    });
    list = list.filter((it) => !state.off.has(it.s));
    if (state.tab === "android" || state.tab === "apple") list = list.filter((it) => (it.c || []).includes(state.tab));
    if (state.source) list = list.filter((it) => it.s === state.source);
    if (state.q) {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((it) => { const hay = (it.t + " " + it.x).toLowerCase(); return words.every((w) => hay.includes(w)); });
    }
    return list.sort((a, b) => b.d - a.d);
  }

  // ---------- render ----------
  function renderSkeleton() {
    $("list").innerHTML = Array.from({ length: 6 }, () =>
      `<div class="story" aria-hidden="true"><div><div class="sk w1"></div><div class="sk w2"></div><div class="sk w3"></div></div><div class="thumb"></div></div>`).join("");
  }

  function showEmpty(title, text) {
    const e = $("empty");
    e.innerHTML = `<strong>${esc(title)}</strong>${esc(text)}`;
    e.hidden = false;
  }

  function renderStatus() {
    const s = state.data.updated ? `Updated ${ago(state.data.updated)}` : "Loading stories…";
    const n = state.data.items.length + state.customItems.length;
    $("status").textContent = n ? `${s} · ${n} stories` : s;
  }

  function renderChips() {
    const counts = {};
    const pool = [...state.data.items, ...state.customItems].filter((it) =>
      state.tab === "all" || state.tab === "saved" || (it.c || []).includes(state.tab));
    pool.forEach((it) => (counts[it.s] = (counts[it.s] || 0) + 1));
    const srcs = allSources().filter((s) => !state.off.has(s.id) && counts[s.id]);
    const chip = (id, label, n, cat) =>
      `<button type="button" class="chip" data-src="${esc(id)}" aria-pressed="${state.source === id}">${cat ? `<span class="dot ${cat}"></span>` : ""}${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ""}</button>`;
    $("chips").innerHTML = chip("", "All sites", null) + srcs.map((s) => chip(s.id, s.name, counts[s.id], s.cat)).join("");
  }

  const saveIcon = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 3.5h12v17l-6-4-6 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

  function storyHtml(it) {
    const src = srcById(it.s);
    const saved = state.saved.some((s) => s.l === it.l);
    const thumb = it.i
      ? `<img class="thumb" src="${esc(it.i)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(initials(src.name))}">`
      : `<div class="thumb ph" aria-hidden="true">${esc(initials(src.name))}</div>`;
    return `<article class="story${state.read.has(it.l) ? " read" : ""}">
      <a class="link" href="${esc(it.l)}" target="_blank" rel="noopener" aria-label="${esc(it.t)} — ${esc(src.name)}"></a>
      <div class="body">
        <div class="meta"><span class="dot ${esc(src.cat)}"></span><span class="src">${esc(src.name)}</span><span>·</span><time datetime="${new Date(it.d).toISOString()}">${ago(it.d)}</time></div>
        <h3>${esc(it.t)}</h3>
        ${it.x ? `<p>${esc(it.x)}</p>` : ""}
      </div>
      <div class="side">${thumb}<button type="button" class="save" data-link="${esc(it.l)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save for later"}">${saveIcon}</button></div>
    </article>`;
  }

  function renderList() {
    const list = items();
    const e = $("empty");
    e.hidden = true;
    if (!list.length) {
      $("list").innerHTML = "";
      $("moreBtn").hidden = true;
      if (state.tab === "saved") showEmpty("No saved stories yet", "Tap the bookmark on any story to read it later.");
      else if (state.q) showEmpty("No matches", `Nothing found for “${state.q}”. Try a shorter word.`);
      else if (state.data.items.length) showEmpty("Nothing here", "Turn some sites back on in the Sites tab.");
      return;
    }
    const slice = list.slice(0, state.shown);
    let html = "", lastDay = "";
    for (const it of slice) {
      const d = dayLabel(it.d);
      if (d !== lastDay) { html += `<div class="day">${esc(d)}</div>`; lastDay = d; }
      html += storyHtml(it);
    }
    $("list").innerHTML = html;
    $("list").querySelectorAll("img.thumb").forEach((img) => {
      img.addEventListener("error", () => {
        const ph = document.createElement("div");
        ph.className = "thumb ph"; ph.setAttribute("aria-hidden", "true"); ph.textContent = img.dataset.ph;
        img.replaceWith(ph);
      }, { once: true });
    });
    const more = $("moreBtn");
    more.hidden = list.length <= state.shown;
    more.textContent = `Show more stories (${list.length - slice.length} left)`;
  }

  function renderSources() {
    $("sourceList").innerHTML = allSources().map((s) => {
      const ok = s.status === "ok";
      const sub = ok ? `${s.count} stories · ${s.site.replace(/^https?:\/\/(www\.)?/, "")}` : s.status === "loading" ? "Loading…" : `Not responding (${s.status})`;
      return `<div class="src-row">
        <span class="dot ${esc(s.cat)}"></span>
        <div class="info"><div class="name">${esc(s.name)}${s.custom ? ' <small class="hint">· added by you</small>' : ""}</div><div class="sub${ok || s.status === "loading" ? "" : " bad"}">${esc(sub)}</div></div>
        ${s.custom ? `<button type="button" class="rm" data-rm="${esc(s.id)}">Remove</button>` : ""}
        <label class="switch" title="Show ${esc(s.name)}"><input type="checkbox" id="sw-${esc(s.id)}" data-toggle="${esc(s.id)}" ${state.off.has(s.id) ? "" : "checked"} aria-label="Show ${esc(s.name)}"><span></span></label>
      </div>`;
    }).join("");
  }

  function render() {
    renderStatus();
    const isSources = state.tab === "sources";
    $("feedView").hidden = isSources;
    $("sourcesView").hidden = !isSources;
    $("controls").hidden = isSources;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
    if (isSources) renderSources();
    else { renderChips(); renderList(); }
  }

  // ---------- events ----------
  function setTab(tab) {
    state.tab = tab; state.shown = PAGE; state.source = "";
    store.set("tab", tab);
    try { history.replaceState(null, "", "#" + tab); } catch {}
    render();
    window.scrollTo({ top: 0 });
  }

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) setTab(b.dataset.tab);
  });

  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.source = state.source === b.dataset.src ? "" : b.dataset.src;
    state.shown = PAGE;
    renderChips(); renderList();
  });

  let qTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); state.shown = PAGE; renderList(); }, 150);
  });

  $("moreBtn").addEventListener("click", () => { state.shown += PAGE; renderList(); });

  $("list").addEventListener("click", (e) => {
    const save = e.target.closest(".save");
    if (save) {
      const link = save.dataset.link;
      const idx = state.saved.findIndex((s) => s.l === link);
      if (idx >= 0) { state.saved.splice(idx, 1); toast("Removed from saved"); }
      else {
        const it = [...state.data.items, ...state.customItems].find((i) => i.l === link);
        if (it) { state.saved.unshift(it); toast("Saved for later"); }
      }
      state.saved = state.saved.slice(0, 200);
      store.set("saved", state.saved);
      if (state.tab === "saved") renderList();
      else { save.setAttribute("aria-pressed", String(idx < 0)); save.setAttribute("aria-label", idx < 0 ? "Remove from saved" : "Save for later"); }
      return;
    }
    const link = e.target.closest("a.link");
    if (link) {
      state.read.add(link.getAttribute("href"));
      store.set("read", [...state.read].slice(-600));
      link.closest(".story").classList.add("read");
    }
  });

  $("sourceList").addEventListener("change", (e) => {
    const id = e.target.dataset.toggle;
    if (!id) return;
    if (e.target.checked) state.off.delete(id); else state.off.add(id);
    store.set("off", [...state.off]);
  });
  $("sourceList").addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.rm;
    if (!id) return;
    state.custom = state.custom.filter((c) => c.id !== id);
    state.customItems = state.customItems.filter((i) => i.s !== id);
    store.set("custom", state.custom);
    renderSources();
    toast("Feed removed");
  });

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("addName").value.trim();
    const url = $("addUrl").value.trim();
    const cat = $("addCat").value;
    const msg = $("addMsg");
    if (state.custom.some((c) => c.url === url) || state.data.sources.some((s) => s.site && url.startsWith(s.site) && /feed|rss/i.test(url))) {
      msg.textContent = "That site is already in your list."; return;
    }
    const feed = { id: hash(url), name, url, cat };
    msg.textContent = "Checking the feed…";
    try {
      const got = await loadCustomFeed(feed);
      state.custom.push(feed);
      state.customStatus[feed.id] = "ok";
      state.customItems = state.customItems.filter((i) => i.s !== feed.id).concat(got);
      store.set("custom", state.custom);
      msg.textContent = `Added ${name} with ${got.length} stories.`;
      e.target.reset();
      renderSources(); renderStatus();
    } catch (err) {
      msg.textContent = `Couldn't read that feed (${err.message || "error"}). Check the link — it usually ends in /feed/ or .xml.`;
    }
  });

  $("refreshBtn").addEventListener("click", () => refresh(true));

  // Theme: follows the phone by default; the button forces light or dark.
  const applyTheme = (t) => {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#141B23" : "#2447E0");
  };
  applyTheme(store.get("theme", null));
  $("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    store.set("theme", next); applyTheme(next);
    toast(next === "dark" ? "Dark mode" : "Light mode");
  });

  // Start
  const hashTab = (location.hash || "").slice(1);
  state.tab = ["all", "android", "apple", "saved", "sources"].includes(hashTab) ? hashTab : store.get("tab", "all");
  render();
  refresh(false);
  setInterval(renderStatus, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.data.updated > 30 * 60000) refresh(false);
  });

  // Offline support (works on the real site; skipped where not allowed)
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    try { navigator.serviceWorker.register("sw.js").catch(() => {}); } catch {}
  }
})();
