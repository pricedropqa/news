// Fetches every feed in feeds.json and writes data/news.json.
// No dependencies — runs on Node 18+ (GitHub Actions uses Node 22).
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";

const PER_FEED = 30;       // newest stories kept from each site
const MAX_ITEMS = 1200;     // cap for the whole file
const MAX_AGE_DAYS = 10;   // drop anything older than this

const ANDROID_RE = /\b(android|pixel|galaxy|samsung|one ?ui|oneplus|xiaomi|redmi|poco|oppo|vivo|realme|honor|huawei|motorola|moto g|nothing phone|qualcomm|snapdragon|wear ?os|chromebook|gemini)\b/i;
const APPLE_RE = /\b(iphone|ipad|ios|ipados|macos|apple|mac|macbook|imac|airpods|apple watch|watchos|vision pro|siri|app store)\b/i;

// OTT tab: stories are tagged by language so the tab can filter them.
const OTT_LANGS = [
  ["ott-ml", /\b(malayalam|mollywood|manorama ?max)\b/i],
  ["ott-ta", /\b(tamil|kollywood)\b/i],
  ["ott-hi", /\b(hindi|bollywood)\b/i],
  ["ott-en", /\b(english|hollywood)\b/i],
];
const OTT_OTHER_RE = /\b(telugu|tollywood|kannada|sandalwood|bengali|marathi|punjabi|gujarati|bhojpuri|korean|k-drama|anime)\b/i;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s = "") =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
const unCdata = (s = "") => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const stripHtml = (s = "") => decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? unCdata(m[1]).trim() : "";
}
function attr(block, name, a) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

function findImage(block, html) {
  const cands = [
    attr(block, "media:thumbnail", "url"),
    attr(block, "media:content", "url"),
    /<enclosure[^>]+type=["']image/i.test(block) ? attr(block, "enclosure", "url") : "",
  ];
  const img = (html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img) cands.push(decode(img[1]));
  return cands.find((u) => /^https?:\/\//.test(u) && !/feedburner|pixel|1x1|gravatar/i.test(u)) || "";
}

// Date.parse doesn't know zone names like "BST" (Sky Sports) or "IST", so swap them for offsets.
const ZONES = { BST: "+0100", IST: "+0530", CET: "+0100", CEST: "+0200", AEST: "+1000", AST: "+0300" };
function parseDate(s) {
  if (!s) return 0;
  return Date.parse(s) || Date.parse(s.replace(/\b([A-Z]{3,4})\s*$/, (m, z) => ZONES[z] || m)) || 0;
}

function parse(xml, feed) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, 150)) {
    let title = stripHtml(tag(b, "title"));
    if (feed.trim) title = title.replace(new RegExp(`\\s*[-|–]\\s*(${feed.trim})\\s*$`, "i"), "");
    let link = isAtom ? (attr(b, 'link[^>]*rel=["\']alternate["\']', "href") || attr(b, "link", "href")) : decode(tag(b, "link"));
    if (!link) link = decode(tag(b, "guid"));
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const html = tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || tag(b, "summary");
    const rawHtml = decode(html).includes("<") ? decode(html) : html;
    let desc = stripHtml(decode(tag(b, "description") || tag(b, "summary") || html));
    desc = desc.replace(/\b(The post|Read more|Continue reading)\b[\s\S]*$/i, "").trim();
    desc = desc.replace(/\s*submitted by\s+\/u\/[\s\S]*$/i, "").trim(); // Reddit footer
    if (desc.length > 220) desc = desc.slice(0, 217).replace(/\s+\S*$/, "") + "…";
    if (desc && title && desc.startsWith(title.slice(0, 40))) desc = ""; // summary just repeats the headline (Google News)
    const t = parseDate(date) || Date.now();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const text = `${title} ${desc}`;
    if (feed.match && !new RegExp(feed.match, "i").test(text)) continue; // feed keeps only matching stories
    if (feed.skip && new RegExp(feed.skip, "i").test(text)) continue;    // feed drops matching stories
    const cats = new Set([feed.cat]);
    if (feed.cat === "ott") {
      const langs = OTT_LANGS.filter(([, re]) => re.test(text)).map(([k]) => k);
      if (!langs.length && OTT_OTHER_RE.test(title)) continue; // only about a language we don't follow
      if (feed.lang) langs.push(feed.lang);
      langs.forEach((k) => cats.add(k));
    } else {
      if (ANDROID_RE.test(text)) cats.add("android");
      if (APPLE_RE.test(text)) cats.add("apple");
    }
    items.push({ t: title, l: link, s: feed.id, d: t, x: desc, i: findImage(b, rawHtml), c: [...cats] });
  }
  // Some feeds are not in date order, so keep the newest ones.
  return items.sort((a, b) => b.d - a.d).slice(0, PER_FEED);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Some sites block Node's built-in fetch but allow curl, so curl is the backup.
function curlText(url) {
  return new Promise((resolve, reject) => {
    execFile("curl", ["-sSL", "--compressed", "-m", "25", "-A", UA, "-H", "Accept: application/rss+xml, application/xml, text/xml, */*", "-w", "\n%{http_code}", url],
      { maxBuffer: 20 * 1024 * 1024 }, (err, out) => {
        if (err) return reject(new Error("curl failed"));
        const i = out.lastIndexOf("\n");
        const code = Number(out.slice(i + 1));
        if (code < 200 || code >= 300) return reject(new Error(`HTTP ${code}`));
        resolve(out.slice(0, i));
      });
  });
}

