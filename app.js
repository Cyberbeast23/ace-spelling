/* Ace's Spelling Quest — UI */
(function () {
  'use strict';
  var C = window.SpellCore;
  var KEY = 'aceSpelling.v1';
  var $ = function (id) { return document.getElementById(id); };
  var parsed = null, state = load(), session = null, lastMode = 'today', lastDate = null;
  var usedHint = false, answered = false, timerId = null, timeLeft = 0;

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version === 1) return Object.assign(C.emptyState(), s); } catch (e) {}
    return C.emptyState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function today() { return C.localDate(); }

  /* ---------- speech ---------- */
  var synth = window.speechSynthesis, voice = null;
  function pickVoice() {
    if (!synth) return;
    var vs = synth.getVoices() || [];
    var find = function (lang) { return vs.filter(function (v) { return v.lang && v.lang.replace('_', '-').toLowerCase() === lang; }); };
    var ca = find('en-ca'), us = find('en-us');
    var best = function (list) { return list.filter(function (v) { return /natural|google|samantha|enhanced|premium/i.test(v.name); })[0] || list[0]; };
    voice = best(ca) || best(us) || vs.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  if (synth) { pickVoice(); if ('onvoiceschanged' in synth) synth.onvoiceschanged = pickVoice; }
  function say(parts, rate) {
    if (!synth) return;
    synth.cancel();
    [].concat(parts).forEach(function (text) {
      var u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-CA';
      u.rate = rate || 0.85; u.pitch = 1.05;
      synth.speak(u);
    });
  }
  function spokenSentence(e) { return C.blankSentence(e.sentence, e.word).replace(/_____/g, 'blank'); }
  function sayWord(slow) { var e = session.current().entry; say(slow ? [e.word, e.syllables.replace(/-/g, ', ')] : ['Spell: ' + e.word + '.'], slow ? 0.55 : 0.85); }
  function saySentence() { var e = session.current().entry; say([spokenSentence(e), 'Spell: ' + e.word + '.']); }

  /* ---------- sounds + confetti ---------- */
  var actx = null;
  function tone(freqs) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.12;
        o.frequency.value = f; o.type = 'triangle'; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.26);
      });
    } catch (e) {}
  }
  function confetti(n) {
    var box = $('confetti'), bits = ['⭐', '🎉', '✨', '🌟', '🎈', '💜'];
    for (var i = 0; i < (n || 18); i++) {
      var s = document.createElement('span'); s.className = 'bit';
      s.textContent = bits[i % bits.length];
      s.style.left = Math.random() * 100 + 'vw'; s.style.animationDelay = Math.random() * 0.4 + 's';
      box.appendChild(s); setTimeout(function (el) { el.remove(); }.bind(null, s), 2200);
    }
  }
  var CHEERS = ['Awesome!', 'Nailed it!', 'Super speller!', 'You got it!', 'Brilliant!', 'Way to go, Ace!', 'Fantastic!', 'Spot on!'];
  var ENCOURAGE = ['Almost! Look at the pink letters.', 'Good try! Here\u2019s how it\u2019s spelled.', 'So close! This word will come back soon.', 'Nice effort! Tricky one.'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- views ---------- */
  function show(view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view || (view !== 'progress' && t.dataset.view === 'home')); });
    if (view === 'progress') renderProgress();
    if (view === 'home') renderHome();
    window.scrollTo(0, 0);
  }

  function renderHome() {
    if (!parsed) return;
    var lvl = C.level(state), list = C.currentList(parsed, today());
    var msg = {
      struggling: '🌱 Warm-up mode: hints are on and sets are shorter. You\u2019ve got this!',
      steady: '🙂 Hints are ready if you need them. Keep going!',
      strong: '🔥 You\u2019re on fire! Harder words are mixed in, and Challenge has a timer with no hints.'
    }[lvl];
    $('level-badge').textContent = msg;
    $('today-desc').textContent = list ? list.words.length + ' words \u2022 ' + niceDate(list.date) : 'No words yet';
    $('challenge-desc').textContent = lvl === 'strong' ? 'Hardest words, beat the clock — no hints!' : 'The hardest words — bonus points!';
    var streak = C.dayStreak(state, today());
    $('home-sub').textContent = streak > 1 ? 'You\u2019re on a ' + streak + '-day streak! 🔥' : 'Ready to spell some words?';
    var earlier = parsed.lists.filter(function (l) { return !list || l.date !== list.date; });
    $('pick-day-wrap').hidden = !earlier.length;
    $('pick-day').innerHTML = earlier.slice().reverse().map(function (l) { return '<option value="' + l.date + '">' + niceDate(l.date) + '</option>'; }).join('');
  }
  function niceDate(d) {
    var p = d.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ---------- quiz ---------- */
  function start(mode, date) {
    lastMode = mode; lastDate = date || null;
    var set = C.buildSet(mode, parsed, state, today(), { date: date });
    if (!set.items.length) { alert('No words to practise yet!'); return; }
    session = new C.Session(set);
    $('quiz-points').textContent = '0';
    $('quiz-note').hidden = !set.note; $('quiz-note').textContent = set.note;
    show('quiz');
    renderQuestion(true);
  }

  function renderQuestion(speak) {
    var item = session.current(), e = item.entry;
    usedHint = false; answered = false;
    $('quiz-bar').style.width = (session.pos / session.queue.length * 100) + '%';
    var tag = $('quiz-tag');
    tag.className = 'tag' + (item.retry ? ' retry' : e.bonus ? ' bonus' : '');
    tag.textContent = item.retry ? '🔁 Try this one again' : e.bonus ? '💪 Bonus review word' :
      'Word ' + (session.results.filter(function (r) { return !r.retry; }).length + 1) + ' of ' + session.queue.filter(function (q) { return !q.retry; }).length;
    $('quiz-def').textContent = e.definition;
    $('quiz-sentence').textContent = C.blankSentence(e.sentence, e.word);
    $('hint-out').textContent = ''; delete $('hint-out').dataset.parts;
    $('feedback').hidden = true; $('btn-next').hidden = true;
    $('answer').value = ''; $('answer').disabled = false; $('btn-check').disabled = false;
    $('quiz-card').classList.remove('shake');
    renderHints(e, item.retry);
    startTimer(e);
    if (speak) sayWord(false);
    setTimeout(function () { $('answer').focus(); }, 50);
  }

  function renderHints(e, retry) {
    var s = session.settings, box = $('hints');
    var labels = { first: '🔤 First letter', count: '🔢 How many letters', syllables: '👏 Syllables' };
    box.innerHTML = '';
    s.hints.forEach(function (h) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'hint-btn' + ((s.offerHints || retry) ? ' glow' : '');
      b.textContent = labels[h]; b.dataset.hint = h;
      b.onclick = function () { useHint(h, e); b.disabled = true; b.classList.remove('glow'); };
      box.appendChild(b);
    });
    if (s.offerHints && s.hints.length) $('hint-out').textContent = 'Need help? Tap a hint button! 💡';
  }
  function useHint(h, e) {
    usedHint = true;
    var out = $('hint-out'), cur = out.dataset.parts ? JSON.parse(out.dataset.parts) : {};
    if (out.textContent.indexOf('Need help') === 0) cur = {};
    if (h === 'first') cur.first = 'Starts with "' + e.key[0].toUpperCase() + '"';
    if (h === 'count') cur.count = e.key.length + ' letters: ' + e.key.split('').map(function () { return '_'; }).join(' ');
    if (h === 'syllables') { var n = C.syllableCount(e); cur.syl = n + ' syllable' + (n > 1 ? 's' : '') + ': ' + e.syllables.split('-').map(function (p) { return p.replace(/./g, '•'); }).join(' - '); say(e.syllables.split('-').map(function (p) { return p; }).join('... '), 0.6); }
    out.dataset.parts = JSON.stringify(cur);
    out.textContent = [cur.first, cur.count, cur.syl].filter(Boolean).join('  \u2022  ');
    $('answer').focus();
  }

  function startTimer(e) {
    clearInterval(timerId);
    var wrap = $('timer-wrap');
    if (!session.settings.timer) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var total = C.timerSeconds(e); timeLeft = total;
    var tick = function () {
      $('timer-bar').style.width = (timeLeft / total * 100) + '%';
      $('timer-text').textContent = '⏱ ' + timeLeft + 's';
      if (timeLeft <= 0) { clearInterval(timerId); if (!answered) submit(true); }
      timeLeft--;
    };
    tick(); timerId = setInterval(tick, 1000);
  }

  function submit(timedOut) {
    if (answered) return;
    var text = $('answer').value;
    if (!timedOut && !C.normalize(text)) { $('answer').focus(); return; }
    answered = true; clearInterval(timerId);
    var item = session.current(), e = item.entry;
    var bonusTime = session.settings.timer && !timedOut ? Math.max(0, timeLeft) : 0;
    var r = session.answer(text, usedHint, timedOut);
    if (r.correct && bonusTime > 3 && !item.retry) { session.points += 5; r.points += 5; }
    C.recordAnswer(state, e.key, r.correct, today(), !item.retry);
    state.points += r.points; save();
    $('quiz-points').textContent = session.points;
    $('answer').disabled = true; $('btn-check').disabled = true;
    document.querySelectorAll('.hint-btn').forEach(function (b) { b.disabled = true; b.classList.remove('glow'); });
    var fb = $('feedback'); fb.hidden = false;
    if (r.correct) {
      fb.className = 'feedback good';
      fb.innerHTML = '<span class="big">🎉 ' + pick(CHEERS) + '</span><div class="spell"><span class="ok">' + esc(e.word) + '</span></div>+' + r.points + ' points' + (bonusTime > 3 && !item.retry ? ' (speed bonus!)' : '');
      tone([660, 880, 1175]); confetti();
    } else {
      fb.className = 'feedback bad';
      var letters = r.diff.letters.map(function (l) { return '<span class="' + (l.ok ? 'ok' : 'bad') + '">' + esc(l.ch) + '</span>'; }).join('');
      var why = timedOut ? '⏰ Time\u2019s up!' : r.american ? '🇨🇦 So close! That\u2019s the American spelling. In Canada we write it like this:' : pick(ENCOURAGE);
      fb.innerHTML = '<span class="big">' + why + '</span><div class="spell">' + letters + '</div>' +
        (text.trim() ? '<div class="yours">You typed: ' + esc(text.trim()) + '</div>' : '') +
        (session.requeued[e.key] && session.queue.slice(session.pos + 1).some(function (q) { return q.entry.key === e.key; }) ? '<div class="yours">This word will come back in a little while. 🔁</div>' : '');
      tone([330, 262]); $('quiz-card').classList.add('shake');
      say([e.word + '. ' + e.key.split('').join(', ') + '.'], 0.75);
    }
    $('btn-next').hidden = false; $('btn-next').textContent = session.pos + 1 >= session.queue.length ? 'See results 🏁' : 'Next ➜';
    setTimeout(function () { $('btn-next').focus(); }, 30);
  }

  function next() {
    session.next();
    if (session.done()) return finish();
    renderQuestion(true);
  }

  function finish() {
    clearInterval(timerId);
    if (synth) synth.cancel();
    var stars = session.starsEarned();
    state.stars += stars; state.sessions++; state.best = Math.max(state.best, session.points); save();
    $('quiz-bar').style.width = '100%';
    $('res-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    $('res-title').textContent = stars === 3 ? 'Amazing, Ace! 🏆' : stars === 2 ? 'Great job, Ace! 🎉' : 'Good practice, Ace! 💪';
    $('res-summary').textContent = 'You spelled ' + session.firstTryCorrect + ' of ' + session.firstTryTotal + ' on the first try and earned ' + session.points + ' points.';
    var missed = {};
    session.results.forEach(function (r) { if (!r.correct) missed[r.key] = parsed.byWord[r.key] ? parsed.byWord[r.key].word : r.key; });
    var keys = Object.keys(missed);
    $('res-missed').innerHTML = keys.length ? '<p>Words to practise again:</p><ul>' + keys.map(function (k) { return '<li>' + esc(missed[k]) + '</li>'; }).join('') + '</ul>' : '<p>No mistakes — perfect! 🌟</p>';
    if (stars >= 2) confetti(30);
    show('results');
  }

  /* ---------- progress ---------- */
  function renderProgress() {
    if (!parsed) return;
    var t = today(), mastered = 0;
    parsed.all.forEach(function (e) { if (C.isMastered(state.words[e.key])) mastered++; });
    $('p-points').textContent = state.points;
    $('p-stars').textContent = state.stars;
    $('p-streak').textContent = C.dayStreak(state, t);
    $('p-mastered').textContent = mastered + ' / ' + parsed.all.length;
    var acc = C.accuracy(state);
    $('p-accuracy').textContent = acc === null ? 'Play a round to start earning stars!' : 'Recent accuracy: ' + Math.round(acc * 100) + '% ' + (acc >= 0.85 ? '🔥' : acc >= 0.6 ? '👍' : '🌱');
    var tricky = C.trickyWords(state, parsed);
    $('p-tricky').innerHTML = tricky.length ? tricky.slice(0, 15).map(function (x) {
      return '<li><span class="w">' + esc(x.entry.word) + '</span><span>' + x.stat.correct + ' / ' + x.stat.attempts + ' right</span></li>';
    }).join('') : '<li>No tricky words yet. Nice! 😎</li>';
    $('p-words').innerHTML = parsed.all.slice().sort(function (a, b) { return a.key < b.key ? -1 : 1; }).map(function (e) {
      var s = state.words[e.key], cls = C.isMastered(s) ? ' m' : s && s.misses && !s.streak ? ' t' : '';
      return '<span class="chip' + cls + '" title="' + (s ? s.correct + '/' + s.attempts + ' right' : 'not tried yet') + '">' + (cls === ' m' ? '🏅 ' : '') + esc(e.word) + '</span>';
    }).join('');
  }

  /* ---------- wiring ---------- */
  document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { if (session && !session.done() && $('view-quiz').classList.contains('active') && !confirm('Stop this round?')) return; clearInterval(timerId); show(t.dataset.view); }; });
  document.querySelectorAll('.mode-card').forEach(function (b) { b.onclick = function () { start(b.dataset.mode); }; });
  $('btn-pick-day').onclick = function () { start('today', $('pick-day').value); };
  $('btn-say-word').onclick = function () { sayWord(false); $('answer').focus(); };
  $('btn-say-slow').onclick = function () { sayWord(true); $('answer').focus(); };
  $('btn-say-sentence').onclick = function () { saySentence(); $('answer').focus(); };
  $('answer-form').onsubmit = function (ev) { ev.preventDefault(); submit(false); };
  $('btn-next').onclick = next;
  $('btn-quit').onclick = function () { clearInterval(timerId); if (synth) synth.cancel(); if (session.results.length) finish(); else show('home'); };
  $('btn-again').onclick = function () { start(lastMode, lastDate); };
  $('btn-home').onclick = function () { show('home'); };
  $('btn-reset').onclick = function () { if (confirm('Erase all progress on this device? This can\u2019t be undone.')) { state = C.emptyState(); save(); renderProgress(); } };
  if (!synth) $('speech-warn').hidden = false;

  fetch('words.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { parsed = C.parseWords(data); renderHome(); window.__aceReady = true; })
    .catch(function (err) { $('home-sub').textContent = 'Oops, couldn\u2019t load the words (' + err.message + '). Try refreshing!'; window.__aceError = String(err); });

  window.AceApp = { get state() { return state; }, get session() { return session; }, start: start };
})();
