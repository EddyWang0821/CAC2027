# Relay, developer docs

This is the technical companion to the main README. If you're a judge who just wants to understand the project, read that one instead. This file is for running, deploying, and extending the code.

## Run it locally

1. Get at least one API key (see "Provider chain" below for options). Gemini is the simplest to start with: go to aistudio.google.com/apikey, sign in with a Google account, and create a key. No credit card needed for the free tier.
2. Install dependencies:
   ```
   npm install
   ```
3. Add your key(s):
   ```
   cp .env.example .env
   ```
   Open `.env` and fill in whichever provider(s) you got keys for.
4. Start the server:
   ```
   npm start
   ```
5. Open `http://localhost:3000` in your browser.

## Deploy it so anyone can use it (for your CAC submission)

You need judges to open a real URL, not run something locally. Render's free tier is the simplest path for a plain Node and Express app like this one.

1. Push this folder to a GitHub repo.
2. Go to render.com, sign in with GitHub, and create a new "Web Service" from that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under "Environment," add whichever of `GEMINI_API_KEYS`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY` you're using, with your key(s) as the value. Never commit your `.env` file or put a key in code.
5. Deploy. Render gives you a public URL like `relay-yourname.onrender.com`.

Free-tier Render services sleep after 15 minutes of inactivity and take 30 to 60 seconds to wake up on the first request. The service isn't deleted or expired, just asleep. Mention the cold start in your demo or submission notes so nobody thinks it's dead.

## Provider chain (fallbacks so a demo never just dies)

Every "analyze" request tries a chain of providers, in order, and only fails if all of them fail. This protects you if a key runs out of quota, a model is temporarily overloaded, or you hit a rate limit mid-demo.

```
Gemini key 1 -> Gemini key 2 -> ... -> Groq -> OpenRouter
```

You only need to fill in one section of `.env` to run the app at all. Add more for redundancy. All three have a real free tier with no credit card.

Gemini (`GEMINI_API_KEYS`): aistudio.google.com/apikey. You can list several keys separated by commas. For the keys to actually be independent fallbacks and not share one quota, create each one under a different Google Cloud project. Google's rate limits apply per project, not per key, so two keys from the same project share a single limit.

Groq (`GROQ_API_KEY`): console.groq.com/keys. Free, no card, fast. Its vision-capable model rotates fairly often (currently `qwen/qwen3.6-27b`, set via `GROQ_MODEL`). If it stops working, check console.groq.com/docs/vision for the current one.

OpenRouter (`OPENROUTER_API_KEY`): openrouter.ai/keys. Set `OPENROUTER_MODEL=openrouter/free` (the default). This isn't a single model, it's a router that picks whichever currently free model on OpenRouter supports image input, so it keeps working even as individual free models get added or retired.

None of these free tiers is unlimited on its own, and short rate-limit blips (a "please retry in a few seconds" type error) are normal under heavy testing. The terse retry usually clears it. If every provider in the chain fails, the error message returned to the browser tells you which one failed last.

## A note on free-tier limits and data

Free tiers are rate-limited, and providers may use free-tier inputs and outputs to improve their models. Worth knowing since you're processing real family documents while testing. Switch to redacted or fake sample documents once you're past your own personal testing.

## Server API

`POST /api/analyze`
```json
{
  "images": [{ "image_base64": "...", "media_type": "image/jpeg" }],
  "target_lang": "Spanish",
  "known_terms": ["deductible"]
}
```
`images` takes 1 to 6 pages, in order, for documents that span multiple pages (the model reads them as one document). The original single-image shape (`image_base64` and `media_type` at the top level, no `images` array) still works.

The response includes `needs_clearer_photo` and `quality_note` (flags an unreadable photo instead of guessing), `next_step_en`/`next_step_translated` (the short immediate action), and `draft_reply`, a fuller ready-to-send response with `needed`, `method`, `en`, and `translated` fields.

`GET /api/health` returns which providers are configured (no key values) and the max page count. Useful right after deploying, before you've fed it a real document.

## Built-in demo safeguards

A per-request timeout means a provider that hangs fails over to the next one after `PROVIDER_TIMEOUT_MS` (default 25 seconds) instead of stalling.

A result cache serves identical requests (same page images, language, known terms) from a short-lived in-memory store instead of re-hitting your API quota. It resets on server restart.

Rate limiting caps a public demo URL per IP (`RATE_LIMIT_MAX`, default 30 requests per `RATE_LIMIT_WINDOW_MS`, default 10 minutes) so one runaway client can't burn through shared free-tier quota before a judge tries it.

## What's not built yet

There's no multi-page capture UI in the frontend yet. The server supports it, but `public/index.html` still only lets you attach one photo.

There are no accounts. The glossary is stored per browser (`localStorage`), not synced across a family's devices.

There's no offline mode.

There's no read-aloud or listening feature. It was removed to keep the app focused on the core triage-and-translate flow.
