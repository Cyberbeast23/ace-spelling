/* Ace's Spelling Quest — pure logic (no DOM). Works in the browser (window.SpellCore) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpellCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var INTERVALS = [1, 2, 4, 7, 14, 30]; // days until next review after 1,2,3... correct in a row

  function localDate(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] + n);
    return localDate(d);
  }
  function daysBetween(a, b) { // b - a in days
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / DAY);
  }

  function normalize(s) {
    return String(s || '').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
  }

  /* ---------- data ---------- */
  function parseWords(data) {
    if (!data || !Array.isArray(data.lists)) throw new Error('words.json must have a "lists" array');
    var lists = [];
    var byWord = {};
    data.lists.forEach(function (l) {
      if (!l || !/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !Array.isArray(l.words)) return;
      var words = [];
      l.words.forEach(function (w) {
        if (!w || !w.word) return;
        var key = normalize(w.word);
        var entry = {
          word: String(w.word).trim(), key: key,
          definition: String(w.definition || '').trim(),
          sentence: String(w.sentence || '').trim(),
          syllables: w.syllables ? String(w.syllables).trim() : guessSyllables(key),
          date: l.date
        };
        if (!byWord[key] || byWord[key].date > l.date) byWord[key] = entry; // first date it appeared
        words.push(entry);
      });
      if (words.length) lists.push({ date: l.date, words: words });
    });
    lists.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { lists: lists, byWord: byWord, all: Object.keys(byWord).map(function (k) { return byWord[k]; }) };
  }

  // The list for "today": newest list dated on or before today (future-dated lists wait their turn).
  function currentList(parsed, today) {
    var cur = null;
    parsed.lists.forEach(function (l) { if (l.date <= today) cur = l; });
    return cur || parsed.lists[0] || null;
  }

  /* ---------- word helpers ---------- */
  function guessSyllables(word) {
    // Rough fallback when words.json doesn't give syllables: split before consonant+vowel groups.
    var w = word.toLowerCase();
    var parts = w.replace(/e$/, '').match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/g);
    if (!parts || parts.join('') === '') return word;
    var joined = parts.join('');
    var rest = w.slice(joined.length);
    if (rest) parts[parts.length - 1] += rest;
    return parts.join('-');
  }
  function syllableCount(entry) { return entry.syllables.split('-').length; }

  function blankSentence(sentence, word) {
    // Replace the word (and simple endings like -s, -ed, -ing) with a blank.
    var esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + esc + '(s|es|d|ed|ing|ly)?\\b', 'gi');
    var out = sentence.replace(re, '_____');
    if (out === sentence) { // try stem (e.g. "separate" -> "separating")
      var stem = esc.length > 4 ? esc.replace(/e$/, '') : esc;
      out = sentence.replace(new RegExp('\\b' + stem + '\\w*', 'gi'), '_____');
    }
    return out;
  }

  var TRICKY = [/(.)\1/, /kn|wr|gn|mb|gh|ps/, /ie|ei/, /our/, /ph/, /tion|sion|ture/, /ous/, /que/, /ough|augh/, /y[^aeiou]/];
  function baseDifficulty(entry) {
    var k = entry.key, d = k.length / 2;
    TRICKY.forEach(function (re) { if (re.test(k)) d += 1; });
    return d;
  }
  // Personal difficulty: base + how often Ace has missed it.
  function difficulty(entry, stats) {
    var s = stats && stats[entry.key];
    var miss = s && s.attempts ? (s.attempts - s.correct) / s.attempts : 0;
    return baseDifficulty(entry) + miss * 6;
  }

  /* ---------- feedback: which letters were wrong ---------- */
  // Returns [{ch, ok}] for each letter of the correct word (ok=false => highlight), plus an overall "missing/extra" note.
  function diffLetters(target, attempt) {
    var t = normalize(target), a = normalize(attempt);
    var n = t.length, m = a.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); dp[i][0] = i; }
    for (j = 0; j <= m; j++) dp[0][j] = j;
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (t[i - 1] === a[j - 1] ? 0 : 1));
    }
    var ok = new Array(n).fill(true);
    i = n; j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (t[i - 1] === a[j - 1] ? 0 : 1)) {
        if (t[i - 1] !== a[j - 1]) ok[i - 1] = false;
        i--; j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { ok[i - 1] = false; i--; } // missing letter
      else { // extra letter typed: mark neighbour in target
        if (n) ok[Math.min(i, n - 1)] = false;
        j--;
      }
    }
    return { letters: t.split('').map(function (ch, k) { return { ch: ch, ok: ok[k] }; }), distance: dp[n][m] };
  }

  // Did he use the American spelling of a Canadian word? (favorite vs favourite, center vs centre)
  function isAmericanVariant(target, attempt) {
    var t = normalize(target), a = normalize(attempt);
    if (t === a) return false;
    return (t.indexOf('our') >= 0 && t.replace(/our/g, 'or') === a) ||
           (/re$/.test(t) && t.replace(/re$/, 'er') === a) ||
           (t.indexOf('ll') >= 0 && t.replace('ll', 'l') === a);
  }

  /* ---------- progress state ---------- */
  function emptyState() {
    return { version: 1, words: {}, points: 0, stars: 0, days: [], recent: [], sessions: 0, best: 0 };
  }
  function wordStat(state, key) {
    if (!state.words[key]) state.words[key] = { attempts: 0, correct: 0, streak: 0, misses: 0, lastSeen: null, due: null, interval: 0 };
    return state.words[key];
  }
  // Record one answer. firstTry=false for re-queued retries within a session (they don't grow the review interval).
  function recordAnswer(state, key, correct, today, firstTry) {
    var s = wordStat(state, key);
    s.attempts++;
    s.lastSeen = today;
    if (correct) {
      s.correct++;
      if (firstTry !== false) {
        s.streak++;
        s.interval = INTERVALS[Math.min(s.streak - 1, INTERVALS.length - 1)];
        s.due = addDays(today, s.interval);
      }
    } else {
      s.streak = 0; s.misses++; s.interval = 0; s.due = today;
    }
    state.recent.push(correct ? 1 : 0);
    if (state.recent.length > 20) state.recent = state.recent.slice(-20);
    if (state.days.indexOf(today) < 0) { state.days.push(today); state.days.sort(); }
    return s;
  }
  function isMastered(s) { return !!s && s.streak >= 3 && s.correct >= 3; }

  function accuracy(state) {
    var r = state.recent;
    if (!r.length) return null;
    return r.reduce(function (a, b) { return a + b; }, 0) / r.length;
  }
  // 'struggling' | 'steady' | 'strong'
  function level(state) {
    var r = state.recent, acc = accuracy(state);
    if (r.length >= 5 && acc < 0.6) return 'struggling';
    if (r.length >= 8 && acc >= 0.85) return 'strong';
    return 'steady';
  }

  function dayStreak(state, today) {
    var set = {}; state.days.forEach(function (d) { set[d] = 1; });
    var d = set[today] ? today : addDays(today, -1); // streak still alive if he practised yesterday
    var n = 0;
    while (set[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  function trickyWords(state, parsed) {
    return Object.keys(state.words).filter(function (k) {
      var s = state.words[k]; return s.misses > 0 && !isMastered(s) && parsed.byWord[k];
    }).sort(function (a, b) {
      var sa = state.words[a], sb = state.words[b];
      return (sb.misses / sb.attempts) - (sa.misses / sa.attempts) || sb.misses - sa.misses;
    }).map(function (k) { return { entry: parsed.byWord[k], stat: state.words[k] }; });
  }

  /* ---------- building sets ---------- */
  function weightedSample(items, weightFn, n, rand) {
    rand = rand || Math.random;
    var pool = items.map(function (it) { return { it: it, w: Math.max(0.01, weightFn(it)) }; });
    var out = [];
    while (out.length < n && pool.length) {
      var total = pool.reduce(function (a, p) { return a + p.w; }, 0), r = rand() * total, idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      out.push(pool[idx].it); pool.splice(idx, 1);
    }
    return out;
  }
  function shuffle(a, rand) {
    rand = rand || Math.random; a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Weight for review: missed words and overdue words come up much more often; mastered, not-yet-due words rarely.
  function reviewWeight(entry, state, today) {
    var s = state.words[entry.key];
    if (!s || !s.attempts) return 3;              // never practised
    var w = 1 + s.misses * 3 + (1 - s.correct / s.attempts) * 4;
    if (s.due && s.due <= today) w += 3 + Math.min(daysBetween(s.due, today), 10) * 0.5; // due / overdue
    else if (s.due) w *= 0.3;                    // not due yet
    if (isMastered(s)) w *= 0.4;
    return w;
  }

  function settingsFor(mode, lvl) {
    var s = { size: 10, hints: ['first', 'count', 'syllables'], timer: 0, extraHard: 0, points: 10 };
    if (lvl === 'struggling') { s.size = mode === 'today' ? 5 : 6; s.offerHints = true; }
    if (lvl === 'strong') { s.extraHard = mode === 'challenge' ? 0 : 2; s.size = mode === 'today' ? 10 : 12; }
    if (mode === 'challenge') {
      s.points = 15;
      if (lvl === 'strong') { s.hints = []; s.timer = 1; }      // no hints, beat the clock
      else if (lvl === 'steady') { s.hints = ['count']; }
      s.size = lvl === 'struggling' ? 6 : lvl === 'strong' ? 12 : 10;
    } else if (lvl === 'strong') {
      s.hints = mode === 'today' ? ['count'] : [];            // brand-new words keep one small hint
    }
    return s;
  }
  function timerSeconds(entry) { return Math.round(10 + entry.key.length * 1.5); }

  // Build a practice set. Returns {items:[entry], settings, note}
  function buildSet(mode, parsed, state, today, opts) {
    opts = opts || {};
    var lvl = opts.level || level(state);
    var set = settingsFor(mode, lvl), items = [], note = '';
    var list = opts.date ? parsed.lists.filter(function (l) { return l.date === opts.date; })[0] : currentList(parsed, today);
    var listDate = list ? list.date : today;
    var earlier = parsed.all.filter(function (e) { return e.date < listDate; });

    if (mode === 'today') {
      var words = list ? list.words.slice() : [];
      if (words.length > set.size) {
        // shorter set: the words he knows least first
        words = words.slice().sort(function (a, b) { return difficulty(b, state.words) - difficulty(a, state.words); })
          .filter(function (e) { return !isMastered(state.words[e.key]); }).slice(0, set.size);
        if (words.length < set.size) words = list.words.slice(0, set.size);
        note = 'A shorter set today — ' + words.length + ' words. You can play again for the rest!';
      }
      items = shuffle(words);
      if (set.extraHard && earlier.length) {
        var hard = earlier.slice().sort(function (a, b) { return difficulty(b, state.words) - difficulty(a, state.words); })
          .slice(0, Math.max(set.extraHard * 3, 6));
        var bonus = weightedSample(hard, function () { return 1; }, set.extraHard);
        bonus.forEach(function (b) { b = Object.assign({}, b, { bonus: true }); items.splice(Math.floor(Math.random() * (items.length + 1)), 0, b); });
        if (bonus.length) note = 'You\u2019re on a roll! ' + bonus.length + ' tougher review words are mixed in.';
      }
    } else if (mode === 'review') {
      var pool = earlier.length ? earlier : parsed.all;
      if (!earlier.length) note = 'Only one day of words so far, so Review uses those. It gets more mixed as new days are added!';
      var weightFn = function (e) {
        var w = reviewWeight(e, state, today);
        if (set.extraHard) w *= 1 + baseDifficulty(e) / 6; // strong: lean toward harder words
        return w;
      };
      items = weightedSample(pool, weightFn, Math.min(set.size, pool.length));
    } else { // challenge
      var cpool = parsed.all;
      items = weightedSample(cpool, function (e) {
        return Math.pow(difficulty(e, state.words), 2) * (isMastered(state.words[e.key]) ? 0.6 : 1);
      }, Math.min(set.size, cpool.length));
    }
    return { mode: mode, level: lvl, items: items, settings: set, note: note, listDate: listDate };
  }

  /* ---------- session queue ---------- */
  function Session(set) {
    this.mode = set.mode; this.settings = set.settings; this.level = set.level;
    this.queue = set.items.map(function (e) { return { entry: e, retry: false }; });
    this.pos = 0; this.results = []; this.points = 0; this.requeued = {};
    this.firstTryCorrect = 0; this.firstTryTotal = 0;
  }
  Session.prototype.current = function () { return this.queue[this.pos] || null; };
  Session.prototype.done = function () { return this.pos >= this.queue.length; };
  // answer(): returns {correct, points, diff, american}
  Session.prototype.answer = function (text, usedHint, timedOut) {
    var item = this.current();
    var correct = !timedOut && normalize(text) === item.entry.key;
    var pts = 0;
    if (correct) pts = item.retry ? 3 : usedHint ? Math.ceil(this.settings.points / 2) : this.settings.points;
    this.points += pts;
    if (!item.retry) { this.firstTryTotal++; if (correct) this.firstTryCorrect++; }
    this.results.push({ key: item.entry.key, correct: correct, retry: item.retry, attempt: text });
    if (!correct) {
      var n = this.requeued[item.entry.key] || 0;
      if (n < 2) { // bring it back later in the session (a few words later, or at the end)
        this.requeued[item.entry.key] = n + 1;
        var at = Math.min(this.queue.length, this.pos + 4);
        this.queue.splice(at, 0, { entry: item.entry, retry: true });
      }
    }
    return { correct: correct, retry: item.retry, points: pts, diff: diffLetters(item.entry.key, text || ''),
             american: !correct && isAmericanVariant(item.entry.key, text) };
  };
  Session.prototype.next = function () { this.pos++; return this.current(); };
  Session.prototype.starsEarned = function () {
    if (!this.firstTryTotal) return 0;
    var acc = this.firstTryCorrect / this.firstTryTotal;
    return acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
  };

  return {
    localDate: localDate, addDays: addDays, daysBetween: daysBetween, normalize: normalize,
    parseWords: parseWords, currentList: currentList, guessSyllables: guessSyllables, syllableCount: syllableCount,
    blankSentence: blankSentence, baseDifficulty: baseDifficulty, difficulty: difficulty,
    diffLetters: diffLetters, isAmericanVariant: isAmericanVariant,
    emptyState: emptyState, recordAnswer: recordAnswer, isMastered: isMastered, accuracy: accuracy, level: level,
    dayStreak: dayStreak, trickyWords: trickyWords, weightedSample: weightedSample, shuffle: shuffle,
    reviewWeight: reviewWeight, settingsFor: settingsFor, timerSeconds: timerSeconds, buildSet: buildSet, Session: Session
  };
});
