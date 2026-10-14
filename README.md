# Kwizzy — quiz corpus player

Static, mobile-first **game-style** web app that plays the merged kwizzy corpus: **865 quizzes /
5 566 four-option MCQ questions** scraped from quizo.fr, connaisseances.com and openquizzdb.org.

Live: https://syllebra.github.io/Kwizzy/ — the app is at the repository root (`index.html`).

## What it is

Pure static site — `index.html` + `app.js` + `style.css` + `corpus.json` (slim payload, 1.8 MB) +
`media/` (132 question images plus the title logo, 5.8 MB). No server, no build, no dependencies,
no account: all player memory (the Answered Set of question ids, the best Scores per Source Quiz
and per Custom Quiz Level/Category) lives in `localStorage` of your browser. Nothing is sent
anywhere.

The interface is a set of full-viewport **Screens** — the player is on exactly one at a time:

1. **Title** — the neon logo, animated background, and the way in.
2. **Choice** — pick a Difficulty (Facile / Moyen / Difficile), then Random 20 or Existing quiz.
3. **Categories** — narrow by Category (the optional part of Random 20) or by Source/Level filters
   when browsing existing quizzes.
4. **Play** — the running session and its summary.
5. **About** — sources, credits, and the memory tools.

Two ways to play:

* **Random 20** (a Custom Quiz) — 20 questions drawn from the pool filtered by a mandatory Level and
  an optional Category, preferring questions you have never answered (topped up with badged ones if
  needed).
* **Existing quiz** (a Source Quiz) — a quiz as published by its original site.

## Design & docs

* [`CONTEXT.md`](CONTEXT.md) — the glossary: what Corpus, Source, Quiz, Question, Level, Origin,
  Screen and Juice mean in this project.
* [`docs/adr/`](docs/adr/) — why the Screens are full-viewport steps, why there is no build step,
  and why the quiz logic was frozen during the visual rebuild.

## Build

There is none. Edit the files, push, done.

The payload is generated from the merged corpus by `build_web.py` (in the `kwizzy/` project folder,
outside this repo):

```
python3 kwizzy/build_web.py     # -> corpus.json + media/
```

`corpus.json` shape (documented at the top of `app.js`):

```
quizzes[i] = [label, catIdx, lvlIdx(-1 unleveled), srcIdx, play_url, n_questions]
q[i]       = [id, quizIdx, position, lvlIdx, srcIdx, catIdx,
              question, [options], correctIdx, explanation, img, imgAlt]
```

## Rights

* **openquizzdb.org** — CC BY-SA 4.0, "OpenQuizzDB (c) Philippe Bresoux". Reuse is invited, keep the
  attribution and the licence.
* **quizo.fr** — content and layout are Quizo's property; the quiz photos are Wikimedia Commons
  files under free licences.
* **connaisseances.com** — the site's own property; the pages declare `isAccessibleForFree: true`
  and publish a schema.org `Quiz` object, which is what was scraped.

Kwizzy is an unofficial player: it re-hosts the questions locally for offline play and links back to
each original quiz.
