# PriceDrop QA News

Android, iPhone and tech news from 11 sites, plus Malayalam news from 5 Kerala sites, in one fast app (PWA).

Live: **https://pricedropqa.qa/news/**

A GitHub Action (`.github/workflows/update-news.yml`) runs every 30 minutes: it reads every feed in `feeds.json`, writes `data/news.json`, and publishes the site to GitHub Pages.

## Add a news site

Edit `feeds.json` and add one line:

```json
{"id": "sammobile", "name": "SamMobile", "url": "https://www.sammobile.com/feed/", "cat": "android"},
```

`cat` is `android`, `apple`, `tech` or `malayalam`. Malayalam sites appear only in the മലയാളം tab. Commit, and the site updates in about a minute.

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
