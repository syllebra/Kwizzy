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
   s: Origin key  -> epoch ms (Last Time of an Origin: q:<quizIdx> / c:<lvl> / c:<lvl>|<cat>). */
var REVEAL_MS = 2500;
var CUSTOM_N = 20;
var LS_KEY = "kwizzy.v1";

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
      renderGrid();
    }
  }
}

/* ---------- juice: press shake, particle burst, screen shake ---------- */
function wirePress(root) {
  var r = root || document;
  r.addEventListener("pointerdown", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest(".press, .opt, .catcard, .fchip, .mode-card, .iconbtn") : null;
    if (!t || t.disabled) return;
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

// A short screen-level thump, for correct/incorrect feedback.
function thump(el, cls) {
  if (!el || reduceMotion) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(function () { el.classList.remove(cls); }, 520);
}


/* ---------- loader ---------- */
var loader = null, loaderFill = null, loaderNote = null, loaderPct = null;

function initLoader() {
  loader = document.getElementById("loader");
  loaderFill = loader.querySelector(".loader-bar i");
  loaderNote = loader.querySelector(".loader-note");
  loaderPct = mk("p", "loader-pct");
  loader.appendChild(loaderPct);
}
function setProgress(frac, label) {
  if (loaderFill) loaderFill.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + "%";
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
      if (total > 0) setProgress(got / total, fmtBytes(got) + " / " + fmtBytes(total));
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
  setProgress(1, fmtBytes(got) + " received");
  if (loaderNote) loaderNote.textContent = "Decoding and indexing…";
  var text = new TextDecoder("utf-8").decode(joinBytes(chunks));
  var parsed = JSON.parse(text);
  var ms = Date.now() - t0;
  if (loaderNote) loaderNote.textContent = "Corpus ready in " + (ms / 1000).toFixed(1) + " s";
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
      add(box, c);
    }
    add(filtersEl, box);
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
    card.addEventListener("click", function (ev) {
      if (done) return;
      var t = null;
      if (ev.target) t = ev.target.closest ? ev.target.closest("button.opt") : null;
      if (!t || !t.dataset.slot) return;
      done = true;
      resolve(parseInt(t.dataset.slot, 10));
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
    document.body.dataset.kwizzy = "ready";
    stage.hidden = true;
    stage.className = "";
    stack = null;
    hud = null;
    session = null;
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
  document.body.dataset.kwizzy = "ready";
  var start = document.getElementById("btn-start");
  if (start) start.disabled = false;
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

  // Back arrows.
  var backs = document.querySelectorAll("[data-back]");
  for (var b = 0; b < backs.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () { show(btn.dataset.back); });
    })(backs[b]);
  }

  // Difficulty chips: one selection at a time, mirrored into chosenLvl.
  var lv = document.getElementById("pick-level");
  for (var i = 0; i < lv.children.length; i++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        chosenLvl = parseInt(chip.dataset.lvl, 10);
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

function boot() {
  loadMem();
  initLoader();
  wireMemoryTools();
  initNet();
  wirePress(document);
  wireScreens();
  document.body.dataset.screen = "title";

  window.addEventListener("error", function (ev) {
    if (document.body.dataset.kwizzy !== "boot") return;
    if (loaderNote) loaderNote.textContent = "JS error: " + (ev.message || "unknown");
    if (loaderPct) loaderPct.textContent = "see console";
  });

  loadCorpus().then(onCorpus).catch(loaderError);
}

boot();
})();
