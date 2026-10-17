# Kwizzy — Context

Glossary of the language this project uses. Terms only; no implementation.

## The corpus

**Corpus** — the local, offline copy of every question Kwizzy can play. Shipped as a file next to
the app; the app is useless until the Corpus has loaded.

**Source** — one of the three public quiz sites the questions were gathered from: `quizo`,
`connaisseances`, `openquizzdb`. Every Quiz belongs to exactly one Source.

**Category** — a topic label on a Quiz and on each of its Questions (e.g. *Art*, *Logos*,
*Monuments*). A Quiz has exactly one Category; its Questions may differ from it.

**Level** — how hard a Quiz or a Question is: `facile`, `moyen`, `difficile`, or `test`. A Question
may also be **Unleveled**, meaning it carries no Level of its own.

**Effective Level** — the Level actually used when filtering. An Unleveled question is treated as
`moyen`. This is deliberate: Unleveled questions are playable, never discarded.

**Question** — a four-option multiple-choice item: a prompt, exactly four options, one correct
option, an optional explanation, and an optional image. Questions are identified by a stable id.

**Quiz** — a named, ordered set of Questions as published by one Source. Distinct from a play
session.

**Answered Set** — the set of Question ids the player has already answered, remembered in the
browser. Drives the "Answered before" badge and the fresh-first draw.

**Badged** — a Question that is in the Answered Set.

**Best Score** — the highest score ever reached for one Origin, remembered in the browser.

**Origin** — what a play session was started from, and the unit a Best Score is kept against.
Either a **Source Quiz** (one Quiz) or a **Custom Quiz** (a Level, plus an optional Category).

**Last Time** — when something was last played, remembered in the browser: per Question and per Origin.
Absent means never played, and that absence is the signal — a quiz, Category or Question with no
"Last played" stamp has never been played. A Category shows the most recent visit inside it.

## Playing

**Custom Quiz** — a play session of 20 Questions drawn from the Corpus by Level and optional
Category, preferring fresh Questions and topping up with Badged ones. The same Question is never
drawn twice into one Custom Quiz.

**Random 20** — the player-facing name for starting a Custom Quiz.

**Source Quiz** — a play session of one Quiz's Questions, in a shuffled order.

**Difficulty** — the Level the player picks before choosing what to play. Only `facile`, `moyen`
and `difficile` are offered as a Difficulty; `test` is reachable only by playing a Source Quiz that
carries it.

**Filter** — a narrowing of what is offered when picking a Source Quiz, by Source, by Level, or by
Category. Filters never exclude a Question from a Custom Quiz. The Level filters start from the
Difficulty picked on the Choice Screen — only it is on — and the player can toggle any of them back
on; Test and Unleveled start on, since neither is a Difficulty a player can pick.

## Screens

**Screen** — one full-viewport step of the app that the player is on; the player is on exactly one
Screen at a time.

**Title Screen** — the entry Screen: the Kwizzy logo and the way into play.

**Choice Screen** — the Screen where the player picks a Difficulty and picks how to play: Random 20,
or an existing Source Quiz.

**Categories Screen** — the Screen that lists Categories and lets the player narrow them by Filter,
then either start a Random 20 within a Category or open a Source Quiz.

**Play Screen** — the Screen holding the running session: the running score, the stack of Questions
already answered, and the final summary.

**About Screen** — the Screen holding credits for the three Sources and the memory tools.

**Juice** — deliberate, non-essential feedback that makes an action feel good: shake, pop, glow,
particle burst, easing. Juice never carries meaning on its own; anything a player must understand is
also said in text.

## Sound

**Sound** — the short feedback clips of the interface: the tick on a tap, the pip when the highlight
moves, the whoosh on Validate, the rising and falling verdicts, the swell under a Screen change.
Distinct from Music: either can be on without the other.

**Music** — the ambient tracks played under everything else, one at a time, always looping. Loaded
at startup, and the player can turn it off.

**Track** — one ambient file in `media/music`, named by a lowercase id (`light_ambient`). A Track
loops on its own; the Music menu can pick one, or pick **All**.

**All** — the default Music choice: the Tracks play in a random order that always opens on
`light_ambient` (the startup Track), each one repeated three times, then the next fades in while the
previous fades out. The order is reshuffled per visit.

**Play count** — how many times the current Track has been played through in the current round of
**All**. At three, the next Track of the order is reached. A single picked Track has no Play
count — it simply loops.

**Haptics** — the short vibration on taps and answers, where the device can do it. Absent on some
devices, and then the setting is shown greyed out rather than hidden.

**Settings** — the player's Sound, Music, Haptics and Music-choice preferences, remembered in the
browser. Separate from Memory: they say how the app behaves, not what has been played, so Reset
memory never touches them.
