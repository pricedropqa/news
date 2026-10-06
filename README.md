# PriceDrop QA News

Tech news (12 sites), Malayalam news (5), world news (NDTV, BBC, Reuters) and football news (BBC Sport, Sky Sports, The Guardian, ESPN FC), plus Reddit communities in each section, and an OTT tab with streaming release dates and OTT news (Malayalam, Tamil, Hindi, English), in one fast app (PWA).

Live: **https://pricedropqa.qa/news/**

A GitHub Action (`.github/workflows/update-news.yml`) runs every 30 minutes: it reads every feed in `feeds.json`, writes `data/news.json`, and publishes the site to GitHub Pages.

## Add a news site

Edit `feeds.json` and add one line:

```json
{"id": "sammobile", "name": "SamMobile", "url": "https://www.sammobile.com/feed/", "cat": "android"},
```

`cat` is `android`, `apple` or `tech` (Tech tab), or `malayalam`, `world`, `football` or `ott` (their own tabs). A feed can have `"match"` (keep only stories containing these words) or `"skip"` (drop them); an OTT feed can have `"lang"` (`ott-ml`, `ott-ta`, `ott-hi`, `ott-en`) as its default language. Subreddits use `"url": "https://www.reddit.com/r/NAME/.rss"` with `"reddit": true` (fetched one by one, because Reddit blocks fast bursts). A site that blocks GitHub can get a `"fallback"` feed, such as a Google News search for that site. Commit, and the site updates in about a minute.

## OTT release dates

The "Release dates" list at the top of the OTT tab comes from `ott.json` (the update job copies it to `data/ott.json` on the site). Each line is one title:

```json
{"title": "Khalifa", "lang": "Malayalam", "type": "Movie", "platforms": ["ManoramaMAX", "Prime Video"], "date": "2026-10-09", "status": "confirmed", "dubs": ["Tamil"], "note": "", "link": "https://…"}
```

`status` is `confirmed` or `expected`; `date` is `YYYY-MM-DD`, or empty when not announced. `updated` at the top is the time of the last check (milliseconds). Titles show under "Now streaming" for 7 days after their date, then drop off the list by themselves. Legal streaming platforms only.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `feeds.json` | List of news sites |
| `ott.json` | Release dates shown at the top of the OTT tab |
| `fetch-feeds.mjs` | Reads all RSS feeds and writes `data/news.json` |
| `.github/workflows/update-news.yml` | Runs every 30 min, builds icons, publishes the site |
| `sw.js`, `manifest.json`, `icon.svg` | Install-as-app + offline support |
| `cloudflare-worker.js` | Copy of the feed proxy running at pd-feed-proxy.mathewdev84.workers.dev (used when someone adds their own feed in the Sites tab) |

If GitHub pauses the 30-minute schedule after 60 days without commits, open **Actions → Update news and publish → Run workflow** once.

The app shows only headlines, short summaries and links; every story opens on the original site.
