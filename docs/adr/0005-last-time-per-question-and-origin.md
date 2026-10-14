# 5. Last Time is remembered per Question and per Origin

Date: 2026-10-13

## Status

Accepted

## Context

The Answered Set says a Question has been seen, but not when. A player coming back after a week
cannot tell which Categories, quizzes and Questions they had already walked through, so the
"Answered before" badge is all-or-nothing: it hides what is stale and what is recent.

A date is also the only honest way to answer "did I already play this quiz?" — the badge cannot
distinguish three days from three months.

## Decision

Memory gains two timestamp maps, alongside the existing `a` (Answered Set) and `b` (Best Scores):

- `t` — Question id → epoch ms of the last time that Question was answered;
- `s` — the existing Best Score key (`q:<quizIdx>`, `c:<lvl>`, `c:<lvl>|<cat>`) → epoch ms of the
  last session started from that Origin.

They live in the same `localStorage` value `kwizzy.v1`, and are optional: an older payload without
them loads unchanged and the maps start empty. No migration, no version bump.

Recording is one line each in the existing play loop: `touchQuestion` beside `markAnswered`, and
`touchOrigin` once per session in `startSession`. A session reads its own previous visit
(`session.prevLast`) **before** stamping the new one, so a run never reports itself as its own past.

Displayed, in words, at the four places that answer "have I been here":

- the Categories grid card — "Last played" (most recent quiz of the Category) and "Last question
  seen" (most recent Question of it), as dates;
- a quiz row in an opened Category sheet — a `last <date>` chip beside the question count;
- the Play HUD line — "Last played <date>" or, in words, "never played here";
- the question card head — "Last played yesterday", relative because the card is read while playing;
- the summary — "Last played before: 5 days ago", or "First time this Origin is played."

A Category shows the most recent visit inside it, never a count of visits.

## Consequences

- Absent is the only "never", and it is said in words where the space allows ("never played here",
  "First time this Origin is played."); elsewhere it is simply the absence of a line. That absence
  is a visual signal, not only Juice, so it survives `prefers-reduced-motion` and a screen reader —
  see ADR 0004.
- A `.today` variant warms a stamp to gold when the previous visit was the same day. It changes the
  colour of the same words, never replaces them.
- Relative wording ("3 days ago") is used where the player is deciding whether to replay; absolute
  dates (`YYYY-MM-DD`, locale-neutral and sortable) where the row is compact or scanned.
- `mem.t` grows with every question ever answered (≈ the Answered Set size), so the value stays
  proportional to what `a` already costs; no new storage order of magnitude.
- Reset memory erases `t` and `s` with `a` and `b`, so the About Screen's promise ("this erases
  every best score and the Answered Set") now also erases the Last Times; the legend says so.
- This is additive memory, not a change to the frozen quiz logic of ADR 0003: the draw, the scoring
  and the Best Score keys are untouched. Nothing reads `t` or `s` to decide what to play.
