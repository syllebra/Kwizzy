/* Kwizzy — static quiz player.
   Corpus shape (see build_web.py):
     D.src  = ["quizo","connaisseances","openquizzdb"]
     D.lvl  = ["facile","moyen","difficile","test"]
     D.cats = [category names]
     D.quizzes[i] = [label, catIdx, lvlIdx(-1 unleveled), srcIdx, play_url, n_questions]
     D.q[i]       = [id, quizIdx, position, lvlIdx(-1), srcIdx, catIdx,
                     question, [options], correctIdx, explanation|null, img|null, imgAlt|null]
*/
(function () {
"use strict";

/* Memory shape (see ADR 0005): localStorage kwizzy.v1 = {a, b, t, s} —
   a: question id -> 1 (Answered Set), b: Origin key -> [score, total] (Best Score),
   t: question id -> epoch ms (Last Time of a Question),
   s: Origin key  -> epoch ms (Last Time of an Origin: q:<quizIdx> / c:<lvl> / c:<lvl>|<cat>).

   Player choices about AUDIO and HAPTICS are not game memory, so they live under their own
   key (see ADR 0006): localStorage kwizzy.settings.v1 = {sfx, music, haptics, track} —
   sfx:     UI feedback sounds on/off          (default true)
   music:   the ambient music on/off           (default true)
   haptics: the vibration pulse on/off         (default true)
   track:   "all" (random order, the default) or one track id (media/music/playlist.js).
   Reset memory clears kwizzy.v1 only — it erases what you played, never how the app sounds. */
var REVEAL_MS = 2500;
var CUSTOM_N = 20;
var LS_KEY = "kwizzy.v1";
var LS_SETTINGS = "kwizzy.settings.v1";

var SRC_NAMES = ["quizo", "connaisseances", "openquizzdb"];
var SRC_HOME = ["https://quizo.fr/", "https://connaisseances.com/", "https://openquizzdb.org/"];
var SRC_LABEL = { quizo: "quizo.fr", connaisseances: "connaisseances.com", openquizzdb: "openquizzdb.org" };
var LVL_NAMES = ["facile", "moyen", "difficile", "test"];
var LVL_LABEL = { facile: "Facile", moyen: "Moyen", difficile: "Difficile", test: "Test" };

var reduceMotion = false;
try { reduceMotion = window.matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (e) {}

var D = null, Q = null, QUIZ = null, CATS = null, SRC = null, LVL = null;
var qByQuiz = null;          // quizIdx -> [qIdx...]
var catQuizzes = null;       // catIdx  -> [quizIdx...]
var mem = null;
var saveHandle = 0;

var filters = null;          // {src:[bool x3], lvl:[bool x5]  last slot = unleveled}
var openCat = -1;

var stage = null, hud = null, stack = null;
var session = null;

/* ---------- screens + juice state (presentation only) ---------- */
var SCREENS = ["title", "choice", "cats", "play", "about"];
var screen = "title";

/* Back navigation: where "back" goes is kept IDENTICAL to what each screen's own arrow
   declares in the markup (data-back), so the Back key and the arrow can never disagree.
   Every screen goes back to the MAIN MENU — except Play, which steps out to the Menu.
   (Chaining cats -> choice was wrong: the Categories screen shows the difficulty pill,
   so tapping back there dropped the player on the difficulty screen again instead of
   the main menu.) */
var backKey = { title: null, choice: "title", cats: "title", about: "title", play: "choice" };
var backArmed = false, backArmedT = 0;
var SCREENNAME = { title: "the Title", choice: "the Menu", cats: "the Categories", play: "Play", about: "the Credits" };

function inPlay() {
  return !!session && session.answered < session.total;
}

function goBack(dest) {
  // dest comes from the arrow that was tapped (its data-back) or from backKey for the
  // Back key — one destination per screen, no chaining back through the Menu.
  if (isMenuOpen()) { closeMenu(); return; }   // the settings panel closes before anything else
  if (!dest) dest = backKey[screen];
  if (!dest) { toast("You are on the Title screen already."); return; }
  if (screen === "play" && inPlay()) {
    // A quiz is running: leaving it loses the score, so a tap only ARM the exit.
    if (!backArmed) {
      backArmed = true;
      // The Play screen has NO back arrow, so the armed state lives in its sticky HUD:
      // a gold line that pulses until the exit is confirmed (or times out).
      armHud();
      toast("A quiz is in progress (" + session.answered + " of " + session.total +
        " answered) — tap back AGAIN to leave it; an unfinished run is not scored.");
      if (backArmedT) clearTimeout(backArmedT);
      backArmedT = setTimeout(function () {
        backArmed = false; backArmedT = 0;
        disarmHud();
      }, 6000);
      return;
    }
    backArmed = false;
    if (backArmedT) { clearTimeout(backArmedT); backArmedT = 0; }
    disarmHud();
  }
  leavePlay();
  show(dest);
  toast("Back to " + SCREENNAME[dest] + ".");
}

// The armed confirmation, drawn on the Play HUD (sticky, always visible while playing).
function armHud() {
  if (!hud) return;
  hud.classList.add("armed");
  if (hud.querySelector(".arm")) return;
  add(hud, mk("div", "arm", "Back ARMED \u2014 tap \u2190 again to leave the quiz"));
}
function disarmHud() {
  if (!hud) return;
  hud.classList.remove("armed");
  var arm = hud.querySelector(".arm");
  if (arm) hud.removeChild(arm);
}

function leavePlay() {
  document.body.dataset.kwizzy = "ready";
  if (!stage) stage = document.getElementById("stage");
  stage.hidden = true;
  stage.className = "";
  stack = null;
  hud = null;
  session = null;
}
var chosenLvl = -1;          // Difficulty picked on the Choice screen
var catsMode = "random";     // "random" | "existing"
var switching = false;

/* ---------- dom helpers ---------- */
function mk(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = String(txt);
  return n;
}
function add(parent) {
  for (var i = 1; i < arguments.length; i++) {
    var k = arguments[i];
    if (k == null || k === false) continue;
    parent.appendChild(node(k));
  }
  return parent;
}
function node(x) {
  if (typeof x === "string" || typeof x === "number") return document.createTextNode(String(x));
  return x;
}
function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(2) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function normText(s) {
  var d = s;
  try { d = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
  d = d.toLowerCase();
  var out = [];
  for (var i = 0; i < d.length; i++) {
    var c = d.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out.push(d.charAt(i));
    else if (c === 32) { if (out.length && out[out.length - 1] !== " ") out.push(" "); }
  }
  return out.join("").trim();
}
function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
function lvlLabel(i) { return i < 0 ? "Unleveled" : LVL_LABEL[LVL_NAMES[i]]; }

/* ---------- memory ---------- */
function loadMem() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var o = JSON.parse(raw);
      if (o && o.a && o.b) {
        mem = o;
        if (!mem.t) mem.t = {};   // question id -> epoch ms of the last time it was seen
        if (!mem.s) mem.s = {};   // Origin key -> epoch ms of the last time it was played
        return;
      }
    }
  } catch (e) {}
  mem = { a: {}, b: {}, t: {}, s: {} };
}
function answered(id) { return mem.a[id] === 1; }
function markAnswered(id) {
  if (mem.a[id] !== 1) { mem.a[id] = 1; queueSave(); }
}
function queueSave() {
  if (saveHandle) return;
  saveHandle = setTimeout(function () {
    saveHandle = 0;
    try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) {}
  }, 350);
}
function bestKey(meta) {
  if (meta.kind === "source") return "q:" + meta.quizIdx;
  return meta.catIdx < 0 ? "c:" + meta.lvlIdx : "c:" + meta.lvlIdx + "|" + meta.catIdx;
}
function countKeys(o) { var n = 0; for (var k in o) n++; return n; }
function maxVal(o) { var m = 0; for (var k in o) { if (o[k] > m) m = o[k]; } return m; }

/* ---------- last time (mem.t = question id -> ms, mem.s = Origin key -> ms) ---------- */
function quizLast(qi) { return mem.s["q:" + qi] || 0; }
function originLast(key) { return mem.s[key] || 0; }
function qLast(qi) { return mem.t[Q[qi][0]] || 0; }

function touchOrigin(key) { mem.s[key] = Date.now(); queueSave(); }
function touchQuestion(qi) { mem.t[Q[qi][0]] = Date.now(); queueSave(); }

function absDate(ms) {
  var d = new Date(ms);
  var mo = d.getMonth() + 1, da = d.getDate(), y = d.getFullYear();
  return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (da < 10 ? "0" : "") + da;
}
// A short, plain-English age for a timestamp. 0 (never) -> null, so nothing is claimed.
function relTime(ms) {
  if (!ms) return null;
  var dt = Date.now() - ms;
  if (dt < 0) dt = 0;
  var mn = Math.floor(dt / 60000);
  if (mn < 1) return "just now";
  if (mn < 60) return mn + (mn === 1 ? " min" : " mins") + " ago";
  var h = Math.floor(mn / 60);
  if (h < 24) return h + (h === 1 ? " hr" : " hrs") + " ago";
  var d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return d + " days ago";
  var mo = Math.floor(d / 30);
  if (mo < 12) return mo + (mo === 1 ? " month" : " months") + " ago";
  return absDate(ms);
}
function sameDay(ms) {
  if (!ms) return false;
  var d = new Date(ms), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
// A "last played" stamp, warmed when the previous visit was today.
function stamp(cls, text, ms) { return mk("span", cls + (sameDay(ms) ? " today" : ""), text); }

/* ---------- player settings (localStorage kwizzy.settings.v1, ADR 0006) ----------
   sfx/music/haptics/track, read by sfx(), haptic() and the Music engine. Kept in their own
   key so "Reset memory" can erase the game memory without resetting how the app sounds. */
var settings = null;

function loadSettings() {
  var o = null;
  try {
    var raw = localStorage.getItem(LS_SETTINGS);
    if (raw) o = JSON.parse(raw);
  } catch (e) { o = null; }
  settings = {
    sfx: !o || o.sfx !== false,               // `!== false`: an untouched default is ON
    music: !o || o.music !== false,
    haptics: !o || o.haptics !== false,
    track: o && PLAYLIST.validTrack(o.track) ? o.track : "all"
  };
  return settings;
}
function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) {}
}

