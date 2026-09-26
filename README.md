# PriceDrop QA News

Tech news (12 sites), Malayalam news (5), world news (NDTV, BBC, Reuters) and football news (BBC Sport, Sky Sports, The Guardian, ESPN FC), plus Reddit communities in each section, in one fast app (PWA).

Live: **https://pricedropqa.qa/news/**

A GitHub Action (`.github/workflows/update-news.yml`) runs every 30 minutes: it reads every feed in `feeds.json`, writes `data/news.json`, and publishes the site to GitHub Pages.

## Add a news site

Edit `feeds.json` and add one line:

```json
{"id": "sammobile", "name": "SamMobile", "url": "https://www.sammobile.com/feed/", "cat": "android"},
```

`cat` is `android`, `apple` or `tech` (Tech tab), or `malayalam`, `world` or `football` (their own tabs). Subreddits use `"url": "https://www.reddit.com/r/NAME/.rss"` with `"reddit": true` (fetched one by one, because Reddit blocks fast bursts). A site that blocks GitHub can get a `"fallback"` feed, such as a Google News search for that site. Commit, and the site updates in about a minute.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `feeds.json` | List of news sites |
| `fetch-feeds.mjs` | Reads all RSS feeds and writes `data/news.json` |
| `.github/workflows/update-news.yml` | Runs every 30 min, builds icons, publishes the site |
| `sw.js`, `manifest.json`, `icon.svg` | Install-as-app + offline support |

If GitHub pauses the 30-minute schedule after 60 days without commits, open **Actions → Update news and publish → Run workflow** once.

The app shows only headlines, short summaries and links; every story opens on the original site.
