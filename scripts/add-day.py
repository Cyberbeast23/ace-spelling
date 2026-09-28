#!/usr/bin/env python3
"""Add (or replace) one day's spelling list in words.json.

Usage:
  python3 scripts/add-day.py 2026-09-29 day.json      # day.json = [{"word","definition","sentence"[,"syllables"]}, ...]
  cat day.json | python3 scripts/add-day.py 2026-09-29 -

Keeps lists sorted by date and writes one word per line so diffs stay readable.
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATH = ROOT / "words.json"


def dump(data):
    out = ['{', '  "about": ' + json.dumps(data.get("about", ""), ensure_ascii=False) + ',', '  "lists": [']
    for i, l in enumerate(data["lists"]):
        out.append('    {')
        out.append('      "date": ' + json.dumps(l["date"]) + ',')
        out.append('      "words": [')
        rows = ['        ' + json.dumps(w, ensure_ascii=False) for w in l["words"]]
        out.append(',\n'.join(rows))
        out.append('      ]')
        out.append('    }' + (',' if i < len(data["lists"]) - 1 else ''))
    out += ['  ]', '}']
    return '\n'.join(out) + '\n'


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    date, src = sys.argv[1], sys.argv[2]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        sys.exit("date must be YYYY-MM-DD")
    words = json.load(sys.stdin if src == "-" else open(src, encoding="utf-8"))
    if isinstance(words, dict):
        words = words.get("words", [])
    clean = []
    for w in words:
        if not all(str(w.get(k, "")).strip() for k in ("word", "definition", "sentence")):
            sys.exit(f"each word needs word, definition and sentence: {w}")
        e = {"word": w["word"].strip()}
        if w.get("syllables"):
            e["syllables"] = w["syllables"].strip()
        e["definition"] = w["definition"].strip().rstrip(".")
        e["sentence"] = w["sentence"].strip()
        clean.append(e)
    data = json.loads(PATH.read_text(encoding="utf-8"))
    data["lists"] = [l for l in data["lists"] if l["date"] != date] + [{"date": date, "words": clean}]
    data["lists"].sort(key=lambda l: l["date"])
    PATH.write_text(dump(data), encoding="utf-8")
    print(f"words.json: {date} -> {len(clean)} words ({len(data['lists'])} days total)")


if __name__ == "__main__":
    main()