/* ---------- toast ---------- */
var toastEl = null, toastTimer = 0;
function toast(msg) {
  if (!toastEl) toastEl = document.getElementById("toast");
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
  toastEl.hidden = false;
  toastEl.classList.remove("show");
  void toastEl.offsetWidth;          // restart the entrance animation
  toastEl.classList.add("show");
  toastEl.textContent = msg;
  toastTimer = setTimeout(function () {
    toastEl.hidden = true;
    toastEl.classList.remove("show");
    toastTimer = 0;
  }, 4200);
}

/* ---------- screen router (ADR 0001) ---------- */
var screenEls = {};

function screenEl(name) {
  if (!screenEls[name]) screenEls[name] = document.getElementById("screen-" + name);
  return screenEls[name];
}

function show(name, opts) {
  if (SCREENS.indexOf(name) < 0 || switching) return;
  closeMenu();   // the settings drawer belongs to the Screen you opened it on; moving on closes
                 // it (the music itself keeps playing — the drawer is only a panel)
  var from = screenEl(screen), to = screenEl(name);
  if (!to || from === to) { screen = name; document.body.dataset.screen = name; return; }

  opts = opts || {};
  switching = true;
  screen = name;
  document.body.dataset.screen = name;

  // Let the incoming screen run its entrance even if it was shown before.
  to.classList.remove("anim-out");
  to.classList.remove("anim-in");
  void to.offsetWidth;
  to.classList.add("anim-in");
  setTimeout(function () { to.classList.remove("anim-in"); }, 900);

  if (from && !opts.instant && !reduceMotion) {
    from.classList.add("anim-out");
    sfx("screen");   // an airy swell under every screen change, felt more than heard
    setTimeout(function () {
      from.classList.remove("anim-out");
      switching = false;
    }, 200);
  } else {
    switching = false;
  }

  try { window.scrollTo(0, 0); } catch (e) {}
  onScreenShown(name);
}

// Screens that need to (re)build their contents when entered.
function onScreenShown(name) {
  if (name === "cats") {
    document.getElementById("random-panel").hidden = catsMode !== "random";
    document.getElementById("existing-panel").hidden = catsMode !== "existing";
    document.getElementById("cats-title").textContent =
      catsMode === "random" ? "Pick a category" : "Pick a quiz";
    if (catsMode === "random") {
      var pill = document.getElementById("random-lvl-pill");
      if (pill) pill.textContent = chosenLvl >= 0 ? lvlLabel(chosenLvl) : "—";
    } else {
      renderFilters();
      applyChosenLevel();
      var fp = document.getElementById("filters-lvl-pill");
      if (fp) fp.textContent = " — " + lvlLabel(chosenLvl);
      renderGrid();
    }
  }
}

/* ---------- juice: press shake, particle burst, screen shake ---------- */
function wirePress(root) {
  var r = root || document;
  r.addEventListener("pointerdown", function (ev) {
    /* HAPTIC, the global one: EVERY button tap anywhere (title, menus, back arrows,
       chips, skip, options — and any button added later) gets a subtle 20 ms pulse.
       wirePress(document) is wired at boot, so future screens inherit it for free. */
    var b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
    if (b && !b.disabled) haptic(20);   // haptic() retries itself until the browser grants
                                        // the pulse, so the first buttons of a session buzz
                                        // too (see the comment above haptic)
    var t = ev.target && ev.target.closest ? ev.target.closest(".press, .opt, .catcard, .fchip, .mode-card, .iconbtn") : null;
    if (!t || t.disabled) return;
    /* SOUND: one tiny tick per UI tap. Options and Validate are skipped here because they
       have their own dedicated sounds (select / validate) fired where the action is
       decided — one sound per interaction, so a tap never becomes a two-note jingle. */
    if (!t.classList.contains("opt") && !t.classList.contains("validate")) sfx("tap");
    t.classList.remove("shake");
    void t.offsetWidth;
    t.classList.add("shake");
    clearTimeout(t._shakeT);
    t._shakeT = setTimeout(function () { t.classList.remove("shake"); }, 400);
  }, { passive: true });
}

var burstEl = null;
var BURST_COLORS = ["#35e2d2", "#8b5cf6", "#f76b9e", "#4fd8ff", "#ffc86a", "#8ef06a"];

function burst(x, y, n) {
  if (reduceMotion) return;
  if (!burstEl) burstEl = document.getElementById("burst");
  if (!burstEl) return;
  n = n || 16;
  for (var i = 0; i < n; i++) {
    var s = document.createElement("i");
    s.className = "spark";
    var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    var dist = 42 + Math.random() * 78;
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.background = BURST_COLORS[i % BURST_COLORS.length];
    s.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(1) + "px");
    s.style.setProperty("--dy", (Math.sin(ang) * dist).toFixed(1) + "px");
    s.style.setProperty("--rot", (Math.random() * 520 - 260).toFixed(0) + "deg");
    s.style.setProperty("--dur", (620 + Math.random() * 380).toFixed(0) + "ms");
    s.style.width = s.style.height = (5 + Math.random() * 7).toFixed(1) + "px";
    burstEl.appendChild(s);
    (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1100); })(s);
  }
}

function burstAt(node, n) {
  if (!node || !node.getBoundingClientRect) return;
  var r = node.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, n);
}

/* ─────────── SOUND ───────────
   The clips are OURS: media/sfx/*.wav were synthesised from scratch by
   scripts/kwizzy-sfx.py (sine + hash-noise envelopes, no samples, no licence), 55-320 ms
   each, peaks 0.10-0.30 so the worst case is far under full scale. 7 clips ≈ 119 kB.
   An Audio object per name is built on first use, so nothing is fetched before it is
   needed; the files are tiny and same-origin so a play() fetch costs one small request.
   NOT gated by reduceMotion: that setting is about flashing/moving images, not audio. */
var sfxCache = {}, sfxFailed = {};
function sfx(name) {
  if (!settings || !settings.sfx) return;      // Sound OFF in the menu: stay silent
  if (sfxFailed[name]) return;
  var a = sfxCache[name];
  if (!a) {
    a = new Audio("media/sfx/" + name + ".wav");
    sfxCache[name] = a;
  }
  try {
    a.play();
  } catch (e) {
    sfxFailed[name] = true;                    // no audio backend: stay silent forever
  }
}

/* Haptic feedback (Vibration API): Android Chrome/Samsung/Opera pulse the phone, iOS Safari
   and Firefox 129+ do not implement it at all (navigator.vibrate absent, or returns false) —
   there the visual animations stay the whole feedback. Also silent under reduceMotion. */
function haptic(pattern) {
  if (reduceMotion) return;
  if (!settings || !settings.haptics) return;  // Haptics OFF in the menu: no pulse
  if (!navigator.vibrate) return;             // absent: iOS Safari, Firefox — stay silent

  /* vibrate() returns FALSE when the browser refuses the pulse: Chrome requires a user
     gesture COMMITTED to the frame first (chromestatus feature 5644273861001216), and
     Chromium issue 389016516 says the very first touchdown often fails to count — so the
     first buttons of a session (the Title's PLAY and Credits) get refused and never buzz.
     The return value tells us, so RETRY on later tasks until it reports true.
     IMPORTANT: call it as navigator.vibrate(...) — a method of Navigator. Copying the
     function into a local variable and calling THAT throws "Illegal invocation" (unbound),
     which silently killed every vibration; navigator["vibrate"](p) is the safe alias. */
  var tries = 0;
  (function attempt() {
    var r = null;
    try { r = navigator["vibrate"](pattern); } catch (e) { return; }
    if (r !== false) return;                  // fired (or engine returns nothing): stop
    if (tries >= 3) return;                   // never granted (Silent mode, no motor): quiet
    var wait = [40, 90, 160][tries];
    tries++;
    setTimeout(attempt, wait);
  })();
}

function thump(el, cls) {
  if (!el || reduceMotion) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(function () { el.classList.remove(cls); }, 520);
}

/* ─────────── MUSIC ───────────
   The ambient tracks are OURS: media/music/*.mp3, loopable on their own, one per mood. The
   RULES of a play session live in media/music/playlist.js (pure state, tested by
   media/music/playlist.test.js, read here through window.KwizzyPlaylist) so what the player
   hears is what the test checks:
     - a track is repeated 3 times, then the next one fades in (the crossfade);
     - "All" (the default) walks the whole set in a random order and loops round;
     - picking one track loops that one track and never moves on.
   Playback is Web Audio, not <audio>.play(): the volume needs to be ramped (fade in, fade
   out, crossfade), and only a GainNode can do that. Each track is fetched and decoded ONCE
   and then held, so a track change or a repeat costs no request and starts immediately — the
   engine keeps one AudioBufferSourceNode per play, wired through its own gain to the master.
   Browsers refuse to start audio before the page has been interacted with (autoplay policy):
   the source is loaded and played as soon as the app boots, and if the engine refuses, the
   play is retried on the first tap or key press (musicUnlock), which is a user gesture. */
var PLAYLIST = window.KwizzyPlaylist;
var MUSIC_FADE_MS = 1200;      // fade in/out and crossfade over this
var MUSIC_VOL = 0.55;          // the music sits well under the effects (sfx peak ~0.30)

