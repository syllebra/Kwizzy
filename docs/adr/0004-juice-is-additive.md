# 4. Juice is additive and never carries meaning alone

Date: 2026-02-14

## Status

Accepted

## Context

The redesign targets "juicy" game feel: shake on every button press, particle bursts on correct
answers, floating logos, glowing chips, a sheen sweeping across primary buttons. All of it is
decoration.

Decoration becomes a problem the moment it is the only signal for something. A screen-shake that
means "wrong answer" is invisible to a player who has motion sensitivity turned off, and to anyone
using a screen reader. An animated chip ring is not a selected state.

## Decision

Juice is additive: it amplifies a message that is already stated plainly, and it never carries a
message on its own.

- Every piece of feedback that matters is also text or a static visual change. A wrong answer shows
  the verdict "Not quite" in red *and* shakes; a correct one shows "Correct" *and* bursts.
- `prefers-reduced-motion: reduce` removes movement but keeps the look and every word. The aurora
  still glows, the particle canvas is removed, and animations collapse to their end state.
- Decorative layers are `aria-hidden="true"` — the aurora, the grid, the particle canvas, the burst
  container.
- Particle bursts are created per interaction and remove themselves; nothing accumulates in the DOM.

## Consequences

- The game is fully playable and fully legible with all motion disabled. This is a constraint on
  every future effect: it has to degrade to a still frame that still reads.
- Juice can be tuned or removed freely without breaking comprehension, which makes it safe to dial
  down on low-end devices later.
- Some effects are deliberately not the sole carrier of a state, so the UI can feel slightly
  redundant to a sighted player ("Correct" plus a burst). That redundancy is the point.
