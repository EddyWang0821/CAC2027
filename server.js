require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '30mb' })); // multi-page documents as base64 images can add up
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// Provider chain
// ---------------------------------------------------------------------
// Relay tries each entry below, in order, until one returns a usable
// answer. This is what makes the app resilient when a key runs out of
// quota, a model is temporarily overloaded, or a rate limit is hit:
//
//   Gemini key 1 -> Gemini key 2 -> ... -> Groq -> OpenRouter
//
// You only need ONE provider filled in to run the app at all. Fill in
// more for redundancy — see .env.example and the README for how to get
// each key and which ones are free. Every provider here has a free tier
// with no credit card required; none is truly "unlimited," but chaining
// several free tiers together gets you close to that in practice.

function parseKeyList(envVal) {
  return (envVal || '').split(',').map(k => k.trim()).filter(Boolean);
}

// Accepts either the new GEMINI_API_KEYS (comma-separated, for multiple
// keys) or the old single-key GEMINI_API_KEY, so existing .env files
// still work unchanged.
const GEMINI_KEYS = parseKeyList(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);
// If this model ever 404s, open aistudio.google.com, check the model picker
// for the current free-tier Flash model name, and swap it in here (or set
// GEMINI_MODEL in .env instead of editing code).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Groq: free, no credit card, generous rate limits. Groq's vision-capable
// model changes fairly often (they rotate/deprecate preview models) — if
// this stops working, check console.groq.com/docs/vision for the current
// vision model name and set GROQ_MODEL in .env.
const GROQ_KEYS = parseKeyList(process.env.GROQ_API_KEY);
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

// OpenRouter: free, no credit card. "openrouter/free" is a router, not a
// single model — it automatically picks whichever currently-free model on
// OpenRouter supports image input, so this entry keeps working even as
// individual free models come and go, without you needing to update a
// model name. This is the closest thing here to a self-maintaining free
// fallback.
const OPENROUTER_KEYS = parseKeyList(process.env.OPENROUTER_API_KEY);
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';

// How long to let a single provider attempt hang before giving up on it
// and moving to the next one in the chain. Without this, one stalled
// provider could hang a request indefinitely instead of failing over.
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;

// Multi-page documents: how many photos a single analysis can include.
// Keep this bounded — every extra page adds to the request payload and
// to how long the model takes to respond.
const MAX_PAGES = Number(process.env.MAX_PAGES) || 6;

// The schema now asks for a fuller bilingual draft_reply on top of the
// summary/glossary/etc., so dense source documents (long legal letters,
// itemized bills) can produce a genuinely long JSON response. Weaker
// fallback models (especially whatever "openrouter/free" happens to
// route to) are the most likely to run out of budget and get cut off
// mid-JSON — raise this if you keep seeing "Response was cut off before
// finishing" even on the terse retry.
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS) || 3500;

const TERSE_SUFFIX = '\n\nYour previous attempt got cut off before finishing, or was not valid JSON. Be noticeably more concise in every field this time — short sentences, no sub-clauses.';