var Music = {
  ctx: null, master: null,
  buf: {},               // track id -> decoded AudioBuffer, kept for the life of the page
  fetching: {},          // track id -> the decode promise, so one fetch is never doubled
  player: null,          // { id, src, gain } — the track currently playing
  state: null,           // the playlist state: choice + random order + play counter
  started: false,        // a track is loaded and playing
  muted: false,          // Music OFF, or nothing can play yet (no AudioContext)
  overFade: false,       // a crossfade is running: the fading track must ignore its "ended"
  pendingId: null,       // a play asked for and still waiting on its decode, by id
  wantId: null,          // what should be playing once the buffer is ready
  loadFailed: false,     // the last track could not be fetched/decoded: the panel says so
  lastEnd: 0
};

function musNow() {
  try { return Music.ctx ? Music.ctx.currentTime : 0; } catch (e) { return 0; }
}

function musCtx() {
  if (Music.ctx === undefined || Music.ctx) return Music.ctx;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    Music.ctx = AC ? new AC() : null;
    if (Music.ctx) {
      Music.master = Music.ctx.createGain();
      Music.master.gain.value = 0;
      Music.master.connect(Music.ctx.destination);
    }
  } catch (e) { Music.ctx = null; }
  return Music.ctx;
}

/* Chrome hands out an AudioContext FROZEN: currentTime stays at 0 — nothing scheduled
   inside it can sound — until the page has had a user gesture. So "a track is loaded" and
   "the browser has let it play" are two different facts, and the app must say the second
   one, not the first: the panel waits, and the first tap or key press unfreezes it. */
function musRunning() {
  return !!Music.ctx && musNow() > 0.02;
}

/* The master gain is the one place the volume is ramped: fade in, fade out and crossfade
   are all the same call with another target. */
function musGain(target, ms) {
  var g = Music.master, ctx = Music.ctx;
  if (!g || !ctx) return;
  var now = ctx.currentTime, from = g.gain.value;
  ms = ms || 0;
  try { g.gain.cancelScheduledValues(now); } catch (e) {}
  if (ms <= 0) { try { g.gain.setValueAtTime(target, now); } catch (e2) { g.gain.value = target; } return; }
  try { g.gain.setValueAtTime(from, now); } catch (e3) {}
  try { g.gain.linearRampToValueAtTime(target, now + ms / 1000); } catch (e4) { g.gain.value = target; }
}

/* Decoded once per track, kept for the life of the page: a repeat costs nothing. */
function musFetch(id) {
  var ctx = musCtx();
  if (!ctx) return Promise.reject(new Error("no audio"));
  if (Music.buf[id]) return Promise.resolve(Music.buf[id]);
  if (Music.fetching[id]) return Music.fetching[id];
  var tr = PLAYLIST.trackAt(PLAYLIST.indexOf(id));
  if (!tr) return Promise.reject(new Error("unknown track " + id));
  var p = fetch("media/music/" + tr.file, { cache: "force-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    })
    .then(function (bytes) {
      return new Promise(function (res, rej) { ctx.decodeAudioData(bytes, res, rej); });
    })
    .then(function (buf) { Music.buf[id] = buf; return buf; })
    ["catch"](function (e) { delete Music.fetching[id]; throw e; });
  Music.fetching[id] = p;
  return p;
}

function musNewPlayer(id, buf) {
  var ctx = Music.ctx;
  var src = ctx.createBufferSource();
  src.buffer = buf;
  /* One source per PLAY, never src.loop = true: verified in-page, a looping source fires
     `ended` ZERO times (7 s on a 0.5 s buffer = 11 loops, 0 events), so the playlist's
     "third play, then the next one" could never be reached and the old track kept running
     under the new one — the two musics the player picks playing over each other. The
     buffer is decoded once and reused, so a new play costs no request. */
  src.loop = false;
  var gain = ctx.createGain();
  gain.gain.value = 1;
  src.connect(gain);
  gain.connect(Music.master);
  src.onended = musEnded;
  return { id: id, src: src, gain: gain };
}

function musDropPlayer(p) {
  if (!p) return;
  try { p.src.onended = null; } catch (e) {}
  try { p.gain.disconnect(); } catch (e2) {}
  try { p.src.disconnect(); } catch (e3) {}
  try { p.src.stop(); } catch (e4) {}
}

/* One play finished. The rules are the playlist's, not the clock's: under "All" the third
   play of a track is its last, and the next one of the order then comes in over the tail;
   anything else plays the same track again, with no fade and no gap. */
function musEnded() {
  var now = Date.now();
  if (now - Music.lastEnd < 400) return;   // one transition per end, never two
  Music.lastEnd = now;
  if (!Music.started || Music.overFade || !settings || !settings.music) return;
  var id = Music.wantId || (Music.player ? Music.player.id : null);
  if (!id) return;
  if (PLAYLIST.cycle(Music.state) === "next") musAdvance();
  else musPlay(id, 0, false);              // a repeat: same track, at once, at volume
}

/* The next track of the order (the playlist has already moved its counter). */
function musAdvance() {
  var pick = PLAYLIST.pick(Music.state);
  var next = PLAYLIST.trackAt(pick.index);
  if (next) musPlay(next.id, MUSIC_FADE_MS, true);
}

/* The music never waits for the NEXT track to be downloaded while it is playing: the fetch
   of a 600 KB file costs seconds, and 25 s of music hides it — but only if the buffer is
   asked for while the current play is still running. The playlist says which track comes
   after this one; warming it there is presentation-free (a repeat needs nothing, the
   buffer is already decoded). */
function musWarm() {
  if (!Music.state || !settings || !settings.music) return;
  var id = PLAYLIST.nextId(Music.state);
  if (id && !Music.buf[id] && Music.wantId !== id) musFetch(id)["catch"](function () {});
}

/* Start one play of one track.
   fadeMs > 0 fades it up from silence (a first play, or the music switched back on);
            0 starts it at full volume, which is what makes a repeat seamless.
   cross  = true when another track is still sounding: each play owns a gain under the
            master, so the outgoing one falls to 0 while the new one climbs to 1 in the
            same time. The two do overlap — that is the fade the Music menu promises —
            but their total never doubles, which is what a master dip COULD NOT do:
            dipping the master silences both tracks at once and leaves the old one
            running at full volume for a second after.
   Never a second start() on one source either: verified in-page, it throws
   "cannot call start more than once" — which is why the frozen first play is dropped
   and a fresh source is started on the first tap. */
function musPlay(id, fadeMs, cross) {
  if (!musCtx()) return;
  /* A play asked for and still waiting on its decode: do not start a second one of the same
     track while it is in flight (the unlock fallback and the boot play would otherwise
     overlap — the same bug the menu is here to avoid, one level lower). */
  if (Music.pendingId === id && !Music.player) return;
  Music.wantId = id;
  Music.started = true;
  Music.pendingId = id;
  var old = Music.player;
  Music.player = null;
  musFetch(id).then(function (buf) {
    if (!Music.started || Music.wantId !== id) return;   // the player changed its mind
    var ctx = Music.ctx;
    Music.pendingId = null;
    var p = musNewPlayer(id, buf);
    try { ctx.resume(); } catch (e) {}
    var t = musNow();
    if (cross && old) {
      Music.overFade = true;
      try { old.gain.gain.setValueAtTime(old.gain.gain.value, t); } catch (e0) {}
      try { old.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_MS / 1000); } catch (e1) {}
      p.gain.gain.value = 0;
      try { p.gain.gain.setValueAtTime(0, t); } catch (e2) {}
      try { p.gain.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_MS / 1000); } catch (e3) {}
      try { p.src.start(t); } catch (e4) {}
      (function (dead) {                                            // only once it is silent
        setTimeout(function () { musDropPlayer(dead); Music.overFade = false; }, MUSIC_FADE_MS + 200);
      })(old);
    } else {
      musDropPlayer(old);
      Music.overFade = false;
      try { p.src.start(t); } catch (e5) {}
      musGain(MUSIC_VOL, fadeMs);   // already at volume: a repeat cannot dip the master
    }
    Music.player = p;
    Music.muted = false;
    Music.loadFailed = false;
    musWarm();               // the next track is already downloading while this one plays
    syncSettingsPanel();
  })["catch"](function () {
    Music.pendingId = null;
    Music.overFade = false;
    Music.wantId = null;
    Music.started = !!Music.player;
    Music.loadFailed = true;      // the panel says so instead of claiming "waiting for a tap"
    syncSettingsPanel();
  });
}

/* Fade the music down and let go of the track: switching Music back on starts a play again. */
function musicStop() {
  Music.started = false;
  Music.wantId = null;
  if (Music.ctx) musGain(0, MUSIC_FADE_MS);
  var p = Music.player;
  Music.player = null;
  if (!p) { Music.muted = true; syncSettingsPanel(); return; }
  setTimeout(function () { musDropPlayer(p); }, MUSIC_FADE_MS + 200);
  Music.muted = true;
  syncSettingsPanel();
}

/* Music on. Two cases, and the second one is the whole point of the frozen context: */
function musicStart() {
  if (!musCtx()) return;                 // no audio backend: the switch stays honest
  if (!Music.state) return;
  try { Music.ctx.resume(); } catch (e) {}
  Music.started = true;
  var tr = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
  if (!tr) return;
  /* Already sounding on that very track: put the volume back instead of starting over, so
     switching Music off and on again mid-play keeps the track where it left off. Only when
     the clock is actually moving — a frozen context means the track never sounded at all,
     and its source can never be started a second time. */
  if (Music.player && !Music.overFade && Music.player.id === tr.id && musRunning()) {
    Music.muted = false;
    musGain(MUSIC_VOL, MUSIC_FADE_MS);
    syncSettingsPanel();
    return;
  }
  musPlay(tr.id, MUSIC_FADE_MS, false);
}

