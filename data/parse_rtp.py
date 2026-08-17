#!/usr/bin/env python3
"""
Turns the raw city CSV into data/processed/signs.json: one entry per sign,
with its location and a normalized list of time/day rules.

Real-world format (confirmed against actual city data, 2026-08-17):
  DESCRIPTION_RPA holds BOTH the restriction symbol and the schedule text,
  e.g. "\\P EN TOUT TEMPS", "\\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC",
  "\\A EN TOUT TEMPS", "\\P 9h30-18h EXCEPTE S3R".
    \\P = no parking (the "P with a slash through it" sign)
    \\A = no stopping (same idea, stricter -- "arret interdit")
  DESCRIPTION_RTP is NOT a schedule -- it's the physical pole's material
  ("1- Tige (Gazon, asphalte)", "4- Poteau en bois"). Kept only as
  metadata, never parsed for rules.

This is still a heuristic text parser, not an official decoder -- the city
doesn't publish a machine-readable grammar. Anything it can't confidently
classify gets "confidence": "low", and the API answers "not sure" for
those rather than guessing.

Known gap: the "EXCEPTE S3R" style exceptions aren't fully understood yet
(S3R doesn't match a day name, so it's silently dropped rather than
misapplied). If you can find out what S3R/similar codes mean, tightening
parse_exceptions() is the place to do it.
"""
import argparse
import csv
import json
import pathlib
import re
import sys

RAW_DIR = pathlib.Path(__file__).parent / "raw"
OUT_DIR = pathlib.Path(__file__).parent / "processed"

SIGNS_CSV = RAW_DIR / "signalisation_stationnement.csv"
OUT_JSON = OUT_DIR / "signs.json"

DAY_MAP = {
    "LUNDI": "mon", "LUN": "mon",
    "MARDI": "tue", "MAR": "tue",
    "MERCREDI": "wed", "MER": "wed",
    "JEUDI": "thu", "JEU": "thu",
    "VENDREDI": "fri", "VEN": "fri",
    "SAMEDI": "sat", "SAM": "sat",
    "DIMANCHE": "sun", "DIM": "sun",
}
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

MONTH_MAP = {
    "JANVIER": 1, "FEVRIER": 2, "FÉVRIER": 2, "MARS": 3, "AVRIL": 4,
    "MAI": 5, "JUIN": 6, "JUILLET": 7, "AOUT": 8, "AOÛT": 8,
    "SEPTEMBRE": 9, "OCTOBRE": 10, "NOVEMBRE": 11,
    "DECEMBRE": 12, "DÉCEMBRE": 12, "DEC": 12,
}

# Fallback keyword classification, for any spelled-out phrasing that
# doesn't use the \P / \A symbol shorthand. Matched only if no symbol found.
RESTRICTION_KEYWORDS = [
    ("no_stopping", [r"ARR[ÊE]T\s*INTERDIT", r"D[ÉE]FENSE\s*D.?ARR[ÊE]TER"]),
    ("permit_required", [r"VIGNETTE", r"SRRR", r"R[ÉE]SERV[ÉE]", r"PERMIS\s*REQUIS"]),
    ("no_parking", [
        r"STATIONNEMENT\s*INTERDIT", r"INTERDICTION\s*DE\s*STATIONNER",
        r"D[ÉE]FENSE\s*DE\s*STATIONNER",
    ]),
]

TIME_RE = re.compile(r"(\d{1,2})\s*H\s*(\d{2})?")
DAY_TOKEN_RE = re.compile(
    r"\b(" + "|".join(sorted(DAY_MAP.keys(), key=len, reverse=True)) + r")\b"
)
DAY_RANGE_RE = re.compile(
    r"\b(" + "|".join(DAY_MAP.keys()) + r")\s*(?:A|AU|-|À)\s*(" + "|".join(DAY_MAP.keys()) + r")\b"
)
SEASON_RE = re.compile(
    r"(\d{1,2})\s*(?:ER)?\s+(" + "|".join(MONTH_MAP.keys()) + r")\s*(?:AU|A|-|À)\s*"
    r"(\d{1,2})\s*(?:ER)?\s+(" + "|".join(MONTH_MAP.keys()) + r")"
)


def classify_restriction(text: str) -> str:
    t = (text or "").upper()
    if re.search(r"\\A\b", t):
        return "no_stopping"
    if re.search(r"\\P\b", t):
        return "no_parking"
    for label, patterns in RESTRICTION_KEYWORDS:
        for pat in patterns:
            if re.search(pat, t):
                return label
    return "unknown"


def expand_day_range(start: str, end: str) -> list:
    s, e = DAY_ORDER.index(start), DAY_ORDER.index(end)
    if s <= e:
        return DAY_ORDER[s:e + 1]
    return DAY_ORDER[s:] + DAY_ORDER[:e + 1]  # wraps around the week


