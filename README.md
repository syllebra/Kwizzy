# Kwizzy — quiz corpus player

Static, mobile-first **game-style** web app that plays the merged kwizzy corpus: **865 quizzes /
5 566 four-option MCQ questions** scraped from quizo.fr, connaisseances.com and openquizzdb.org.

Live: https://syllebra.github.io/Kwizzy/ — the app is at the repository root (`index.html`).

## What it is

Pure static site — `index.html` + `app.js` + `style.css` + `corpus.json` (slim payload, 1.8 MB) +
`media/` (132 question images plus the title logo, 5.8 MB, and the ambient music). No server, no
build, no dependencies, no account: all player memory (the Answered Set of question ids, the best
Scores per Source Quiz and per Custom Quiz Level/Category) lives in `localStorage` of your browser.
Nothing is sent anywhere. Memory also keeps the **Last Time** of every Question and every Origin,
and shows it — on the Category cards, the quiz rows, the score line, each question card and the
summary — so a missing "Last played" stamp means never played.

The interface is a set of full-viewport **Screens** — the player is on exactly one at a time:

1. **Title** — the neon logo, animated background, and the way in.
2. **Choice** — pick a Difficulty (Facile / Moyen / Difficile), then Random 20 or Existing quiz.
3. **Categories** — narrow by Category (the optional part of Random 20) or by Source/Level filters
   when browsing existing quizzes.
4. **Play** — the running session and its summary.
5. **About** — sources, credits, and the memory tools.

Two fixed corner buttons sit above every Screen: fullscreen, and the **burger** (sound & music).
Fullscreen asks the browser for its own fill-screen — the page takes the whole screen and the
browser's bar goes with it — and falls back to filling the layout when a browser will not let a
page do that (see ADR 0007).

## Sound, music and haptics

The burger opens a drawer with three switches — **Sound effects**, **Music**, **Haptic feedback** —
a **Music volume** slider, and the **Music choice**. Each choice is remembered in `localStorage` under `kwizzy.settings.v1`,
separately from the game memory, so "Reset memory" erases what you played without changing how the
app sounds. Haptics is greyed out, with the reason in words, where the device has no vibration;
Music is greyed out where the browser has no audio engine.

Music loads at startup and keeps playing across Screens. The choice is:

* **All** *(the default)* — every track in a random order, each one repeated **3 times**, then the
  next fades in while the previous fades out (a crossfade), looping round for as long as you play.
  The order always opens on `light_ambient`, the track the app loads at startup.
* **a single track** — that one track loops on its own and never moves on.

The five ambient tracks live in `media/music` (`light_ambient`, `arcade_quiz_02`,
`jazzy_lounge_01`, `jazzy_lounge_02`, `jazzy_lounge_04`). The rules above are a pure module,
`media/music/playlist.js`, loaded as a plain `<script>` and also `require()`d by its test; the
playback itself is Web Audio so the volume can be faded. Browsers refuse to start audio before the
page has been interacted with: the app tries at startup and, if it is refused, starts on your first
tap or key press.

Two ways to play:

* **Random 20** (a Custom Quiz) — 20 questions drawn from the pool filtered by a mandatory Level and
  an optional Category, preferring questions you have never answered (topped up with badged ones if
  needed).
* **Existing quiz** (a Source Quiz) — a quiz as published by its original site.

## Tests

Three throwaway-free checks, all plain Node, no dependencies, no build:

```
node media/music/playlist.test.js    # the music rules: random order, 3 plays, then the next track
node media/music/_harness/run.js     # the real app.js in a fake DOM: the drawer, the switches,
                                     # crossfade, persistence, corrupt/absent settings, no audio
node --check app.js                  # and syntax, like any file
```

The harness (under `media/music/_harness/`) is a development tool: it is committed next to the code
but is never loaded by the app — no page references it. It loads `app.js` unchanged against a small
fake DOM and a fake Web Audio engine, and drives the real UI.

## Design & docs

* [`CONTEXT.md`](CONTEXT.md) — the glossary: what Corpus, Source, Quiz, Question, Level, Origin,
  Screen, Juice, Track and All mean in this project.
* [`docs/adr/`](docs/adr/) — why the Screens are full-viewport steps, why there is no build step,
  why the quiz logic was frozen during the visual rebuild, and why audio and haptics are their own
  settings, kept apart from game memory.

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
