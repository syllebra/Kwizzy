# 3. The quiz logic is frozen during the visual rebuild

Date: 2026-02-14

## Status

Accepted

## Context

The task is to rebuild the interface as a mobile-first game. The interface and the play logic are
entangled in `app.js`: the same file that draws the cards also decides which Questions a Custom Quiz
draws, how Best Scores are keyed, and how the Answered Set is persisted.

Rewriting the interface while also touching that logic would mean a bug in the visuals and a bug in
the draw are indistinguishable, and the corpus is the one thing here that cannot be regenerated from
the repo alone.

## Decision

The quiz logic is frozen. Specifically, all of the following keep their current behaviour and their
current on-disk shapes:

- the `corpus.json` shape and the indexing built from it;
- the Custom Quiz draw: filter by Effective Level and optional Category, deduplicate by normalised
  prompt text, fresh Questions first, top up with Badged ones, 20 Questions;
- the Best Score keying: `q:<quizIdx>` for a Source Quiz, `c:<lvl>` or `c:<lvl>|<cat>` for a Custom
  Quiz;
- the `localStorage` key `kwizzy.v1` and its `{a, b}` shape, so existing player memory survives the
  redesign;
- the play loop's order of operations: ask, grade, count, mark answered, update HUD, countdown,
  next.

Only the presentation changes: markup, classes and CSS. New state (current Screen, chosen
Difficulty) is additive and never rewrites the above.

## Consequences

- A player who has already built up memory keeps it. No migration, no reset prompt.
- Any behavioural change to the draw or the scoring is out of scope and must be raised separately,
  not smuggled in with a styling change. Several existing quirks (the Effective Level remap, the
  fixed reveal delay) are therefore preserved even where they look improvable.
- The redesigned code must reach the frozen logic through the same function boundaries it has now.
  Where a Screen needs a new entry point (e.g. starting a Random 20 from the Categories Screen), it
  calls the existing launcher rather than reimplementing the draw.
