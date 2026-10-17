/* Tests for the playlist rules the Music menu promises (see playlist.js):
     - "All" walks every track once per round, in a random order;
     - a track repeats exactly REPEATS times before the next one is reached;
     - picking a single track loops it and never advances.
   Run: node media/music/playlist.test.js   (no dependencies, no framework) */
"use strict";

const P = require("./playlist.js");

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log("  ok   " + what); }
  else { fail++; console.log("  FAIL " + what); }
}
function eq(a, b, what) { ok(a === b, what + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function group(name) { console.log("\n" + name); }

/* A deterministic shuffle so a failure is reproducible: a fixed pseudo-random stream. */
function seeded(seed) {
  let x = seed >>> 0;
  return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

group("the track set");
ok(P.TRACKS.length === 5, "five tracks are declared");
ok(P.ids().indexOf("light_ambient") >= 0, "light_ambient is one of them");
eq(P.label("all"), "All", 'the "all" choice is labelled All');
eq(P.label("light_ambient"), "Light ambient", "a track resolves to its menu label");
eq(P.label("nonsense"), "All", "an unknown saved choice falls back to All");
ok(P.validTrack("all") && P.validTrack("arcade_quiz_02") && !P.validTrack("nope"),
   "validTrack accepts all + known ids, rejects the rest");

group("shuffle");
{
  const a = P.shuffle([1, 2, 3, 4, 5], seeded(7));
  eq(a.length, 5, "nothing is lost");
  eq(a.slice().sort().join(","), "1,2,3,4,5", "the shuffle is a permutation");
  let moved = false;
  for (let seed = 1; seed <= 40 && !moved; seed++) {
    if (P.shuffle(P.ids(), seeded(seed)).join(",") !== P.ids().join(",")) moved = true;
  }
  ok(moved, "the order actually changes with the random stream");
}

group('the "All" order opens on the startup track');
{
  eq(P.FIRST, "light_ambient", "the startup track is declared as light_ambient");
  let always = true, alwaysPermutation = true, sawOthers = false;
  for (let seed = 1; seed <= 50; seed++) {
    const order = P.shuffleOrder(seeded(seed));
    if (order[0] !== P.FIRST) always = false;
    if (order.slice().sort().join(",") !== P.ids().sort().join(",")) alwaysPermutation = false;
    if (order[1] !== P.FIRST) sawOthers = true;
  }
  ok(always, "the ambient track is the FIRST track of every shuffled order");
  ok(alwaysPermutation, "and the order is still every track exactly once");
  ok(sawOthers, "the tracks that follow it do move around with the random stream");
  const st = P.makeState("all");
  eq(P.trackAt(P.pick(st).index).id, P.FIRST, "so a fresh visit starts on the ambient track");
}

group('"All": three plays per track, then the next one');
{
  const s = P.makeState("all");
  eq(s.loops, 0, "a fresh round starts at 0 plays");
  eq(s.offset, 0, "and at the first track of the order");
  eq(s.order.length, 5, "the order holds every track once");

  const seen = [];
  for (let i = 0; i < 15; i++) {
    const p = P.pick(s);
    seen.push(p.index);
    const verdict = P.cycle(s);
    const last = i % 3 === 2;
    eq(verdict, last ? "next" : "repeat",
       "play " + (i + 1) + " of the round is " + (last ? "the third, so it advances" : "not the third, so it repeats"));
  }
  ok(seen[0] === seen[1] && seen[1] === seen[2], "one track owns the first three plays");
  ok(seen[3] === seen[4] && seen[4] === seen[5], "the next track owns the next three");
  eq(s.offset, 0, "after 5 tracks x 3 plays the round wraps to the start");

  const firstRound = [];
  const s2 = P.makeState("all");
  for (let i = 0; i < 5; i++) { firstRound.push(P.pick(s2).index); P.cycle(s2); P.cycle(s2); P.cycle(s2); }
  eq(new Set(firstRound).size, 5, "each track of the order is played once per round");

  const p = P.pick(s2);
  eq(p.nth, 1, "pick() reports the position in the order (1-based)");
  eq(p.order, 5, "and how many tracks the order has");
}

group('"All" counts keep advancing under a longer walk');
{
  const s = P.makeState("all");
  const counts = {};
  for (let i = 0; i < 5 * P.REPEATS * 4; i++) {
    counts[P.pick(s).index] = (counts[P.pick(s).index] || 0) + 1;
    P.cycle(s);
  }
  const values = Object.keys(counts).map(k => counts[k]);
  ok(values.length === 5 && values.every(v => v === 3 * 4),
     "over four rounds every track is played exactly 3 x 4 times");
  eq(s.offset, 0, "four rounds land back on the start of the order");
}

group("one selected track loops forever");
{
  const s = P.makeState("jazzy_lounge_01");
  const p = P.pick(s);
  eq(p.index, P.indexOf("jazzy_lounge_01"), "pick() resolves the selected track");
  eq(p.order, 1, "a single choice has a one-track order");
  eq(p.nth, 1, "and is always the first of it");
  let advanced = 0, verdicts = [];
  for (let i = 0; i < 10; i++) {
    const before = P.pick(s).index;
    verdicts.push(P.cycle(s));
    if (P.pick(s).index !== before) advanced++;
  }
  eq(advanced, 0, "ten plays never move to another track");
  eq(verdicts.join(","), Array(10).fill("loop").join(","), "every play is reported as a loop");
  eq(s.loops, 0, "the counter stays at 0, so the menu shows no x of 3");
  eq(s.offset, 0, "and the All order is left alone for when the player goes back to it");
}

group("switching selection");
{
  const s = P.makeState("all");
  const orderBefore = s.order.join(",");
  P.cycle(s); P.cycle(s); P.cycle(s);
  P.select(s, "light_ambient");
  eq(s.track, "light_ambient", "select() takes the new choice");
  eq(s.loops, 0, "select() restarts the play count");
  eq(s.order.join(","), orderBefore, "the shuffled order survives the detour");
  P.select(s, "all");
  eq(s.track, "all", "and going back to All keeps that same order");
  const t = P.makeState("not-a-track");
  eq(t.track, "all", "an unknown choice is stored as All");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
