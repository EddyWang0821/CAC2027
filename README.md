# Relay

In millions of immigrant families, the family lawyer is 14 years old.

Try it live: cac2027.onrender.com (the free server sleeps after a while with no traffic, so the first load can take 30 to 60 seconds to wake up)

## The problem

If you grew up in an immigrant household, you've probably lived some version of this. Your parent hands you a letter from the insurance company, the school, the landlord, or the IRS, and looks at you to explain it. It isn't always about English fluency. The language of institutions is its own dialect. Deductibles. Adverse determinations. Notices of intent to lapse. Even fluent adults trip over this stuff. Now try doing it cold, out loud, in a second language, as a kid, while your parent's rent or health coverage depends on you getting it right.

This is called child language brokering, and it's common enough to be well documented. It's also barely designed for. Every translation app on the market is built for a tourist ordering food in Rome. None of them are built for a teenager standing in the kitchen holding three pages of insurance legalese, trying to figure out what actually matters and how to say it in Spanish without getting it wrong.

## What Relay does

Point your phone's camera at a document. Relay doesn't just translate it. It sorts through it the way a calm, patient adult would:

- What is this, really? A plain-English read on what kind of document it is and why it exists.
- Does it matter right now? An urgent, worth-a-look, or nothing-urgent flag, so a scary envelope doesn't cause panic when it's actually routine.
- What's the one thing that matters? The amount owed, the reason for a denial, the actual ask, pulled out from three paragraphs of filler.
- Is there a deadline? Flagged directly instead of buried in paragraph four.
- How do I explain this out loud? A short explanation in plain English and in the family's language, written to be spoken to a parent, not read like a legal memo.
- What do I actually say or send back? If a reply is needed, Relay drafts one. A real email, portal message, or phone script, in both languages, not a one-line suggestion.
- What if I don't understand a word? Jargon gets added to a running family glossary, so "deductible" gets explained the same way every time it comes up, across every document, for as long as the family needs it.

## Why this doesn't already exist

Every existing translation tool treats the parent as the user and the document as the whole problem. Relay treats the kid as the user, and the work of unpaid interpretation as the actual problem. That's the idea behind it. It's why the app looks less like Google Translate and more like a friend who already read the letter and is about to walk you through it.

## How it's built

Relay is a small full stack app on purpose: a plain HTML, CSS, and JS frontend, a Node and Express backend, no build step, no database. Easy to read, easy to run, easy to judge.

Most of the real engineering effort went into reliability. A Congressional App Challenge demo has to work the moment a judge clicks it, not most of the time. So instead of calling one AI provider and hoping, Relay tries a chain of them: multiple Gemini keys, then Groq, then OpenRouter, all with free tiers, and only reports failure if every one of them fails. There's a short timeout per provider so a stalled one doesn't hang the request, a small cache so repeat testing doesn't burn quota, and basic rate limiting so a public demo link can't get hammered dry before judging even starts.

The document analysis prompt is built to stay accurate and simple. Short sentences, no invented details, told directly to prioritize instead of trying to capture every clause of a dense legal notice, because whoever reads the output out loud might have limited literacy or no English at all.

## What's next

Relay is scoped down on purpose for this build. Here's what isn't in it yet:

- Multi-page documents. The backend can already read a multi-page letter as one document, but the camera still only takes one photo at a time. Adding an "add another page" flow is the next step.
- Accounts or syncing. Right now the family glossary lives in one browser's local storage, not shared across a household's devices.
- Offline mode. Everything currently needs a live connection to an AI provider.

None of this is a mystery to fix. It's scope, kept small enough to finish something solid instead of something sprawling.

## Try it yourself

The fastest way to understand Relay is to use it. Grab a real or redacted bill, notice, or letter, pick a language, and see what comes back. For local setup, deployment, and how the provider fallback works, see docs/DEVELOPMENT.md.
