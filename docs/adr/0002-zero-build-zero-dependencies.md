# 2. Zero build, zero dependencies

Date: 2026-02-14

## Status

Accepted

## Context

Kwizzy is a static site deployed to GitHub Pages by pushing files. There is no CI, no bundler, no
package manager and no lockfile. The app is three files — `index.html`, `style.css`, `app.js` — plus
`corpus.json` and `media/`.

The redesign adds a Screen router, a particle system, and a large amount of animation. The reflex
for that kind of work is to reach for a framework and a bundler. That would be the first dependency
this project has ever had, and it would put a toolchain between editing a file and seeing the change
in a browser.

## Decision

Stay zero-build and zero-dependency. No npm, no bundler, no framework, no runtime library. Plain
ES5-compatible `app.js` loaded with a `<script>` tag, one `style.css`, hand-written canvas for
particles, hand-written CSS for animation.

"Juicy" is CSS keyframes and `requestAnimationFrame`. It does not require a framework.

## Consequences

- Deploying is `git push`. There is no build step to break or to keep in sync with the source.
- Any file can be opened and understood without knowing a toolchain. The whole app is readable in
  one sitting, which is what makes the corpus and play logic easy to trust.
- Everything is written by hand that a library would have provided. This is accepted: the surface
  needed here (a router over five Screens, one canvas) is small.
- The code must stay in the ES5 style the file already uses — no bundler means no transpilation
  step, and the browser is trusted to run what is written. Modern syntax is available in every
  browser Kwizzy targets, but consistency with the existing 800 lines is worth more than the
  marginal ergonomics of rewriting them.
