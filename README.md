# Kwizzy — quiz corpus player

Static, mobile-first web app that plays the merged kwizzy corpus: **865 quizzes / 5 566 four-option
MCQ questions** scraped from quizo.fr, connaisseances.com and openquizzdb.org.

Live: https://syllebra.github.io/Kwizzy/ — the app itself is in `web/` (`web/index.html`).

## What it is

Pure static site — `web/index.html` + `web/app.js` + `web/style.css` + `web/corpus.json` (slim
payload, 1.8 MB) + `web/media/` (132 question images, 5.8 MB). No server, no account: all player
memory (the Answered Set of question ids, the best Scores per Source Quiz and per Custom Quiz
Level/Category) lives in `localStorage` of your browser. Nothing is sent anywhere. The root
`index.html` only points to `web/`.

Two ways to play:

* **Custom Quiz** — 20 questions drawn from the pool filtered by a mandatory Level and an optional
  Category, preferring questions you have never answered (topped up with badged ones if needed).
* **Source Quiz** — a quiz as published by its original site, from the Category library.

## Build

The payload is generated from the merged corpus by `build_web.py` (in the `kwizzy/` project folder):

```
python3 kwizzy/build_web.py     # -> kwizzy/web/corpus.json + kwizzy/web/media/
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