function buildSystemPrompt(targetLang, knownTerms, pageCount) {
  const multiPageNote = pageCount > 1
    ? `\n\nYou have been given ${pageCount} images, in order — these are consecutive pages of the SAME document, not separate documents. Read them together: a detail on a later page (a total, a signature line, a deadline in fine print) can change how an earlier page should be understood. Base every field on the document as a whole, not just the first page.`
    : '';

  return `You are Relay, a tool that helps a teenager quickly understand an official document (bill, letter, notice, form) written to a parent who speaks limited English, so the teenager can explain it accurately.${multiPageNote}

Analyze the attached image(s) and respond with ONLY a raw JSON object matching exactly this schema:

{
  "document_type": "short label, e.g. 'Medical bill' or 'Insurance denial letter'",
  "urgency": "calm" | "watch" | "urgent",
  "needs_clearer_photo": true if the image is too blurry, dark, cropped, or low-resolution to read the important parts confidently, otherwise false,
  "quality_note": "if needs_clearer_photo is true, one short sentence on what's hard to read and which page (e.g. 'The bottom of page 2, where the due date likely is, is cut off'), otherwise null",
  "one_line_summary": "one plain-English sentence on what this document is and why it exists",
  "key_line": "the single most important fact or number across the whole document (e.g. amount owed, what was denied and why, what is required)",
  "deadline": "a specific date or timeframe if one exists anywhere in the document, otherwise null",
  "explanation_en": "2-3 sentences a teenager can read to understand what's going on, in plain English, no jargon",
  "explanation_translated": "the same explanation, natural and warm, written in ${targetLang}, as if speaking to a parent",
  "next_step_en": "one short sentence on the single most important immediate action, in English",
  "next_step_translated": "the same, in ${targetLang}",
  "draft_reply": {
    "needed": true if a reply, call, or written response to someone is actually required or clearly advisable, otherwise false,
    "method": "call" | "email" | "portal_message" | "mail" | "in_person" | null,
    "en": "if needed is true, a fuller ready-to-use draft (3-6 sentences) the family can actually send or read from — e.g. a short letter/email body, or what to say if calling, written in first person as the parent or household; if needed is false, null",
    "translated": "the same draft, in ${targetLang}, natural for someone speaking it aloud or writing it; null if needed is false"
  },
  "glossary": [
    {"term": "a jargon word or phrase that appears in the document and needs explaining (e.g. 'deductible', 'EOB', 'lapse')", "plain_en": "one simple sentence defining it", "plain_translated": "the same definition in ${targetLang}"}
  ]
}

The reader already knows these terms and how they were previously explained — do not include them in glossary again unless the document uses them in a meaningfully different way: ${knownTerms && knownTerms.length ? knownTerms.join(', ') : 'none yet'}.

Keep every field genuinely simple — this is being read aloud to someone who may have low literacy or no English at all. Be accurate; do not invent details not present in the document(s). If a field doesn't apply, use null rather than guessing.

Length limits, strictly enforced: one_line_summary, key_line, explanation_en, explanation_translated are each 1-3 sentences maximum. next_step_en and next_step_translated are each one sentence. draft_reply.en and draft_reply.translated are each 3-6 sentences maximum when present. Include at most the 4 most important glossary terms, even if more jargon appears — pick the ones a parent most needs to understand this specific document. If the document is dense (legal notices, multi-paragraph violations, itemized bills) or spans several pages, summarize and prioritize rather than trying to capture every clause.`;
}

// Both Gemini (with responseMimeType: 'application/json') and the
// OpenAI-compatible providers below are asked for raw JSON, but Groq/
// OpenRouter models sometimes wrap it in a markdown code fence anyway —
// this strips that before parsing.
function extractJson(text) {
  if (!text) throw new Error('No text in model response');
  const cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

// `images` is an array of { data, mediaType }, one entry per page, in order.
async function callGemini(apiKey, systemPrompt, images, terse) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const imageParts = images.map(img => ({ inline_data: { mime_type: img.mediaType, data: img.data } }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt + (terse ? TERSE_SUFFIX : '') }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            ...imageParts,
            { text: images.length > 1 ? `Analyze this ${images.length}-page document.` : 'Analyze this document.' }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json' // Gemini enforces valid JSON output directly, no markdown fences to strip
      }
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('No response from model');
  if (candidate.finishReason === 'MAX_TOKENS') throw new Error('Response was cut off before finishing');

  const text = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  return extractJson(text);
}

// Shared caller for any OpenAI-compatible chat/completions endpoint (Groq,
// OpenRouter, and — if you add one later — most other free/cheap
// providers use this exact same shape). `images` is an array of
// { data, mediaType }, one entry per page, in order.
async function callOpenAICompatible({ baseUrl, apiKey, model, extraHeaders, label }, systemPrompt, images, terse) {
  const imageContent = images.map(img => ({
    type: 'image_url',
    image_url: { url: `data:${img.mediaType};base64,${img.data}` }
  }));

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(extraHeaders || {})
    },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt + (terse ? TERSE_SUFFIX : '') + '\n\nRespond with ONLY the raw JSON object — no markdown code fences, no commentary before or after it.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: images.length > 1 ? `Analyze this ${images.length}-page document.` : 'Analyze this document.' },
            ...imageContent
          ]
        }
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)));

  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error('No response from model');
  if (choice.finish_reason === 'length') throw new Error('Response was cut off before finishing');

  const text = choice.message && choice.message.content;
  return extractJson(text);
}

