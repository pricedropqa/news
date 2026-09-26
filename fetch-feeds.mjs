// Fetches every feed in feeds.json and writes data/news.json.
// No dependencies — runs on Node 18+ (GitHub Actions uses Node 22).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const PER_FEED = 30;       // newest stories kept from each site
const MAX_ITEMS = 400;     // cap for the whole file
const MAX_AGE_DAYS = 10;   // drop anything older than this

const ANDROID_RE = /\b(android|pixel|galaxy|samsung|one ?ui|oneplus|xiaomi|redmi|poco|oppo|vivo|realme|honor|huawei|motorola|moto g|nothing phone|qualcomm|snapdragon|wear ?os|chromebook|gemini)\b/i;
const APPLE_RE = /\b(iphone|ipad|ios|ipados|macos|apple|mac|macbook|imac|airpods|apple watch|watchos|vision pro|siri|app store)\b/i;

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

function parse(xml, feed) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, PER_FEED)) {
    const title = stripHtml(tag(b, "title"));
    let link = isAtom ? (attr(b, 'link[^>]*rel=["\']alternate["\']', "href") || attr(b, "link", "href")) : decode(tag(b, "link"));
    if (!link) link = decode(tag(b, "guid"));
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const html = tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || tag(b, "summary");
    const rawHtml = decode(html).includes("<") ? decode(html) : html;
    let desc = stripHtml(decode(tag(b, "description") || tag(b, "summary") || html));
    desc = desc.replace(/\b(The post|Read more|Continue reading)\b[\s\S]*$/i, "").trim();
    if (desc.length > 220) desc = desc.slice(0, 217).replace(/\s+\S*$/, "") + "…";
    const t = Date.parse(date) || Date.now();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const text = `${title} ${desc}`;
    const cats = new Set([feed.cat]);
    if (ANDROID_RE.test(text)) cats.add("android");
    if (APPLE_RE.test(text)) cats.add("apple");
    items.push({ t: title, l: link, s: feed.id, d: t, x: desc, i: findImage(b, rawHtml), c: [...cats] });
  }
  return items;
}

async function getFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 PriceDropQA-News/1.0", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parse(await res.text(), feed);
    if (!items.length) throw new Error("no stories found");
    return { items, status: "ok" };
  } catch (e) {
    return { items: [], status: String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const feeds = JSON.parse(await readFile(new URL("./feeds.json", import.meta.url), "utf8"));
const results = await Promise.all(feeds.map(getFeed));

// If a site fails this run, keep its stories from the previous run.
let previous = { items: [] };
try { previous = JSON.parse(await readFile(new URL("./data/news.json", import.meta.url), "utf8")); } catch {}

const sources = [];
let all = [];
feeds.forEach((f, idx) => {
  let { items, status } = results[idx];
  if (!items.length) items = (previous.items || []).filter((it) => it.s === f.id);
  sources.push({ id: f.id, name: f.name, cat: f.cat, site: f.site || new URL(f.url).origin, status, count: items.length });
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

await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await writeFile(new URL("./data/news.json", import.meta.url), JSON.stringify({ updated: Date.now(), sources, items: all }));
console.log(`\nWrote ${all.length} stories from ${sources.filter((s) => s.status === "ok").length}/${feeds.length} sources.`);
