# Ace's Spelling Quest 🚀

A static spelling practice app for a grade 5 speller (Canadian spelling). No backend, no login.
Live: https://cyberbeast23.github.io/ace-spelling/

- **Today's Words**: the newest list in `words.json` (lists dated in the future wait until that day).
- **Review**: words from earlier days, weighted toward missed and due words (simple spaced repetition: 1, 2, 4, 7, 14, 30 days).
- **Challenge**: the hardest words for bonus points. When accuracy is high there's a timer and no hints.
- Adapts to recent accuracy (last 20 answers). Under 60% gives shorter sets and offers hints. 85% or more mixes in harder review words and removes hints.
- Progress is stored in `localStorage` on the device and browser in use.

## Adding a day's words

Edit **only `words.json`**: append one object to `lists`:

```json
{ "date": "2026-09-29", "words": [
  { "word": "island", "syllables": "is-land", "definition": "land with water all around it", "sentence": "We took a ferry to the island." }
] }
```

`syllables` is optional; the app guesses if it's missing. Helper: `python3 scripts/add-day.py 2026-09-29 day.json` (it replaces any list with the same date and keeps lists sorted).

Tests: `node tests/core.test.js`
