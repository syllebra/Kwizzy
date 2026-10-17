# 6. Audio and haptics are player choices, kept apart from game memory

Date: 2026-10-15

## Status

Accepted

## Context

The app makes noise (UI ticks, answer sounds, screen swells) and buzzes (haptics), and it now plays
ambient music. A player needs to be able to turn each of those off, and to choose what the music is
— on the bus, in a library, at night. Those are choices about how the app behaves, not about what
the player has played, so they cannot live in the Answered Set.

Two things make the feature non-trivial:

1. **Browsers refuse to start audio before the page has been interacted with** (the autoplay
   policy). "Load a track at startup" cannot be taken literally by `play()` alone.
2. **The music rules are a small state machine with timing**: a track repeats a fixed number of
   times, then the next one fades in under it. Timing lives in the audio engine, which is hard to
   assert; the rules should not.

## Decision

**Player choices live in their own key.** `localStorage kwizzy.settings.v1` holds
`{sfx, music, haptics, track}`; game memory stays in `kwizzy.v1` (ADR 0005). "Reset memory" clears
what you played and never how the app sounds. Every field is read with a forgiving default
(`x !== false`, and an unknown `track` falls back to `all`), so a partial, corrupt or stale value
loads as a working configuration instead of none.

**Three switches, three separate things.** Sound effects, Music and Haptics are independent: the
settings drawer shows each one's state on the row (`.on`) and states it in words
(`role="switch"` + `aria-checked`), so the state never rests on colour alone (ADR 0004). Haptics
greys out where `navigator.vibrate` does not exist and says so, instead of silently doing nothing.
Music greys out where there is no Web Audio.

**The rules are a pure module; the engine is not.** `media/music/playlist.js` is the whole
"what plays next" decision — the random order, the three repeats, the single-track loop — with no
DOM, no `Audio` and no timer, and it is tested on its own
(`media/music/playlist.test.js`, `node media/music/playlist.test.js`, no framework). It is loaded
as a plain `<script>` before `app.js` and exposes `window.KwizzyPlaylist`; the same file is
`require()`d by its test, so one source of truth and still no build step (ADR 0002).
`app.js` owns the parts that cannot be pure: Web Audio, the fades, and the play counter's
feed from the source's `ended` event.

**Playback is Web Audio, not `<audio>`.** The volume has to be ramped (fade in, fade out, and the
crossfade the music choice promises), and only a `GainNode` can do that. Each track is fetched and
decoded **once** and held, so a repeat or a track change costs no request and starts immediately.
One `AudioBufferSourceNode` per play, wired through its own gain to a master gain that carries
every fade; a crossfade is that master pulled down while the new source starts from silence, which
is why the two tracks can be handed over with no dip.

**The panel says which of the two it is, never a silent lie.** The `AudioContext` is created at
boot (it may be born suspended) and the first track is fetched and played immediately; if the
engine refuses, the play is retried on the first tap or key press, which is a user gesture and does
unlock it, and if the track cannot be fetched the panel says so rather than "waiting for a tap".

**The startup track is a fixed promise, the rest is a shuffle.** `light_ambient` is the track the
app is asked to open on, so the "All" order always puts it first and shuffles the remaining four
after it; each later round reshuffles. That way a first visit always opens on the ambient track,
and the "random order" the choice promises is still what follows it.

**Naming and loading.** The tracks were renamed to lowercase, URL-safe ids that read as code
(`light_ambient.mp3`, `arcade_quiz_02.mp3`, `jazzy_lounge_01..04.mp3`): the originals carried
spaces, `#` and double underscores, which need percent-encoding in a URL and are easy to mistype
in a `src`. `serve.js` — the throwaway local-network server — also pins `.mp3: audio/mpeg`, since a
wrong content type is one of the ways a browser refuses to decode.

## Consequences

- The music engine is verified by `media/music/_harness/run.js`, which loads the **real** `app.js`
  in Node against a fake DOM and a fake Web Audio engine and drives the real UI (98 checks: the
  drawer, the switches, three plays then a crossfade, a single tracked looping, fade-out and stop,
  persistence, a corrupt saved choice, a device that cannot vibrate, media that will not load).
  It is a development tool, not shipped code.
- Fuzzy boundaries are covered on purpose: a corrupt settings blob, an unknown track id, a
  `localStorage` that throws, and a track that 404s all leave a working app.
- `Music` keeps decoded buffers for the life of the page: about 1.2 MB per track at 8 minutes of
  the current files, which is small next to `corpus.json` and buys instant switching.
- The music continues across Screens — an `AudioContext` is not attached to a DOM node — but the
  drawer closes when the Screen changes, because it belongs to the Screen it was opened on.
- Adding a track is one entry in `playlist.js` TRACKS; nothing in the engine is per-track.