function buildProviderChain() {
  const chain = [];

  GEMINI_KEYS.forEach((key, i) => {
    const name = `Gemini${GEMINI_KEYS.length > 1 ? ` (key ${i + 1}/${GEMINI_KEYS.length})` : ''}`;
    chain.push({ name, call: (sp, imgs, terse) => callGemini(key, sp, imgs, terse) });
  });

  GROQ_KEYS.forEach((key, i) => {
    const name = `Groq${GROQ_KEYS.length > 1 ? ` (key ${i + 1}/${GROQ_KEYS.length})` : ''}`;
    chain.push({
      name,
      call: (sp, imgs, terse) => callOpenAICompatible(
        { baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKey: key, model: GROQ_MODEL, label: 'Groq' },
        sp, imgs, terse
      )
    });
  });

  OPENROUTER_KEYS.forEach((key, i) => {
    const name = `OpenRouter${OPENROUTER_KEYS.length > 1 ? ` (key ${i + 1}/${OPENROUTER_KEYS.length})` : ''}`;
    chain.push({
      name,
      call: (sp, imgs, terse) => callOpenAICompatible(
        {
          baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: key,
          model: OPENROUTER_MODEL,
          // OpenRouter asks for these on free-tier requests; harmless if ignored.
          extraHeaders: { 'HTTP-Referer': 'https://github.com/relay-app', 'X-Title': 'Relay' },
          label: 'OpenRouter'
        },
        sp, imgs, terse
      )
    });
  });

  return chain;
}

// ---------------------------------------------------------------------
// Small in-memory result cache
// ---------------------------------------------------------------------
// Keyed on a hash of the exact images + target language + known terms.
// This protects your (shared, free-tier) API keys from burning quota if
// the same document gets analyzed twice in a row — e.g. a judge hitting
// "Analyze" again after the page reloads, or you re-testing the same
// sample document. Not meant as a real cache layer, just cheap insurance
// for a demo. Resets whenever the server restarts.
const CACHE_MAX_ENTRIES = 30;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const resultCache = new Map(); // key -> { result, expiresAt }

function cacheKeyFor(images, targetLang, knownTerms) {
  const hash = crypto.createHash('sha256');
  images.forEach(img => hash.update(img.mediaType).update(img.data));
  hash.update(targetLang).update((knownTerms || []).slice().sort().join(','));
  return hash.digest('hex');
}

function getCached(key) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resultCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCached(key, result) {
  if (resultCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    resultCache.delete(oldestKey);
  }
  resultCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------
// Lightweight per-IP rate limiting
// ---------------------------------------------------------------------
// A CAC demo URL is public. This isn't meant to stop a determined abuser,
// just to keep one runaway client (a bug, a bot, someone mashing the
// button) from single-handedly burning through your shared free-tier
// quota before a judge gets to try it. Tune with env vars if needed.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000; // 10 min
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 30; // requests per window per IP
const rateLimitHits = new Map(); // ip -> [timestamps]

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const hits = (rateLimitHits.get(ip) || []).filter(t => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests from this device right now. Wait a few minutes and try again.' });
  }
  hits.push(now);
  rateLimitHits.set(ip, hits);

  // Occasionally sweep old IPs so this map doesn't grow forever on a
  // long-running server.
  if (rateLimitHits.size > 500) {
    for (const [k, v] of rateLimitHits) {
      const fresh = v.filter(t => t > windowStart);
      if (fresh.length === 0) rateLimitHits.delete(k);
      else rateLimitHits.set(k, fresh);
    }
  }

  next();
}