def parse_days(text: str) -> list:
    text_u = text.upper()
    if "TOUS LES JOURS" in text_u or "TLJ" in text_u or "TOUT TEMPS" in text_u:
        return DAY_ORDER.copy()

    days = set()
    for m in DAY_RANGE_RE.finditer(text_u):
        start, end = DAY_MAP[m.group(1)], DAY_MAP[m.group(2)]
        days.update(expand_day_range(start, end))

    stripped = DAY_RANGE_RE.sub(" ", text_u)
    for m in DAY_TOKEN_RE.finditer(stripped):
        days.add(DAY_MAP[m.group(1)])

    return sorted(days, key=DAY_ORDER.index) if days else []


def parse_time_windows(text: str) -> list:
    """{"start": "HH:MM", "end": "HH:MM"} windows. Handles "8h30-11h30",
    "8H A 9H30", multiple windows joined by ET, and "EN TOUT TEMPS" (24h)."""
    text_u = text.upper()
    windows = []
    for clause in re.split(r"\bET\b", text_u):
        times = TIME_RE.findall(clause)
        if len(times) >= 2:
            (h1, m1), (h2, m2) = times[0], times[1]
            windows.append({
                "start": f"{int(h1):02d}:{int(m1 or 0):02d}",
                "end": f"{int(h2):02d}:{int(m2 or 0):02d}",
            })
    if not windows and "TOUT TEMPS" in text_u:
        windows.append({"start": "00:00", "end": "00:00"})  # 24h
    return windows


def parse_exceptions(text: str) -> list:
    """'SAUF DIM' / 'EXCEPTE DIM' -> list of day codes to exclude.
    Codes that aren't recognized day names (e.g. "EXCEPTE S3R") are
    silently dropped rather than guessed at -- see module docstring."""
    text_u = text.upper()
    m = re.search(r"(?:SAUF|EXCEPTE)\s+([A-ZÀ-Ü,\s]+?)(?:\d|$)", text_u)
    if not m:
        return []
    return parse_days(m.group(1))


def parse_season(text: str):
    """'1 AVRIL AU 1 DEC' -> {startMonth, startDay, endMonth, endDay}, or
    None if the text doesn't mention a date range."""
    m = SEASON_RE.search(text.upper())
    if not m:
        return None
    d1, mo1, d2, mo2 = m.groups()
    return {
        "startMonth": MONTH_MAP[mo1], "startDay": int(d1),
        "endMonth": MONTH_MAP[mo2], "endDay": int(d2),
    }


def parse_time_rule(rpa_text: str) -> dict:
    text = rpa_text or ""
    restriction = classify_restriction(text)
    days = parse_days(text)
    windows = parse_time_windows(text)
    exceptions = parse_exceptions(text)
    season = parse_season(text)

    confidence = "high"
    if restriction == "unknown":
        confidence = "low"
    if not days and not windows and text.strip():
        confidence = "low"

    return {
        "restriction": restriction,
        "days": days,
        "windows": windows,
        "exceptions": exceptions,
        "season": season,
        "raw_rpa": text.strip(),
        "confidence": confidence,
    }


def load_rows(sample: int = 0):
    if not SIGNS_CSV.exists():
        sys.exit(f"Missing {SIGNS_CSV}. Run fetch.py first.")
    with open(SIGNS_CSV, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if sample and i >= sample:
                break
            yield row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0,
                     help="print the first N raw rows and exit, for calibrating the regexes")
    ap.add_argument("--limit", type=int, default=0,
                     help="only process the first N rows (for quick local testing)")
    args = ap.parse_args()

    if args.sample:
        for row in load_rows(sample=args.sample):
            print(json.dumps(row, ensure_ascii=False, indent=2))
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    signs = []
    low_confidence = 0

    for i, row in enumerate(load_rows()):
        if args.limit and i >= args.limit:
            break
        try:
            lat = float(row.get("Latitude") or row.get("LATITUDE") or "")
            lng = float(row.get("Longitude") or row.get("LONGITUDE") or "")
        except (TypeError, ValueError):
            continue  # unusable without a location

        rpa = row.get("DESCRIPTION_RPA", "")
        rule = parse_time_rule(rpa)
        if rule["confidence"] == "low":
            low_confidence += 1

        signs.append({
            "id": row.get("PANNEAU_ID_PAN") or row.get("POTEAU_ID_POT"),
            "pole_id": row.get("POTEAU_ID_POT"),
            "lat": lat,
            "lng": lng,
            "borough": row.get("NOM_ARROND"),
            "arrow": row.get("FLECHE_PAN"),
            "pole_material": row.get("DESCRIPTION_RTP"),
            "rule": rule,
        })

    OUT_JSON.write_text(json.dumps(signs, ensure_ascii=False), encoding="utf-8")
    total = len(signs)
    pct = (low_confidence / total * 100) if total else 0
    print(f"Wrote {total} signs to {OUT_JSON}")
    print(f"  {low_confidence} ({pct:.1f}%) flagged low-confidence -> API will answer 'not sure' for these")


if __name__ == "__main__":
    sys.exit(main())
