# 7. Fullscreen asks the browser, it does not fake the effect

Date: 2026-10-16

## Status

Accepted

## Context

The player asked for fullscreen, in words: "the browser fill screen functionality (hide top
bar, etc...)". The first version of the button only toggled a CSS class that widened the layout
column (`.fs` → `--measure`). That is a different thing: it cannot remove what the browser draws
outside the page — the URL bar, the tab strip, the phone's top bar — because that chrome is not
part of the document and no CSS can reach it.

The browser does have the real thing: the **Fullscreen API**, `documentElement.requestFullscreen()`,
which promotes the page to the top layer over the whole screen and hides the chrome. caniuse
lists it as supported on Chrome/Edge/Firefox desktop and Android, "partial" on Safari on iOS.
Partial is not cosmetic: in the browser this app is actually served and tested in, the API is
half-present — measured on a scratch page:

- `documentElement.requestFullscreen` **is** a function, and calling it does not throw; a
  `fullscreenchange` event fires;
- `documentElement.exitFullscreen` is **undefined** — `TypeError: ... is not a function`;
- `documentElement.isFullscreen` is **undefined**, not a boolean.

So a first cut that calls `exitFullscreen` on the element and assumes `isFullscreen` reads back
gives a one-way door: entering works once, leaving throws, the fallback branch then re-applies the
CSS column while the page is still on the browser's top layer, and a second click cannot undo it.
That is exactly what the player reported: "it works but only once and doesn't leave fullscreen".

## Decision

**Ask the browser for what the player asked for, and keep the CSS column as the fallback — with
the two halves of the API looked up on the objects they actually live on.**

- `requestFullscreen()` is a method of the **element**; `exitFullscreen()` is a method of the
  **document**. The gate `fsSupported()` requires BOTH halves to exist: a browser that can enter
  but not leave is treated as a browser that cannot do fullscreen at all, so it never gets the
  one-way door. (Measured: `document.exitFullscreen()` runs and a `fullscreenchange` fires right
  after it, while `documentElement.exitFullscreen` stays undefined.)
- `isFullscreen` is **not trusted when it is not a boolean**. Chromium fires `fullscreenchange`
  and leaves the property undefined, so the listener that follows the browser's own exits
  (Firefox answers Escape) ignores anything it cannot read; a blind toggle there would undo the
  request the button just made.
- The CSS class `.fs` is applied in **both** cases, so the layout fills the new screen when the
  API works and is the whole effect when it does not.
- When the request is refused or unavailable, the toast says which of the two the player is
  getting ("the page takes the whole screen, browser bar included" vs "this browser will not let
  a page take the full screen — the layout fills it instead"). ADR 0004's rule — never let colour
  or an icon alone carry a state — applies to a capability too: the button must not look identical
  whether or not the browser actually obliged.

## Consequences

- The toggle is now round-trip: enter, exit, re-enter, verified in the served app by clicking the
  fixed corner button three times.
- A browser that only has the CSS fallback keeps working; it just fills less. The player is told
  which case they are in, so "fullscreen" never silently means something weaker than they asked
  for.
- The browser can still leave fullscreen without us (Escape on desktop Chrome/Firefox); the
  `fullscreenchange` listener keeps `.fs` and the button's `on` class in step when the read-back
  is a real boolean.
- The Fullscreen API is refused in iframes without `allow="fullscreen"` and in some browsers
  outright — this app is served at a top-level page, which is why the request is not wrapped in
  anything more than the try/catch.
