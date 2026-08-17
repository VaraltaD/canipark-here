#!/usr/bin/env python3
"""
Turns the raw city CSVs into data/processed/signs.json: one entry per sign,
with its location and a normalized list of time/day rules, instead of the
free-text RPA/RTP codes.

IMPORTANT: this is a heuristic text parser, not an official decoder. The
city does not publish a machine-readable grammar for DESCRIPTION_RTP, so
this script pattern-matches the common French phrasings. Run it with
--sample first to see real rows from your download and tighten the regexes
in `parse_time_rule()` against what you actually see, before trusting the
output.

Anything the parser can't confidently classify gets "confidence": "low",
and the API is expected to answer "not sure" rather than guess.
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
    "LUN": "mon", "LUNDI": "mon",
    "MAR": "tue", "MARDI": "tue",
    "MER": "wed", "MERCREDI": "wed",
    "JEU": "thu", "JEUDI": "thu",
    "VEN": "fri", "VENDREDI": "fri",
    "SAM": "sat", "SAMEDI": "sat",
    "DIM": "sun", "DIMANCHE": "sun",
}
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# Keyword buckets used to classify what a sign means from its RPA text.
# These are matched in order; first match wins. Tune against real data.
RESTRICTION_KEYWORDS = [
    ("no_stopping", [r"ARR[ÊE]T\s*INTERDIT", r"DEFENSE\s*D.?ARR[ÊE]TER", r"NO\s*STOPPING"]),
    ("permit_required", [r"VIGNETTE", r"SRRR", r"R[ÉE]SERV[ÉE]", r"PERMIS\s*REQUIS"]),
    ("time_limited", [r"MAX(?:IMUM)?\s*\d+\s*(H|MIN)", r"LIMIT[ÉE]"]),
    ("no_parking", [
        r"STATIONNEMENT\s*INTERDIT", r"INTERDICTION\s*DE\s*STATIONNER",
        r"D[ÉE]FENSE\s*DE\s*STATIONNER", r"NO\s*PARKING",
    ]),
    ("permitted", [r"STATIONNEMENT\s*PERMIS", r"PARKING\s*PERMITTED"]),
]

TIME_RE = re.compile(r"(\d{1,2})\s*H\s*(\d{2})?")
DAY_TOKEN_RE = re.compile(
    r"\b(" + "|".join(sorted(DAY_MAP.keys(), key=len, reverse=True)) + r")\b"
)
DAY_RANGE_RE = re.compile(
    r"\b(" + "|".join(DAY_MAP.keys()) + r")\s*(?:A|AU|-|À)\s*(" + "|".join(DAY_MAP.keys()) + r")\b"
)


def classify_restriction(rpa_description: str) -> str:
    text = (rpa_description or "").upper()
    for label, patterns in RESTRICTION_KEYWORDS:
        for pat in patterns:
            if re.search(pat, text):
                return label
    return "unknown"


def expand_day_range(start: str, end: str) -> list:
    s, e = DAY_ORDER.index(start), DAY_ORDER.index(end)
    if s <= e:
        return DAY_ORDER[s:e + 1]
    # wraps around the week, e.g. "VEN A LUN"
    return DAY_ORDER[s:] + DAY_ORDER[:e + 1]


def parse_days(text: str) -> list:
    text_u = text.upper()
    if "TOUS LES JOURS" in text_u or "TLJ" in text_u:
        return DAY_ORDER.copy()

    days = set()
    for m in DAY_RANGE_RE.finditer(text_u):
        start, end = DAY_MAP[m.group(1)], DAY_MAP[m.group(2)]
        days.update(expand_day_range(start, end))

    # remove the day tokens already consumed by a range match, then pick up
    # any remaining standalone day tokens (e.g. "SAM ET DIM")
    stripped = DAY_RANGE_RE.sub(" ", text_u)
    for m in DAY_TOKEN_RE.finditer(stripped):
        days.add(DAY_MAP[m.group(1)])

    return sorted(days, key=DAY_ORDER.index) if days else []


def parse_time_windows(text: str) -> list:
    """Returns a list of {"start": "HH:MM", "end": "HH:MM"} windows.
    Handles "8H A 9H30", "8H-9H30", multiple windows joined by ET."""
    windows = []
    for clause in re.split(r"\bET\b", text.upper()):
        times = TIME_RE.findall(clause)
        if len(times) >= 2:
            (h1, m1), (h2, m2) = times[0], times[1]
            windows.append({
                "start": f"{int(h1):02d}:{int(m1 or 0):02d}",
                "end": f"{int(h2):02d}:{int(m2 or 0):02d}",
            })
    return windows


def parse_exceptions(text: str) -> list:
    """'SAUF DIM' style exceptions -> list of day codes to exclude."""
    text_u = text.upper()
    m = re.search(r"SAUF\s+([A-ZÀ-Ü,\s]+?)(?:\d|$)", text_u)
    if not m:
        return []
    return parse_days(m.group(1))


def parse_time_rule(rtp_description: str, rpa_description: str) -> dict:
    text = rtp_description or ""
    restriction = classify_restriction(rpa_description)
    days = parse_days(text)
    windows = parse_time_windows(text)
    exceptions = parse_exceptions(text)

    confidence = "high"
    if restriction == "unknown":
        confidence = "low"
    if not days and not windows and text.strip():
        # There's descriptive text but we extracted nothing structured from it.
        confidence = "low"

    return {
        "restriction": restriction,
        "days": days,
        "windows": windows,
        "exceptions": exceptions,
        "raw_rtp": text.strip(),
        "raw_rpa": (rpa_description or "").strip(),
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

        rtp = row.get("DESCRIPTION_RTP", "")
        rpa = row.get("DESCRIPTION_RPA", "")
        rule = parse_time_rule(rtp, rpa)
        if rule["confidence"] == "low":
            low_confidence += 1

        signs.append({
            "id": row.get("PANNEAU_ID_PAN") or row.get("POTEAU_ID_POT"),
            "pole_id": row.get("POTEAU_ID_POT"),
            "lat": lat,
            "lng": lng,
            "borough": row.get("NOM_ARROND"),
            "arrow": row.get("FLECHE_PAN"),
            "category": row.get("DESCRIPTION_CAT"),
            "rule": rule,
        })

    OUT_JSON.write_text(json.dumps(signs, ensure_ascii=False), encoding="utf-8")
    total = len(signs)
    pct = (low_confidence / total * 100) if total else 0
    print(f"Wrote {total} signs to {OUT_JSON}")
    print(f"  {low_confidence} ({pct:.1f}%) flagged low-confidence -> API will answer 'not sure' for these")


if __name__ == "__main__":
    sys.exit(main())
