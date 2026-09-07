# Relay

## Run it locally

1. Get at least one API key — see "Provider chain" below for options. Gemini is the simplest to start with: go to aistudio.google.com/apikey, sign in with a Google account, and create a key. No credit card needed for the free tier.
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

You need judges to be able to open a real URL, not run something locally. Render's free tier is the simplest path for a plain Node/Express app like this:

1. Push this folder to a GitHub repo.
2. Go to render.com, sign in with GitHub, and create a new "Web Service" from that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under "Environment," add whichever of `GEMINI_API_KEYS`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY` you're using, with your key(s) as the value — never commit your `.env` file or put a key in code.
5. Deploy. Render gives you a public URL like `relay-yourname.onrender.com`.

Free-tier Render services sleep after inactivity and take ~30 seconds to wake up on the first request — worth knowing so it doesn't look broken if a judge tries it cold. Mention that in your demo or submission notes.

## Provider chain (fallbacks so a demo never just dies)

Every "analyze" request tries a chain of providers, in order, and only fails if *all* of them fail. This is what protects you if a key runs out of its daily quota, a model is temporarily overloaded, or you hit a rate limit mid-demo:

```
Gemini key 1 -> Gemini key 2 -> ... -> Groq -> OpenRouter
```

You only need to fill in one section of `.env` to run the app at all — add more for redundancy. All three have a genuinely free tier with no credit card:

- **Gemini** (`GEMINI_API_KEYS`) — aistudio.google.com/apikey. You can list several keys separated by commas (e.g. from different Google accounts); Relay tries them in order. This is the easiest way to get "several API key fallbacks" without touching any other provider.
- **Groq** (`GROQ_API_KEY`) — console.groq.com/keys. Free, no card, fast, and its rate limits reset daily. Its vision-capable model rotates fairly often (currently `qwen/qwen3.6-27b`, set via `GROQ_MODEL`) — if it stops working, check console.groq.com/docs/vision for the current one.
- **OpenRouter** (`OPENROUTER_API_KEY`) — openrouter.ai/keys. Set `OPENROUTER_MODEL=openrouter/free` (the default): this isn't a single model, it's a router that automatically picks whichever currently-free model on OpenRouter supports image input. That means it keeps working even as individual free models get added or retired, without you ever having to update a model name — the closest thing here to a "free forever" option, though it's still rate-limited (not literally unlimited).

None of these free tiers is truly unlimited on its own — but chaining a couple of Gemini keys with Groq and OpenRouter behind them means a judge would need to hit *four separate providers'* limits back to back for the app to actually fail. If every provider in the chain fails, the error message returned to the browser tells you which one failed last, which is the one to check first.

## A note on free-tier limits and data

Free tiers are rate-limited (a cap on requests per minute and/or per day, not unlimited), and providers may use free-tier inputs/outputs to improve their models — worth knowing since you're processing real family documents while testing. Switch to redacted or fake sample documents once you're past your own personal testing.

## What's not built yet (good to mention as roadmap in your pitch)

- Only one document photo at a time — no multi-page stitching for documents that span several pages.
- No accounts — the glossary is stored per-browser (`localStorage`), not synced across a family's devices.
- No offline mode.
- No read-aloud/listening feature — removed to keep the app focused on the core triage-and-translate flow.