function musicSelectTrack(id) {
  PLAYLIST.select(Music.state, id);
  if (Music.player && !Music.muted && musRunning()) musPlay(id, MUSIC_FADE_MS, true);
  else if (settings && settings.music) musicStart();   // nothing sounding yet: start it
  else syncSettingsPanel();
}

/* Browsers refuse audio before the page has been touched: Chrome hands the context out
   frozen (its clock stays at 0) and the boot play sits inside it. The first tap or key
   press is what lets resume() through — and a source already started at 0 inside a frozen
   context DOES play once it is resumed (verified in-page), so the unlock resumes rather
   than starting a second copy of the same track. If resume() is still refused the clock
   never moves, and only then is a fresh play started — on the next tap, again. */
function musicUnlock() {
  if (!settings || !settings.music || !Music.state) return;
  if (musRunning()) return;              // it is already sounding: nothing to unlock
  try { Music.ctx.resume(); } catch (e) {}
  /* resume() does not move the clock by itself, so the panel cannot claim "Playing" yet,
     and it must not be left saying "waiting" either: a beat later the clock proves what
     happened. No early return here even when the boot play is already inside — that play
     still needs the panel to notice the clock moved. */
  (function () {
    setTimeout(function () {
      if (!settings.music) return;
      if (musRunning()) { syncSettingsPanel(); return; }  // the clock moved: say so
      var tr = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
      if (tr) musPlay(tr.id, MUSIC_FADE_MS, false);
      else syncSettingsPanel();
    }, 400);
  })();
}

/* Web Audio present at all? A context that is merely SUSPENDED (the browser waiting for a
   user gesture — Chrome starts them that way) still counts as available: musicStart() calls
   resume() and the first tap or key press unlocks it. Only its total absence greys the menu. */
function musicSupported() {
  return !!(window.AudioContext || window.webkitAudioContext);
}

function musicBoot() {
  Music.state = PLAYLIST.makeState(settings.track);
  // Built now, at boot, even though it may be born suspended: a context created later from
  // inside a tap is fine too, but creating it NOW is what lets the app try to play the music
  // immediately and know whether the engine refused (autoplay policy) rather than never try.
  if (!musCtx()) return;                       // no Web Audio: the Music switch greys out
  var first = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index).id;
  /* Decode the startup track NOW, before asking for a play: the fetch of a 600 KB file is
     what the first tap would otherwise wait for, and warming it here means the tap that
     unlocks the frozen context can start the play straight away. */
  musFetch(first).then(function () {
    if (settings.music) musicStart();
  })["catch"](function () {
    Music.loadFailed = true;
    syncSettingsPanel();
  });
  window.addEventListener("pointerdown", musicUnlock, { passive: true });
  window.addEventListener("keydown", musicUnlock);
}

/* ---------- the settings menu (the burger) ----------
   One fixed button in the markup on EVERY screen (like the fullscreen corner), one panel
   under it. Everything here is presentation of `settings` + `Music`: the music engine above
   is what makes the sound, this only says what is on and takes the player's choice. */
var menuEl = null, menuBackEl = null, burgerEl = null;
var mSfxEl = null, mMusicEl = null, mHapEl = null, mHapRow = null,
    mListEl = null, mNowEl = null, mSelEl = null;

function initSettingsPanel() {
  menuEl = document.getElementById("settings-menu");
  menuBackEl = document.getElementById("menu-back");
  burgerEl = document.getElementById("btn-menu");
  mSfxEl = document.getElementById("set-sfx");
  mMusicEl = document.getElementById("set-music");
  mHapEl = document.getElementById("set-haptics");
  mHapRow = mHapEl ? mHapEl.closest(".mrow") : null;
  mListEl = document.getElementById("track-list");
  mNowEl = document.getElementById("music-now");
  mSelEl = document.getElementById("music-sel");
  buildTrackList();
  wireMenu();
  syncSettingsPanel();
}

/* The three toggles: one class on the row carries the state, plus aria-checked for anyone
   reading rather than looking — the mode is never colour-only (ADR 0004). */
function setToggle(el, on) {
  if (!el) return;
  var row = el.closest(".mrow");
  if (row) row.classList.toggle("on", !!on);
  el.setAttribute("aria-checked", on ? "true" : "false");
}

function buildTrackList() {
  if (!mListEl || !PLAYLIST) return;
  mListEl.innerHTML = "";
  var choices = [{ id: PLAYLIST.ALL, label: "All", note: "random order, fading on after 3 plays" }];
  var i;
  for (i = 0; i < PLAYLIST.TRACKS.length; i++) {
    choices.push({ id: PLAYLIST.TRACKS[i].id, label: PLAYLIST.TRACKS[i].label, note: "loops on its own" });
  }
  for (i = 0; i < choices.length; i++) {
    var row = mk("button", "track press");
    row.dataset.track = choices[i].id;
    add(row, mk("span", "tk-t", choices[i].label));
    add(row, mk("span", "tk-n", choices[i].note));
    (function (btn) {
      btn.addEventListener("click", function () { chooseTrack(btn.dataset.track); });
    })(row);
    add(mListEl, row);
  }
}

function chooseTrack(id) {
  settings.track = PLAYLIST.validTrack(id) ? id : PLAYLIST.ALL;
  saveSettings();
  musicSelectTrack(settings.track);
  syncSettingsPanel();
  if (settings.track === PLAYLIST.ALL) {
    toast("Music: All — a random order, each track 3 times, then a fade to the next.");
  } else {
    toast("Music: " + PLAYLIST.label(settings.track) + " — looping on its own.");
  }
}

/* What the panel says right now: switch states, the picked choice, and which track is
   actually playing (named, so the choice and what you hear can be compared). */
function syncSettingsPanel() {
  if (!menuEl || !settings) return;
  setToggle(mSfxEl, settings.sfx);
  setToggle(mMusicEl, settings.music);
  setToggle(mHapEl, settings.haptics);
  if (mMusicEl) mMusicEl.disabled = !musicSupported();   // no Web Audio: greys out, like haptics
  if (mHapRow) mHapRow.classList.toggle("off", !navigator.vibrate);
  if (mSelEl) mSelEl.textContent = PLAYLIST.label(settings.track);
  if (mListEl) {
    for (var i = 0; i < mListEl.children.length; i++) {
      var row = mListEl.children[i];
      if (row.dataset.track === settings.track) row.dataset.sel = "1";
      else row.removeAttribute("data-sel");
    }
  }
  if (mNowEl) {
    if (!settings.music) mNowEl.textContent = "Music is off.";
    else if (!musicSupported()) mNowEl.textContent = "This browser has no audio engine — music stays off.";
    else if (Music.loadFailed && !Music.player) {
      mNowEl.textContent = "That track could not be loaded — try another music choice.";
    } else if (Music.player && musRunning()) {
      /* A source can exist and still make no sound: Chrome hands the context out frozen
         until the page gets a gesture, and its clock never moves while that is so. "Playing"
         is only claimed when the clock proves it. */
      var st = PLAYLIST.pick(Music.state);
      mNowEl.textContent = "Playing: " + PLAYLIST.trackAt(st.index).label +
        (settings.track === PLAYLIST.ALL
          ? " · play " + (Music.state.loops + 1) + " of " + PLAYLIST.REPEATS +
            " · track " + st.nth + " of " + st.order
          : " · looping");
    } else mNowEl.textContent = "Waiting for your first tap to start the music.";
  }
  if (menuEl) menuEl.dataset.open = isMenuOpen() ? "1" : "0";
}

function isMenuOpen() { return !!menuEl && menuEl.classList.contains("open"); }

function openMenu() {
  if (!menuEl || !menuBackEl) return;
  menuBackEl.hidden = false;
  menuEl.hidden = false;
  menuEl.dataset.open = "1";
  syncSettingsPanel();
  void menuEl.offsetWidth;
  menuEl.classList.add("open");
  if (burgerEl) burgerEl.setAttribute("aria-expanded", "true");
  thump(menuEl.querySelector(".menu-title"), "bump");
}
function closeMenu() {
  if (!menuEl) return;
  menuEl.classList.remove("open");
  menuEl.dataset.open = "0";
  menuEl.hidden = true;
  menuBackEl.hidden = true;
  if (burgerEl) burgerEl.setAttribute("aria-expanded", "false");
}
function toggleMenu() { if (isMenuOpen()) closeMenu(); else openMenu(); }

function wireMenu() {
  var close = document.getElementById("menu-close");
  if (burgerEl) burgerEl.addEventListener("click", function (ev) {
    if (ev.stopPropagation) ev.stopPropagation();
    toggleMenu();
  });
  if (close) close.addEventListener("click", closeMenu);
  if (menuBackEl) menuBackEl.addEventListener("click", closeMenu);
  if (mSfxEl) mSfxEl.addEventListener("click", function () {
    settings.sfx = !settings.sfx;
    saveSettings();
    if (settings.sfx) sfx("tap");      // the tick confirms the new state, so it fires after
    syncSettingsPanel();
    toast(settings.sfx ? "Sound effects on." : "Sound effects off.");
  });
  if (mMusicEl) mMusicEl.addEventListener("click", function () {
    settings.music = !settings.music;
    saveSettings();
    if (settings.music) musicStart(); else musicStop();
    syncSettingsPanel();
    toast(settings.music ? "Music on." : "Music off.");
  });
  if (mHapEl) mHapEl.addEventListener("click", function () {
    settings.haptics = !settings.haptics;
    saveSettings();
    if (settings.haptics) haptic(30);  // says "this is what you just switched on"
    syncSettingsPanel();
    toast(settings.haptics ? "Haptic feedback on." : "Haptic feedback off.");
  });
}


