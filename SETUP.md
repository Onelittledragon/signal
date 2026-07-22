# SIGNAL — Setup Guide

SIGNAL is a static dashboard plus six serverless Edge Functions in `/api`
(quotes, news, wire, calendar, fear-and-greed, and a geopolitical briefing).
The functions are written for Vercel, so the simplest way to run everything —
frontend and API together — is to deploy to Vercel.

## Recommended: Deploy to Vercel

1. Push this repo to GitHub (it's already linked to
   `github.com/tymcleese/signal`), or use the Vercel CLI below.

2. Go to https://vercel.com and sign in with GitHub.

3. Click **Add New… > Project**, pick the `signal` repo, and import it.
   - Framework Preset: **Other** (no build step needed).
   - Leave Build Command and Output Directory blank.

4. Before deploying, open **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com/
     (powers the geopolitical briefing panel, `/api/geo`).
   - `FINNHUB_API_KEY` = optional, from https://finnhub.io/
     (extra news-wire coverage, `/api/wire`). Skip if you don't have one.

5. Click **Deploy**. When it finishes you'll get a live URL like
   `https://signal-xxxx.vercel.app`. The `/api` functions run automatically.

To update later: push to GitHub and Vercel redeploys, or run `vercel --prod`.

## Alternative: Run locally

Requires Node.js (https://nodejs.org) and the Vercel CLI.

```bash
npm i -g vercel          # install the CLI once
cp .env.example .env.local   # then paste your keys into .env.local
vercel dev               # serves the site + /api at http://localhost:3000
```

`vercel dev` reads `.env.local` automatically, so the API functions get your
keys without touching the dashboard.

## Static-only (no backend)

You can open `index.html` directly in a browser to see the layout, but the
live panels (quotes, news, wire, geo briefing) call `/api/*` and will stay
empty without the serverless backend running. Use one of the options above
for the full experience.

## Notes

- Never commit your real keys. `.env`, `.env.local`, and `.vercel` are
  gitignored. Use `.env.example` as the template.
- `js/config.js` has a `CLAUDE_API_KEY` field — leave it blank. It's a
  browser-side override for local experimentation only; the deployed app uses
  the server-side `ANTHROPIC_API_KEY` instead.