// Accepts either the new multi-page shape ({ images: [{ image_base64, media_type }, ...] })
// or the original single-image shape ({ image_base64, media_type }), so older
// clients or saved requests keep working unchanged.
function normalizeImages(body) {
  let raw;
  if (Array.isArray(body.images) && body.images.length) {
    raw = body.images;
  } else if (body.image_base64 && body.media_type) {
    raw = [{ image_base64: body.image_base64, media_type: body.media_type }];
  } else {
    return { error: 'Missing image(s). Provide "images": [{ image_base64, media_type }, ...] or the single-image image_base64/media_type fields.' };
  }

  if (raw.length > MAX_PAGES) {
    return { error: `Too many pages — Relay supports up to ${MAX_PAGES} pages per document.` };
  }

  const images = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] || {};
    const data = item.image_base64 || item.data;
    const mediaType = item.media_type || item.mediaType;
    if (!data || !mediaType) {
      return { error: `Page ${i + 1} is missing image_base64 or media_type.` };
    }
    if (!/^image\//.test(mediaType)) {
      return { error: `Page ${i + 1} has an unsupported media_type ("${mediaType}") — expected an image/* MIME type.` };
    }
    images.push({ data, mediaType });
  }
  return { images };
}

app.post('/api/analyze', rateLimit, async (req, res) => {
  const chain = buildProviderChain();
  if (chain.length === 0) {
    return res.status(500).json({
      error: 'Server has no working API key configured. Add at least one of GEMINI_API_KEYS, GROQ_API_KEY, or OPENROUTER_API_KEY to your .env file (see .env.example) and restart the server.'
    });
  }

  const { target_lang, known_terms } = req.body;
  if (!target_lang) {
    return res.status(400).json({ error: 'Missing target_lang in request.' });
  }

  const { images, error: imagesError } = normalizeImages(req.body);
  if (imagesError) {
    return res.status(400).json({ error: imagesError });
  }

  const cacheKey = cacheKeyFor(images, target_lang, known_terms);
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const systemPrompt = buildSystemPrompt(target_lang, known_terms, images.length);
  const errors = [];

  for (const provider of chain) {
    for (const terse of [false, true]) {
      try {
        const result = await provider.call(systemPrompt, images, terse);
        if (errors.length) {
          console.warn(`Relay: recovered via ${provider.name}${terse ? ' (terse retry)' : ''} after ${errors.length} earlier failure(s): ${errors.join(' | ')}`);
        }
        setCached(cacheKey, result);
        return res.json(result);
      } catch (err) {
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        const msg = `${provider.name}${terse ? ' terse retry' : ''}: ${timedOut ? 'timed out' : err.message}`;
        console.warn('Relay attempt failed —', msg);
        errors.push(msg);
      }
    }
  }

  console.error('Relay: every provider in the chain failed.', errors);
  return res.status(500).json({
    error: `Couldn't reach any AI provider right now. Try a clearer, well-lit photo, or try again in a minute. (${errors[errors.length - 1] || 'unknown error'})`
  });
});

// Quick way to check, from a browser or curl, whether the deployed server
// has any provider configured at all — handy right after a Render deploy,
// before you've fed it a real document. Never returns key values.
app.get('/api/health', (req, res) => {
  const chain = buildProviderChain();
  res.json({
    ok: chain.length > 0,
    providers: chain.map(p => p.name),
    max_pages: MAX_PAGES
  });
});

// Payloads over the express.json limit (e.g. too many/too large pages)
// land here instead of crashing the process.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That document is too large to upload — try fewer pages or smaller photos.' });
  }
  console.error('Unexpected server error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Relay server running at http://localhost:${PORT}`);
  const chain = buildProviderChain();
  if (chain.length === 0) {
    console.warn('WARNING: no API keys configured. Analysis requests will fail until you add at least one to .env — see .env.example.');
  } else {
    console.log(`Provider chain (${chain.length}): ${chain.map(p => p.name).join(' -> ')}`);
  }
});