/* ---------- loader ---------- */
var loader = null, loaderRing = null, loaderNote = null, loaderPct = null;
var RING = 251.33;   // circumference of the gauge circle (r=40 in a 100-unit viewBox)

function initLoader() {
  loader = document.getElementById("loader");
  loaderRing = loader.querySelector(".ring-fill");
  loaderNote = loader.querySelector(".loader-note");
  loaderPct = mk("p", "loader-pct");
  loader.appendChild(loaderPct);
}
// The gauge is swept by the real streamed bytes: frac is got/total, so the ring is a
// measurement, not a spinner pretending to know something (ADR 0004).
function setProgress(frac, label) {
  frac = Math.max(0, Math.min(1, frac));
  if (loaderRing) {
    loaderRing.style["stroke-dasharray"] = RING + " " + RING;
    loaderRing.style["stroke-dashoffset"] = (RING * (1 - frac)).toFixed(2);
  }
  if (loaderPct) loaderPct.textContent = label;
}

function loadCorpus() {
  var t0 = Date.now();
  return fetch("corpus.json", { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    var total = 0;
    try { total = parseInt(res.headers.get("Content-Length"), 10) || 0; } catch (e) {}

    var chunks = [];
    var got = 0;
    var lastPaint = 0;
    function paint(force) {
      var now = Date.now();
      if (!force && now - lastPaint < 90) return;
      lastPaint = now;
      if (total > 0) setProgress(got / total, Math.round(100 * got / total) + "% · " + fmtBytes(got));
      else setProgress(Math.min(0.96, 0.05 + 0.9 * (now - t0) / 6000), fmtBytes(got));
    }

    var stream = null;
    try { stream = res.body; } catch (e) {}
    if (stream && stream.getReader) {
      var reader = stream.getReader();
      var step;
      step = function () {
        return reader.read().then(function (r) {
          if (r.value && r.value.byteLength) { chunks.push(r.value); got += r.value.byteLength; }
          if (r.done) { paint(true); return finishDecode(chunks, got, t0); }
          paint(false);
          return step();
        });
      };
      return step();
    }
    return res.arrayBytes().then(function (bytes) {
      chunks.push(bytes); got = bytes.byteLength; paint(true);
      return finishDecode(chunks, got, t0);
    });
  });
}

function finishDecode(chunks, got, t0) {
  setProgress(1, "100% · " + fmtBytes(got));
  if (loaderNote) loaderNote.textContent = "Decoding and indexing…";
  var text = new TextDecoder("utf-8").decode(joinBytes(chunks));
  var parsed = JSON.parse(text);
  var ms = Date.now() - t0;
  if (loaderNote) loaderNote.textContent = "Corpus ready in " + (ms / 1000).toFixed(1) + " s";
  if (loaderPct) loaderPct.textContent = "100%";
  return parsed;
}

function joinBytes(chunks) {
  var n = 0, i;
  for (i = 0; i < chunks.length; i++) n += chunks[i].byteLength;
  var out = new Uint8Array(n), off = 0;
  for (i = 0; i < chunks.length; i++) {
    out.set(chunks[i], off);
    off += chunks[i].byteLength;
  }
  return out;
}

var loaderRetried = false;
function loaderError(err) {
  if (loaderNote) loaderNote.textContent = "Could not load the corpus: " +
    (err && err.message ? err.message : "network error");
  if (loaderPct) loaderPct.textContent = "Tap to retry";
  if (loaderRetried) return;
  loaderRetried = true;
  var btn = mk("button", "btn primary");
  btn.textContent = "Try again";
  btn.addEventListener("click", function () {
    if (loaderNote) loaderNote.textContent = "Retrying…";
    loadCorpus().then(onCorpus);
  });
  if (loader) loader.appendChild(btn);
}

/* ---------- indexing ---------- */
function indexCorpus() {
  Q = D.q; QUIZ = D.quizzes; CATS = D.cats; SRC = D.src; LVL = D.lvl;
  var i;
  qByQuiz = [];
  for (i = 0; i < QUIZ.length; i++) qByQuiz.push([]);
  for (i = 0; i < Q.length; i++) qByQuiz[Q[i][1]].push(i);

  catQuizzes = [];
  for (i = 0; i < CATS.length; i++) catQuizzes.push([]);
  for (i = 0; i < QUIZ.length; i++) catQuizzes[QUIZ[i][1]].push(i);

  filters = { src: [], lvl: [] };
  for (i = 0; i < SRC.length; i++) filters.src.push(true);
  for (i = 0; i <= LVL.length; i++) filters.lvl.push(true);
}
function lvlSlot(i) { return i < 0 ? LVL.length : i; }
function quizMatches(qi) {
  var q = QUIZ[qi];
  return filters.src[q[3]] && filters.lvl[lvlSlot(q[2])];
}

/* ---------- landing ---------- */
var gridEl = null, sheetSlot = null, filtersEl = null, catChipsEl = null;

var lvlFchips = [];   // the Levels filter chips, in slot order (0..3 levels, 4 = Unleveled)

function renderFilters() {
  if (filtersEl) return;
  filtersEl = document.getElementById("filters");
  var groups = [
    { names: ["quizo.fr", "connaisseances.com", "openquizzdb.org"], arr: filters.src },
    { names: ["Facile", "Moyen", "Difficile", "Test", "Unleveled"], arr: filters.lvl }
  ];
  for (var g = 0; g < groups.length; g++) {
    var box = mk("div", "filter-group");
    add(box, mk("span", "lbl", g ? "Levels" : "Sources"));
    var arr = groups[g].arr;
    for (var k = 0; k < arr.length; k++) {
      var c = mk("button", "fchip " + (g ? "lvl" : "src"), groups[g].names[k]);
      c.dataset.on = "1";
      bindToggle(c, arr, k);
      if (g) lvlFchips.push(c);
      add(box, c);
    }
    add(filtersEl, box);
  }
}
// Said in words where the choice is echoed, so the highlight is not the only signal (ADR 0004).
function sayChosenLevel() {
  var t = document.getElementById("lvl-chosen");
  if (t) t.textContent = "Difficulty chosen: " + lvlLabel(chosenLvl) + ".";
}
// The Difficulty picked on the Choice Screen seeds the Level filters, so the existing-quiz
// grid only offers that Difficulty. The two Levels never offered as a Difficulty (Test,
// Unleveled) stay on: a Quiz carrying one contradicts nothing, and switching it off would
// make it unreachable — it is only ever reached by playing a Source Quiz that carries it
// (see CONTEXT). The player can still toggle any Level back on or off.
function applyChosenLevel() {
  if (!filters || !filters.lvl || chosenLvl < 0) return;
  var k;
  for (k = 0; k < filters.lvl.length; k++) {
    var unchoosable = k >= LVL.length - 1;   // Test and Unleveled
    var on = k === chosenLvl || unchoosable;
    filters.lvl[k] = on;
    if (lvlFchips[k]) lvlFchips[k].dataset.on = on ? "1" : "0";
  }
}
function bindToggle(node_, arr, k) {
  node_.addEventListener("click", function () {
    arr[k] = !arr[k];
    node_.dataset.on = arr[k] ? "1" : "0";
    renderGrid();
  });
}

function renderGrid() {
  if (!gridEl) gridEl = document.getElementById("grid");
  if (!sheetSlot) sheetSlot = document.getElementById("sheet-slot");
  if (!gridEl || !sheetSlot) return;
  // The slot can live inside the grid (under the opened card). Rescue it before
  // wiping the grid, or innerHTML="" would delete it for good.
  if (sheetSlot.parentNode === gridEl) gridEl.parentNode.insertBefore(sheetSlot, gridEl);
  gridEl.innerHTML = "";
  sheetSlot.innerHTML = "";
  openCat = -1;
  var shown = 0;
  for (var ci = 0; ci < CATS.length; ci++) {
    var list = catQuizzes[ci];
    var nq = 0, nquizzes = 0;
    var dots = [false, false, false];
    var lastQz = 0, lastQ = 0;   // most recent Origin / Question visit inside this Category
    var j;
    for (j = 0; j < list.length; j++) {
      var qi = list[j];
      if (!quizMatches(qi)) continue;
      nquizzes++;
      nq += qByQuiz[qi].length;
      dots[QUIZ[qi][3]] = true;
      var qd = quizLast(qi);
      if (qd > lastQz) lastQz = qd;
      var qs = qByQuiz[qi], m;
      for (m = 0; m < qs.length; m++) {
        var qd2 = qLast(qs[m]);
        if (qd2 > lastQ) lastQ = qd2;
      }
    }
    if (!nquizzes) continue;
    var card = mk("div", "glass catcard");
    card.dataset.cat = String(ci);
    add(card, mk("div", "nm", CATS[ci]));
    add(card, mk("div", "qt", plural(nquizzes, "quiz", "quizzes") + " \u00b7 " + plural(nq, "question", "questions")));
    if (lastQz) add(card, stamp("lastq", "Last played " + absDate(lastQz), lastQz));
    if (lastQ) add(card, stamp("lastq2", "Last question seen " + absDate(lastQ), lastQ));
    var dotRow = mk("div", "srcdots");
    for (var s = 0; s < 3; s++) {
      if (!dots[s]) continue;
      add(dotRow, mk("i", "dot src-" + SRC[s], SRC_LABEL[SRC[s]]));
    }
    add(card, dotRow);
    add(card, mk("div", "go", "Open \u25be"));
    add(gridEl, card);
    shown++;
  }
  if (!shown) add(gridEl, mk("p", "hint", "No category matches the current filters."));
}

