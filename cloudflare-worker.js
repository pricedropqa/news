// PriceDrop QA News — feed proxy (Cloudflare Worker)
// Lets the app read RSS feeds from other sites. Only the PriceDrop QA sites may use it.
const ALLOWED_ORIGINS = [
  "https://pricedropqa.qa",
  "https://www.pricedropqa.qa",
  "https://pricedropqa.github.io",
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    };
    const reply = (text, status) => new Response(text, { status, headers: { ...cors, "Content-Type": "text/plain" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return reply("Only GET is allowed", 405);
    if (!allowed) return reply("This proxy only works for the PriceDrop QA app", 403);

    let url;
    try { url = new URL(new URL(request.url).searchParams.get("url")); }
    catch { return reply("Add ?url=https://example.com/feed/", 400); }
    if (url.protocol !== "https:" && url.protocol !== "http:") return reply("Only http and https links", 400);

    // Serve from Cloudflare's cache for 10 minutes to stay fast and polite to news sites.
    const cache = caches.default;
    const cacheKey = new Request("https://feed-cache.local/" + encodeURIComponent(url.href));
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(cached.body, { status: cached.status, headers });
    }

    let res;
    try {
      res = await fetch(url.href, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PriceDropQA-News/1.0; +https://pricedropqa.qa/news/)",
          "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
        },
      });
    } catch {
      return reply("Could not reach that site", 502);
    }

    const type = res.headers.get("Content-Type") || "text/xml";
    if (!/xml|rss|atom|html|text/i.test(type)) return reply("That link is not a feed or web page", 415);
    const body = await res.text();
    if (body.length > 5_000_000) return reply("That page is too large", 413);

    const headers = { "Content-Type": type, "Cache-Control": "public, max-age=600" };
    if (res.ok) ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: res.status, headers })));
    return new Response(body, { status: res.status, headers: { ...headers, ...cors } });
  },
};
