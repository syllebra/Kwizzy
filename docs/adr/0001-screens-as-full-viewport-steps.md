# 1. Screens as full-viewport steps, one at a time

Date: 2026-02-14

## Status

Accepted

## Context

Kwizzy was one long scrolling page: a brand header, a launcher card, then a "Browse by Category"
grid of every Category, then credits. On a desktop browser that reads fine. On a phone it does not:
picking a Difficulty and picking what to play are two separate decisions stacked vertically, the
Category grid is long enough to be its own destination, and the play session had to hide the whole
page behind a `display:none` toggle anyway — the code already treated play as a distinct mode
(`body[data-kwizzy="play"]`).

The redesign targets mobile web as a game. That means each decision should own the screen, and
moving between decisions should be a visible event the player can feel.

## Decision

The app is a set of **Screens**, each a full-viewport step. The player is on exactly one Screen at a
time, selected by a single attribute on `<body>` (`data-screen`). Only the active Screen is
displayed; every other Screen is inert and hidden.

Screens are: Title, Choice, Categories, Play, About. Navigation is explicit — forward through the
main flow, and a back affordance on every Screen that has a way back.

We do **not** use client-side routing (no hash, no History API). The Screen is not a URL.

## Consequences

- Each Screen owns its own entrance animation, background treatment and scroll context. No Screen
  needs to defend against another Screen's layout.
- The existing play loop, which already assumed exclusive control of the viewport, keeps working
  unchanged.
- The browser Back button does not navigate between Screens. This is a real cost on mobile web,
  where Back is a primary affordance; the in-app back control is the mitigation, and adopting the
  History API later is a contained change because all Screen changes funnel through one function.
- Deep links into a Screen are not possible. Nothing in the product needs them.