async function fetchXml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (res.ok) return await res.text();
    return await curlText(url).catch(() => { throw new Error(`HTTP ${res.status}`); });
  } finally {
    clearTimeout(timer);
  }
}

// Tries the site's own feed first, then its "fallback" feed (e.g. Google News) if one is set.
async function getFeed(feed) {
  let lastErr;
  for (const url of [feed.url, feed.fallback].filter(Boolean)) {
    try {
      const items = parse(await fetchXml(url), feed);
      if (!items.length) throw new Error("no stories found");
      return { items, status: "ok" };
    } catch (e) {
      lastErr = e;
    }
  }
  return { items: [], status: String(lastErr?.message || lastErr).slice(0, 80) };
}

const feeds = JSON.parse(await readFile(new URL("./feeds.json", import.meta.url), "utf8"));
// If a site fails this run, keep its stories from the previous run.
let previous = { items: [], sources: [] };
try { previous = JSON.parse(await readFile(new URL("./data/news.json", import.meta.url), "utf8")); } catch {}
const prevSrc = new Map((previous.sources || []).map((s) => [s.id, s]));

// Reddit gives shared servers (like GitHub's) a tiny request allowance and says in its
// x-ratelimit-* headers how long to wait. Each run refreshes the REDDIT_PER_RUN subreddits
// updated longest ago, waiting as long as Reddit asks between them; the rest keep their last stories.
const REDDIT_PER_RUN = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function redditFetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/atom+xml, application/xml, */*" } });
    const reset = Math.min(Number(res.headers.get("x-ratelimit-reset")) || 30, 90);
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? 1);
    if (res.ok) return { xml: await res.text(), waitMs: (remaining < 1 ? reset + 2 : 3) * 1000 };
    if (res.status !== 429) throw new Error(`HTTP ${res.status}`);
    await sleep((reset + 2) * 1000);
  }
  throw new Error("HTTP 429");
}
async function getRedditFeeds(list) {
  const out = new Map();
  const lastTry = (f) => prevSrc.get(f.id)?.tried || prevSrc.get(f.id)?.fetched || 0;
  const due = [...list].sort((a, b) => lastTry(a) - lastTry(b)).slice(0, REDDIT_PER_RUN);
  for (const f of due) {
    try {
      const { xml, waitMs } = await redditFetch(f.url);
      const items = parse(xml, f);
      out.set(f.id, items.length ? { items, status: "ok" } : { items: [], status: "no stories found" });
      await sleep(waitMs);
    } catch (e) {
      out.set(f.id, { items: [], status: String(e.message || e) });
      if (/HTTP (403|429)/.test(e.message)) break; // Reddit is blocking us for now; try again next run
    }
  }
  for (const f of list) if (!out.has(f.id)) out.set(f.id, { items: [], status: "skip" });
  return out;
}
const [plain, reddit] = await Promise.all([
  Promise.all(feeds.filter((f) => !f.reddit).map(getFeed)),
  getRedditFeeds(feeds.filter((f) => f.reddit)),
]);
const plainIt = plain[Symbol.iterator]();
const results = feeds.map((f) => (f.reddit ? reddit.get(f.id) : plainIt.next().value));

const sources = [];
let all = [];
feeds.forEach((f, idx) => {
  let { items, status } = results[idx];
  const prev = prevSrc.get(f.id);
  const fetched = status === "ok" ? Date.now() : prev?.fetched || 0;
  const tried = status === "skip" ? prev?.tried || prev?.fetched || 0 : Date.now();
  if (!items.length) {
    items = (previous.items || []).filter((it) => it.s === f.id);
    if (status === "skip") status = items.length ? "ok" : "waiting for next update";
  }
  sources.push({ id: f.id, name: f.name, cat: f.cat, site: f.site || new URL(f.url).origin, status, count: items.length, fetched, tried });
  all.push(...items);
  console.log(`${status === "ok" ? "✔" : "✖"} ${f.name.padEnd(18)} ${String(items.length).padStart(3)}  ${status}`);
});

const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const seen = new Set();
all = all
  .filter((it) => it.d >= cutoff && it.d <= Date.now() + 36e5)
  .sort((a, b) => b.d - a.d)
  .filter((it) => {
    const key = it.l.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, MAX_ITEMS);
const counts = {};
for (const it of all) counts[it.s] = (counts[it.s] || 0) + 1;
for (const src of sources) src.count = counts[src.id] || 0;

await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await writeFile(new URL("./data/news.json", import.meta.url), JSON.stringify({ updated: Date.now(), sources, items: all }));
// OTT release dates: publish ott.json next to the news so the app can read it.
await copyFile(new URL("./ott.json", import.meta.url), new URL("./data/ott.json", import.meta.url)).catch(() => console.log("ott.json not found, skipped"));
console.log(`\nWrote ${all.length} stories from ${sources.filter((s) => s.status === "ok").length}/${feeds.length} sources.`);