function renderCatChips() {
  if (!catChipsEl) catChipsEl = document.getElementById("cat-chips");
  if (!catChipsEl) return;
  catChipsEl.innerHTML = "";
  var order = [];
  for (var o = 0; o < CATS.length; o++) order.push(o);
  order.sort(function (a, b) { return CATS[a].localeCompare(CATS[b], "fr"); });
  for (var oi = 0; oi < order.length; oi++) {
    var ci = order[oi];
    var c = mk("button", "chip cat", CATS[ci]);
    c.dataset.cat = String(ci);
    bindChipSelect(c, catChipsEl);
    add(catChipsEl, c);
  }
}
function bindChipSelect(node_, container) {
  node_.addEventListener("click", function () {
    var selected = node_.dataset.sel === "1";
    for (var k = 0; k < container.children.length; k++) {
      var o = container.children[k];
      if (o.dataset.sel === "1") o.removeAttribute("data-sel");
    }
    if (!selected) node_.dataset.sel = "1";
  });
}

function toggleSheet(catIdx) {
  if (openCat === catIdx) {
    sheetSlot.innerHTML = "";
    openCat = -1;
    resetCatCards();
    return;
  }
  openCat = catIdx;
  var list = [];
  var src = catQuizzes[catIdx];
  for (var i = 0; i < src.length; i++) if (quizMatches(src[i])) list.push(src[i]);
  list.sort(function (a, b) { return qByQuiz[b].length - qByQuiz[a].length; });

  var sheet = mk("div", "glass sheet");
  add(sheet, mk("div", "sheet-h", CATS[catIdx] + " — " + plural(list.length, "quiz", "quizzes")));
  for (var k = 0; k < list.length; k++) {
    var qi = list[k], qz = QUIZ[qi];
    var row = mk("div", "qrow");
    add(row, mk("span", "lbl", qz[0]));
    var chips = mk("span", "chips");
    if (qz[2] >= 0) add(chips, mk("span", "chip lvl", lvlLabel(qz[2])));
    add(chips, mk("span", "chip src", SRC_LABEL[SRC[qz[3]]]));
    var lastQz = quizLast(qi);
    if (lastQz) add(chips, stamp("chip last", "last " + absDate(lastQz), lastQz));
    add(row, chips, mk("span", "n", qByQuiz[qi].length + " q"));
    var play = mk("button", "btn press", "");
    add(play, mk("span", "btn-label", "Play"));
    play.dataset.quiz = String(qi);
    bindPlay(play);
    add(row, play);
    add(sheet, row);
  }
  var close = mk("button", "btn press", "");
  add(close, mk("span", "btn-label", "Close ▴"));
  close.addEventListener("click", function () {
    sheetSlot.innerHTML = "";
    openCat = -1;
    resetCatCards();
  });
  add(sheet, close);

  // Place the sheet directly beneath the card that was opened, not after the whole grid.
  var cards = gridEl.children;
  var anchor = null;
  for (var c = 0; c < cards.length; c++) {
    if (cards[c].dataset.cat === String(catIdx)) { anchor = cards[c]; break; }
  }
  sheetSlot.innerHTML = "";
  add(sheetSlot, sheet);
  if (anchor && anchor.parentNode === gridEl) {
    gridEl.insertBefore(sheetSlot, anchor.nextSibling);
  } else {
    add(gridEl, sheetSlot);
  }
}

function resetCatCards() {
  if (!gridEl) return;
  var all = gridEl.children;
  for (var k = 0; k < all.length; k++) {
    if (all[k].dataset.cat) {
      all[k].className = (openCat === parseInt(all[k].dataset.cat, 10))
        ? "glass catcard open" : "glass catcard";
    }
  }
}
function bindPlay(btn) {
  btn.addEventListener("click", function () {
    startSourceQuiz(parseInt(btn.dataset.quiz, 10));
  });
}

/* ---------- HUD ---------- */
function buildHud(meta) {
  hud = mk("div", "hud");
  add(hud, mk("div", "hud-title", meta.title));
  var bar = mk("div", "bar");
  add(bar, mk("i", null));
  add(hud, bar);
  var line = mk("div", "hud-line");
  var best = mem.b[bestKey(meta)];
  var lastSeen = session.prevLast || 0;      // the visit before this one (startSession read it)
  add(line,
    mk("span", "sc", "0 / " + meta.total),
    " · ",
    mk("span", "pct", "0%"),
    " · ",
    mk("span", "best", best ? "Best " + best[0] + "/" + best[1] + " (" + pct(best[0], best[1]) + "%)" : "no run yet"),
    " · ",
    mk("span", "last" + (lastSeen ? (sameDay(lastSeen) ? " today" : "") : " never"),
       lastSeen ? "Last played " + absDate(lastSeen) : "never played here"));
  add(hud, line);

  // A BACK affordance on the Play screen: the markup arrows live in the other screens'
  // topbars, and while a quiz runs there is nothing to tap. The HUD is sticky and always
  // visible, so the button lives there — and it goes through goBack(), which asks for a
  // second tap while the quiz is still in progress (the confirmation the user asked for).
  // Built per session, so it wires itself here rather than waiting on wireScreens().
  var bk = mk("button", "iconbtn press", "");
  bk.innerHTML = "&larr;";
  bk.setAttribute("aria-label", "Back");
  bk.addEventListener("click", function () { goBack("choice"); });   // Play steps out to the Menu
  add(hud, bk);
  return hud;
}
function updateHud() {
  var sc = hud.querySelector(".sc");
  sc.textContent = session.score + " / " + session.total;
  hud.querySelector(".pct").textContent = pct(session.score, session.total) + "%";
  hud.querySelector(".bar i").style.width =
    Math.round((session.answered / session.total) * 100) + "%";
  thump(sc, "bump");
}

/* ---------- cards ---------- */
function makeCard(qi, n, total) {
  var q = Q[qi];
  var art = mk("article", "glass card");
  art.dataset.qi = String(qi);

  var head = mk("div", "qnum", "Q" + (n + 1) + " / " + total);
  if (session.kind === "source") add(head, " · " + lvlLabel(q[3]));
  add(head, " · " + CATS[q[5]]);
  // Last Time of this Question, read before this run touches it: absent = never played.
  var qLastBefore = qLast(qi);
  if (qLastBefore) add(head, stamp("last", "Last played " + relTime(qLastBefore), qLastBefore));
  add(art, head);

  if (answered(q[0])) add(art, mk("span", "badge", "Answered before"));

  add(art, mk("p", "qtext", q[6]));

  if (q[10]) {
    var img = mk("img", "media");
    img.setAttribute("src", "media/" + q[10]);
    img.alt = q[11] || "";
    img.loading = "lazy";
    img.decoding = "async";
    add(art, img);
  }

  var opts = mk("div", "opts");
  // Long answers stop fitting the 2-per-row grid: past ~40 characters the text wraps
  // 3+ lines in a half-width column, so the whole block goes vertical (one per row).
  // In the corpus only ~2.6% of Questions reach that length — the grid is untouched
  // for the rest, which is what "only if long text inside" asks for.
  var longest = 0;
  for (k = 0; k < q[7].length; k++) longest = Math.max(longest, String(q[7][k]).length);
  if (longest >= 40) opts.className = "opts vert";
  var order = [], k;
  for (k = 0; k < q[7].length; k++) order.push(k);
  shuffle(order);
  art._order = order;
  art._correct = order.indexOf(q[8]);
  for (var i = 0; i < order.length; i++) {
    var b = mk("button", "opt");
    b.dataset.slot = String(i);
    add(b, mk("span", "k", String.fromCharCode(65 + i) + "."), q[7][order[i]]);
    add(opts, b);
  }
  add(art, opts);
  return art;
}

function gradeCard(card, slot) {
  var q = Q[parseInt(card.dataset.qi, 10)];
  var right = card._correct;
  var ok = slot === right;

  var kids = card.querySelector("div.opts").children;
  for (var i = 0; i < kids.length; i++) {
    var s = parseInt(kids[i].dataset.slot, 10);
    if (s === right) kids[i].className = "opt right";
    else if (s === slot) kids[i].className = "opt wrong";
    else kids[i].className = "opt dim";
  }
  card.className = "glass card answered";

  // haptics: one clean buzz when the answer is right, a triple-tap buzz when it is wrong
  haptic(ok ? 60 : [25, 40, 25]);
  // SOUND mirrors the haptics exactly: correct RISES (C5->E5, a win), wrong FALLS and is
  // raspier (B4->G#4) — the two can never be mistaken for each other, or for the tap tick.
  sfx(ok ? "correct" : "wrong");

  // juice: burst on the correct option, extra sparks when the player got it
  for (var b = 0; b < kids.length; b++) {
    if (parseInt(kids[b].dataset.slot, 10) === right) {
      (function (el) { setTimeout(function () { burstAt(el, ok ? 22 : 10); }, 60); })(kids[b]);
      break;
    }
  }
  if (!ok) thump(card, "shake");

  var ans = mk("div", "ans");
  add(ans, mk("div", "verdict " + (ok ? "ok" : "ko"), ok ? "Correct" : "Not quite"));
  if (!ok) add(ans, mk("div", "expl", "Right answer: " + String.fromCharCode(65 + right) + ". " + q[7][q[8]]));
  if (q[9]) add(ans, mk("p", "expl", q[9]));

  var qz = QUIZ[q[1]];
  var src = mk("div", "src");
  add(src, mk("span", "chip src", SRC_LABEL[SRC[qz[3]]]));
  if (qz[4]) {
    var a = mk("a", null, SRC[qz[3]] === "openquizzdb" ? "source file ↗" : "original quiz ↗");
    a.href = qz[4];
    a.target = "_blank";
    a.rel = "noopener";
    add(src, a);
  }
  add(ans, src);
  add(card, ans);
  return ok;
}

