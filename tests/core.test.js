// Run: node tests/core.test.js
const assert = require('assert');
const C = require('../core.js');
const data = JSON.parse(require('fs').readFileSync(__dirname + '/../words.json', 'utf8'));
const extra = JSON.parse(JSON.stringify(data));
extra.lists.unshift({ date: '2026-09-21', words: [
  { word: 'beautiful', definition: 'very pretty', sentence: 'What a beautiful sunset.' },
  { word: 'cat', definition: 'a pet', sentence: 'The cat sleeps.' },
  { word: 'necessary', definition: 'needed', sentence: 'Water is necessary for life.' }] });
extra.lists.push({ date: '2099-01-01', words: [{ word: 'future', definition: 'later', sentence: 'The future is bright.' }] });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

const P = C.parseWords(data), PX = C.parseWords(extra), today = '2026-09-28';
t('parses seed list', () => { assert.equal(P.lists.length, 1); assert.equal(P.all.length, 10); });
t('current list ignores future-dated lists', () => assert.equal(C.currentList(PX, today).date, '2026-09-28'));
t('blanks the word in every sentence', () => P.all.forEach(e => { const b = C.blankSentence(e.sentence, e.word); assert(b.includes('_____') && !b.toLowerCase().includes(e.key), e.key); }));
t('case/space-insensitive compare, Canadian spelling required', () => {
  const s = new C.Session({ mode: 'today', level: 'steady', settings: C.settingsFor('today', 'steady'), items: [P.byWord.favourite] });
  const r = s.answer('favorite'); assert.equal(r.correct, false); assert.equal(r.american, true);
  assert.equal(s.queue.length, 2, 'wrong word re-queued'); s.next();
  assert.equal(s.current().retry, true); assert.equal(s.answer('  Favourite ').correct, true);
});
t('diff highlights wrong letters', () => {
  const d = C.diffLetters('separate', 'seperate'); assert.deepEqual(d.letters.map(l => l.ok ? '.' : l.ch).join(''), '...a....');
  assert(C.diffLetters('knowledge', 'nowledge').letters[0].ok === false);
  assert(C.diffLetters('believe', 'believe').letters.every(l => l.ok));
});
t('requeue at most twice per word', () => {
  const s = new C.Session({ mode: 'today', level: 'steady', settings: C.settingsFor('today', 'steady'), items: [P.byWord.mystery] });
  let guard = 0; while (!s.done() && guard++ < 10) { s.answer('mistery'); s.next(); }
  assert.equal(s.results.length, 3);
});
t('spaced repetition intervals + mastery', () => {
  const st = C.emptyState();
  C.recordAnswer(st, 'curious', true, today); assert.equal(st.words.curious.due, '2026-09-29');
  C.recordAnswer(st, 'curious', true, '2026-09-29'); assert.equal(st.words.curious.due, '2026-10-01');
  C.recordAnswer(st, 'curious', true, '2026-10-01'); assert(C.isMastered(st.words.curious));
  C.recordAnswer(st, 'curious', false, '2026-10-05'); assert.equal(st.words.curious.streak, 0); assert.equal(st.words.curious.due, '2026-10-05');
  C.recordAnswer(st, 'curious', true, '2026-10-05', false); assert.equal(st.words.curious.streak, 0, 'retry does not grow streak');
});
t('levels from accuracy', () => {
  const st = C.emptyState(); assert.equal(C.level(st), 'steady');
  for (let i = 0; i < 6; i++) C.recordAnswer(st, 'x' + i, i === 0, today); assert.equal(C.level(st), 'struggling');
  const s2 = C.emptyState(); for (let i = 0; i < 10; i++) C.recordAnswer(s2, 'x' + i, true, today); assert.equal(C.level(s2), 'strong');
});
t('struggling: shorter sets + hints offered; strong: challenge has timer, no hints', () => {
  const s = C.buildSet('today', P, C.emptyState(), today, { level: 'struggling' });
  assert.equal(s.items.length, 5); assert(s.settings.offerHints); assert.deepEqual(s.settings.hints, ['first', 'count', 'syllables']);
  const c = C.buildSet('challenge', P, C.emptyState(), today, { level: 'strong' });
  assert.equal(c.settings.timer, 1); assert.deepEqual(c.settings.hints, []);
  assert.deepEqual(C.buildSet('review', P, C.emptyState(), today, { level: 'strong' }).settings.hints, []);
});
t('strong: today adds harder review words from earlier days', () => {
  const s = C.buildSet('today', PX, C.emptyState(), today, { level: 'strong' });
  assert.equal(s.items.length, 12); assert.equal(s.items.filter(e => e.bonus).length, 2);
});
t('review draws from earlier days, weighted to missed words', () => {
  const st = C.emptyState();
  for (let i = 0; i < 3; i++) C.recordAnswer(st, 'necessary', false, today);
  C.recordAnswer(st, 'cat', true, today); C.recordAnswer(st, 'beautiful', true, today);
  let firsts = { necessary: 0 };
  for (let i = 0; i < 300; i++) { const s = C.buildSet('review', PX, st, today, { level: 'steady' }); assert(s.items.every(e => e.date < '2026-09-28')); if (s.items[0].key === 'necessary') firsts.necessary++; }
  assert(firsts.necessary > 200, 'missed word usually comes first: ' + firsts.necessary);
  assert(C.buildSet('review', P, st, today).note.includes('Only one day'));
});
t('day streak', () => {
  const st = C.emptyState(); st.days = ['2026-09-25', '2026-09-26', '2026-09-27'];
  assert.equal(C.dayStreak(st, today), 3); st.days.push(today); assert.equal(C.dayStreak(st, today), 4);
  assert.equal(C.dayStreak(st, '2026-10-01'), 0);
});
t('stars per session', () => {
  const s = new C.Session({ mode: 'today', level: 'steady', settings: C.settingsFor('today', 'steady'), items: P.all });
  P.all.forEach(e => { s.answer(e.word); s.next(); }); assert.equal(s.starsEarned(), 3); assert.equal(s.points, 100);
});
console.log(`\nall ${n} tests passed`);