function askCard(card) {
  return new Promise(function (resolve) {
    var done = false;
    var sel = null;
    var confirm = null;
    var opts = card.querySelector("div.opts");
    card.addEventListener("click", function (ev) {
      if (done || !ev.target || !ev.target.closest) return;

      // Tapping the Validate button is what grades the answer.
      var v = ev.target.closest("button.validate");
      if (v) {
        if (sel === null) { toast("Pick an answer first, then Validate."); return; }
        done = true;
        try { card.removeChild(confirm); } catch (e) {}
        sfx("validate");   // the commit itself: a short whoosh, deliberately NOT a verdict
        resolve(sel);
        return;
      }

      // Tapping an option only SELECTS it: a blue highlight, no grading yet.
      // The player can move the highlight until Validate is pressed.
      var t = ev.target.closest("button.opt");
      if (!t || !t.dataset.slot) return;
      sel = parseInt(t.dataset.slot, 10);
      // classList (not className): thump later adds selPop to the same button, so
      // an exact className compare would miss it when the highlight moves away.
      var kids = opts.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] === t) kids[i].classList.add("sel");
        else kids[i].classList.remove("sel");
      }
      thump(t, "selPop");
      sfx("select");   // the highlight moved: a small rising pip, brighter than a tap
      // no haptic here: the global wirePress pulse already fired on this tap
      if (!confirm) {
        confirm = mk("button", "btn press validate", "");
        add(confirm, mk("span", "btn-label", "Validate"));
        add(card, confirm);
      }
    });
  });
}

function countdown(card) {
  var tick = mk("div", "tick");
  add(tick, mk("i", null));
  tick.style.setProperty("--ms", REVEAL_MS + "ms");
  var skip = mk("button", "skip", "Reveal next in ");
  add(skip, mk("span", "cd", (REVEAL_MS / 1000).toFixed(1) + "s"));
  add(card, tick);
  add(card, skip);

  return new Promise(function (finish) {
    var fired = false;
    var left = REVEAL_MS;
    var ticker = setInterval(function () {
      left -= 100;
      if (left < 0) left = 0;
      skip.textContent = "Reveal next in ";
      skip.appendChild(mk("span", "cd", (left / 1000).toFixed(1) + "s"));
    }, 100);
    var timer = setTimeout(function () { fire(); }, REVEAL_MS);
    function fire() {
      if (fired) return;
      fired = true;
      clearInterval(ticker);
      clearTimeout(timer);
      try { card.removeChild(tick); card.removeChild(skip); } catch (e) {}
      finish();
    }
    skip.addEventListener("click", fire);
  });
}
function ensureVisible(card) {
  if (reduceMotion || !session.autoFollow) return;
  try {
    var r = card.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.7) card.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {}
}

/* ---------- play loop ---------- */
function startSession(meta, picks) {
  if (!picks.length) {
    toast("No question matches that combination — try another Level or Category.");
    return;
  }
  session = {
    kind: meta.kind,
    meta: meta,
    title: meta.title,
    key: bestKey(meta),
    total: picks.length,
    picks: picks,
    score: 0,
    answered: 0,
    autoFollow: true
  };
  // Last Time of this Origin: read the previous visit before stamping this one.
  session.prevLast = originLast(session.key);
  touchOrigin(session.key);
  document.body.dataset.kwizzy = "play";
  if (!stage) stage = document.getElementById("stage");
  stage.hidden = false;
  stage.className = "on";
  stage.innerHTML = "";
  add(stage, buildHud(meta));
  stack = mk("div", "stack");
  add(stage, stack);
  show("play");
  runLoop();
}

function runLoop() {
  (function step(i) {
    if (i >= session.total) { showSummary(); return; }
    var card = makeCard(session.picks[i], i, session.total);
    add(stack, card);
    ensureVisible(card);
    askCard(card).then(function (slot) {
      var ok = gradeCard(card, slot);
      session.answered++;
      if (ok) session.score++;
      markAnswered(Q[session.picks[i]][0]);
      touchQuestion(session.picks[i]);
      updateHud();
      if (i + 1 < session.total) countdown(card).then(function () { step(i + 1); });
      else showSummary();
    });
  })(0);
}

function showSummary() {
  var s = session;
  var prev = mem.b[s.key];
  var better = !prev || s.score > prev[0];
  if (better) { mem.b[s.key] = [s.score, s.total]; queueSave(); }

  var sum = mk("div", "glass summary");
  add(sum, mk("div", "big", pct(s.score, s.total) + "%"));
  add(sum, mk("div", "line", "Score: " + s.score + " / " + s.total + " · " + pct(s.score, s.total) + "%"));
  if (prev) add(sum, mk("div", "line", "Best before: " + prev[0] + " / " + prev[1] + " (" + pct(prev[0], prev[1]) + "%)"));
  else add(sum, mk("div", "line", "First run of this combination."));
  if (better) add(sum, mk("div", "new-best", "★ New best" + (prev ? " — you beat " + prev[0] : "")));
  if (s.prevLast) add(sum, stamp("last", "Last played before: " + relTime(s.prevLast), s.prevLast));
  else add(sum, mk("div", "last", "First time this Origin is played."));
  add(sum, mk("div", "legend",
    "Badge “Answered before” = this question already lives in your memory; custom quizzes avoid it first. " +
    "A “Last played” line is the date of your previous visit — no line means never."));

  var acts = mk("div", "acts");
  var again = mk("button", "btn primary press", "");
  add(again, mk("span", "btn-label", "Play again"));
  again.addEventListener("click", function () {
    var m = s.meta;
    if (m.kind === "custom") { launchCustom(m.lvlIdx, m.catIdx); return; }
    startSession(m, shuffle(qByQuiz[m.quizIdx].slice()));
  });
  var back = mk("button", "btn press", "");
  add(back, mk("span", "btn-label", "Back to menu"));
  back.addEventListener("click", function () {
    leavePlay();
    show("choice");
  });
  add(acts, again, back);
  add(sum, acts);
  add(stack, sum);

  // juice: celebrate a good run, and burst on a new best
  if (better) {
    setTimeout(function () { burstAt(sum.querySelector(".big"), pct(s.score, s.total) >= 50 ? 34 : 18); }, 160);
  } else if (pct(s.score, s.total) >= 50) {
    setTimeout(function () { burstAt(sum.querySelector(".big"), 16); }, 160);
  }
}

/* ---------- launchers ---------- */
function drawCustom(lvlIdx, catIdx) {
  var seen = {}, pool = [];
  for (var i = 0; i < Q.length; i++) {
    var q = Q[i];
    var eff = q[3] < 0 ? 1 : q[3];
    if (eff !== lvlIdx) continue;
    if (catIdx >= 0 && q[5] !== catIdx) continue;
    var k = normText(q[6]);
    if (seen[k]) continue;
    seen[k] = 1;
    pool.push(i);
  }
  var fresh = [], badged = [];
  for (var j = 0; j < pool.length; j++) {
    if (answered(Q[pool[j]][0])) badged.push(pool[j]);
    else fresh.push(pool[j]);
  }
  shuffle(fresh);
  shuffle(badged);
  var picks = fresh.slice(0, CUSTOM_N);
  if (picks.length < CUSTOM_N) picks = picks.concat(badged.slice(0, CUSTOM_N - picks.length));
  shuffle(picks);
  return picks;
}

function customMeta(lvlIdx, catIdx) {
  var title = catIdx < 0
    ? "Custom Quiz · " + lvlLabel(lvlIdx) + " · every Category"
    : "Custom Quiz · " + lvlLabel(lvlIdx) + " · " + CATS[catIdx];
  return { kind: "custom", title: title, lvlIdx: lvlIdx, catIdx: catIdx, total: CUSTOM_N };
}

function launchCustom(lvlIdx, catIdx) {
  var picks = drawCustom(lvlIdx, catIdx);
  var meta = customMeta(lvlIdx, catIdx);
  if (picks.length < CUSTOM_N) {
    meta.title += " · only " + picks.length + " available";
    meta.total = picks.length;
  }
  startSession(meta, picks);
}

function startCustom() {
  sfx("start");   // the one loud yes of a run: three ascending notes (Random 20 launch)
  var lvlIdx = chosenLvl;
  var lv = document.getElementById("pick-level");
  if (lv) {
    for (var i = 0; i < lv.children.length; i++) {
      if (lv.children[i].dataset.sel === "1") { lvlIdx = parseInt(lv.children[i].dataset.lvl, 10); break; }
    }
  }
  if (lvlIdx < 0) { toast("Pick a Difficulty first — it is required."); shakeEl(document.getElementById("pick-level")); return; }
  var catIdx = -1;
  if (catChipsEl) {
    for (var j = 0; j < catChipsEl.children.length; j++) {
      if (catChipsEl.children[j].dataset.sel === "1") { catIdx = parseInt(catChipsEl.children[j].dataset.cat, 10); break; }
    }
  }
  launchCustom(lvlIdx, catIdx);
}

function shakeEl(el) {
  if (!el || reduceMotion) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(function () { el.classList.remove("shake"); }, 400);
}

function startSourceQuiz(qi) {
  var qz = QUIZ[qi];
  var meta = {
    kind: "source",
    title: qz[0] + " · " + CATS[qz[1]],
    quizIdx: qi,
    lvlIdx: qz[2],
    catIdx: qz[1],
    total: qByQuiz[qi].length
  };
  startSession(meta, shuffle(qByQuiz[qi].slice()));
}

/* ---------- memory tools ---------- */
function wireMemoryTools() {
  var statsBtn = document.getElementById("btn-stats");
  statsBtn.addEventListener("click", function () {
    var parts = [countKeys(mem.a) + " questions answered", countKeys(mem.b) +
      " best scores kept"];
    var tmax = maxVal(mem.t);
    if (tmax) parts.push("last question played " + relTime(tmax));
    var smax = maxVal(mem.s);
    if (smax) parts.push("last session " + relTime(smax));
    toast("Memory: " + parts.join(" · ") + ".");
  });

  var armed = false;
  var disarm = 0;
  var resetBtn = document.getElementById("btn-reset");
  resetBtn.addEventListener("click", function () {
    if (!armed) {
      armed = true;
      resetBtn.textContent = "Really reset? Tap again";
      toast("This erases every best score and the Answered Set. Tap again to confirm.");
      if (disarm) clearTimeout(disarm);
      disarm = setTimeout(function () {
        armed = false;
        resetBtn.textContent = "Reset memory";
        disarm = 0;
      }, 6000);
      return;
    }
    armed = false;
    if (disarm) { clearTimeout(disarm); disarm = 0; }
    resetBtn.textContent = "Reset memory";
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    mem.a = {};
    mem.b = {};
    mem.t = {};
    mem.s = {};
    toast("Memory erased.");
  });
}

/* ---------- particle network ---------- */
function initNet() {
  if (reduceMotion) return;
  var cv = document.querySelector(".bg-net");
  if (!cv) return;
  var ctx = null;
  try { ctx = cv.getContext("2d"); } catch (e) { return; }

  var w = 0, h = 0, pts = [];
  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.max(16, Math.min(54, Math.round((w * h) / 26000)));
    pts = [];
    for (var i = 0; i < n; i++) {
      pts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.17, vy: (Math.random() - 0.5) * 0.17,
        r: 0.7 + Math.random() * 1.4
      });
    }
  }
  resize();
  window.addEventListener("resize", resize);

  var MAXD = 116;
  function frame() {
    ctx.clearRect(0, 0, w, h);
    var i, j;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -24) p.x = w + 24; else if (p.x > w + 24) p.x = -24;
      if (p.y < -24) p.y = h + 24; else if (p.y > h + 24) p.y = -24;
    }
    ctx.lineWidth = 0.7;
    for (i = 0; i < pts.length; i++) {
      for (j = i + 1; j < pts.length; j++) {
        var a = pts[i], b = pts[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > MAXD * MAXD) continue;
        var al = (1 - Math.sqrt(d2) / MAXD) * 0.15;
        ctx.strokeStyle = "rgba(126,204,222," + al.toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(186,228,238,.28)";
    for (i = 0; i < pts.length; i++) {
      var p2 = pts[i];
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, p2.r, 0, 6.2832);
      ctx.fill();
    }
  }
  (function loop() {
    frame();
    requestAnimationFrame(loop);
  })();
}

/* ---------- boot ---------- */
function onCorpus(payload) {
  D = payload;
  indexCorpus();
  renderFilters();
  renderCatChips();
  document.getElementById("stat-quizzes").textContent = String(QUIZ.length);
  document.getElementById("stat-questions").textContent = String(Q.length);
  // The gauge is full, so it fires — BEFORE "ready": the loader card is still on screen
  // (it lives in the Title Screen now, and the Title is visible while booting), so the
  // sparks are aimed at the real ring. Once "ready" lands, the card retires itself.
  if (loader) burstAt(loader.querySelector(".loader-gauge"), 20);
  var start = document.getElementById("btn-start");
  if (start) start.disabled = false;
  var about = document.getElementById("btn-about");
  if (about) about.disabled = false;
  // Loading sat ON the Title Screen, so it leaves the way a title card leaves: fade-and-
  // shrink out FIRST, then "ready" flips it to display:none (the CSS hides the loader
  // whenever kwizzy is not "boot", so setting it mid-fade would cut the fade).
  if (loader && !reduceMotion) {
    loader.classList.add("loader-out");
    setTimeout(function () {
      if (loader) loader.classList.remove("loader-out");
      document.body.dataset.kwizzy = "ready";
    }, 340);
  } else {
    document.body.dataset.kwizzy = "ready";
  }
}

function syncChoiceButtons() {
  var has = chosenLvl >= 0;
  var r = document.getElementById("btn-random");
  var e = document.getElementById("btn-existing");
  if (r) r.disabled = !has;
  if (e) e.disabled = !has;
}

function wireScreens() {
  // Title → Choice. Difficulty is required before either mode unlocks.
  document.getElementById("btn-start").addEventListener("click", function () { show("choice"); });
  document.getElementById("btn-about").addEventListener("click", function () { show("about"); });

  // Back arrows — and the Back KEY, both routed through goBack(). An arrow passes its own
  // data-back (so Categories returns to the MAIN MENU, not back through the difficulty
  // panel), the key passes backKey[screen], which mirrors those markup values. Both ask
  // for a second tap while a quiz is on (the confirmation).
  var backs = document.querySelectorAll("[data-back]");
  for (var b = 0; b < backs.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () { goBack(btn.dataset.back); });
    })(backs[b]);
  }
  // The BACK KEY. Escape and Backspace are the two keys a browser actually reports;
  // keyCode 4 is Android's legacy KEYCODE_BACK, kept because the user asked for the
  // hardware "back" button — but modern Android (12+) replaced that button with gesture
  // navigation, so it may never arrive. The on-screen back arrow is the reliable path
  // and shares this exact same goBack() behaviour, confirmation included.
  window.addEventListener("keydown", function (ev) {
    var isBack = ev.key === "Escape" || ev.key === "Backspace" ||
      ev.code === "Escape" || ev.code === "Backspace" || ev.keyCode === 4;
    if (!isBack) return;
    // While the settings panel is open, the Back key closes IT — the panel is the thing on
    // screen, so it is what Back must undo (goBack() routes this, one place, one behaviour).
    if (isMenuOpen()) { ev.preventDefault(); haptic(30); closeMenu(); return; }
    ev.preventDefault();
    haptic(40);
    goBack(backKey[screen]);
  });

  // Difficulty chips: one selection at a time, mirrored into chosenLvl.
  var lv = document.getElementById("pick-level");
  for (var i = 0; i < lv.children.length; i++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        chosenLvl = parseInt(chip.dataset.lvl, 10);
        // Exactly one Difficulty stays lit: data-sel is what the highlight CSS keys on.
        for (var k = 0; k < lv.children.length; k++) {
          var o = lv.children[k];
          if (o.dataset.sel === "1") o.removeAttribute("data-sel");
          if (o === chip) o.removeAttribute("aria-selected");
        }
        chip.dataset.sel = "1";
        sayChosenLevel();
        syncChoiceButtons();
        var el = document.getElementById("random-lvl-pill");
        if (el) el.textContent = lvlLabel(chosenLvl);
        burstAt(chip, 12);
      });
    })(lv.children[i]);
  }
  syncChoiceButtons();

  // Choice → Categories, in one of two modes.
  document.getElementById("btn-random").addEventListener("click", function () {
    if (chosenLvl < 0) { toast("Pick a Difficulty first — it is required."); shakeEl(lv); return; }
    catsMode = "random";
    show("cats");
  });
  document.getElementById("btn-existing").addEventListener("click", function () {
    if (chosenLvl < 0) { toast("Pick a Difficulty first — it is required."); shakeEl(lv); return; }
    catsMode = "existing";
    show("cats");
  });

  // Random 20 launch (category is optional).
  document.getElementById("btn-play-random").addEventListener("click", function () { startCustom(); });

  // Category cards open their quiz sheet (delegated).
  document.getElementById("grid").addEventListener("click", function (ev) {
    if (!ev.target || !ev.target.closest) return;
    var card = ev.target.closest("div[data-cat]");
    if (!card) return;
    toggleSheet(parseInt(card.dataset.cat, 10));
    resetCatCards();
    if (openCat >= 0 && sheetSlot && !reduceMotion) {
      setTimeout(function () {
        try { sheetSlot.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
      }, 60);
    }
  });
}

/* Fullscreen toggle. One class on <body> (`.fs`) flips --measure, which every column
   already reads, so the whole layout re-flows with no per-screen work. The button is a
   fixed element in the markup (not inside a screen) so it is there during loading too. */
var fsBtn = null;
function wireFs() {
  fsBtn = document.getElementById("btn-fs");
  if (!fsBtn) return;
  fsBtn.addEventListener("click", function () {
    var on = !document.body.classList.contains("fs");
    if (on) document.body.classList.add("fs");
    else document.body.classList.remove("fs");
    fsBtn.classList.toggle("on", on);
    toast(on ? "Fullscreen: content fills the whole screen."
              : "Fullscreen off: comfortable reading column back.");
  });
}

function boot() {
  loadMem();
  loadSettings();               // the player's audio/haptics choices, before anything sounds
  initLoader();
  wireMemoryTools();
  initNet();
  wirePress(document);
  wireFs();
  wireScreens();
  initSettingsPanel();          // the burger: toggles + the music choice, on every screen
  musicBoot();                  // loads Light ambient (or the saved choice) and starts it
  document.body.dataset.screen = "title";

  window.addEventListener("error", function (ev) {
    if (document.body.dataset.kwizzy !== "boot") return;
    if (loaderNote) loaderNote.textContent = "JS error: " + (ev.message || "unknown");
    if (loaderPct) loaderPct.textContent = "see console";
  });

  loadCorpus().then(onCorpus).catch(loaderError);
}

/* The harness that verifies this app in Node (media/music/_harness/run.js) loads this very
   file and asks for the music objects: they are closures, so there is no other way in. It
   only ever sets this flag (the app never does), and nothing here runs unless it is set. */
if (window.__kwizzyHarness) {
  window.__kw = {
    Music: Music, PLAYLIST: PLAYLIST, settings: function () { return settings; },
    menu: { open: openMenu, close: closeMenu, isOpen: isMenuOpen, sync: syncSettingsPanel },
    music: {
      start: musicStart, stop: musicStop, select: musicSelectTrack,
      unlock: musicUnlock, supported: musicSupported
    },
    haptic: haptic, sfx: sfx, show: show, goBack: goBack
  };
}

boot();
})();
