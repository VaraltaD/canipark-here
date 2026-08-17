#!/usr/bin/env python3
"""
Downloads the City of Montreal's street-parking signage dataset.

Source: https://donnees.montreal.ca/dataset/stationnement-sur-rue-signalisation-courant
"""
import pathlib
import sys
import time

import requests

RAW_DIR = pathlib.Path(__file__).parent / "raw"

FILES = {
    "signalisation_stationnement.csv": (
        "https://donnees.montreal.ca/dataset/8ac6dd33-b0d3-4eab-a334-5a6283eb7940/"
        "resource/7f1d4ae9-1a12-46d7-953e-6b9c18c78680/download/"
        "signalisation_stationnement.csv"
    ),
    "signalisation-codification-rpa.csv": (
        "https://donnees.montreal.ca/dataset/8ac6dd33-b0d3-4eab-a334-5a6283eb7940/"
        "resource/1baac760-4311-4b4f-8996-db93d348cc24/download/"
        "signalisation-codification-rpa.csv"
    ),
    "signalisation-codification-rtp.csv": (
        "https://donnees.montreal.ca/dataset/8ac6dd33-b0d3-4eab-a334-5a6283eb7940/"
        "resource/5b381343-121d-478e-8328-7698063d1f57/download/"
        "signalisation-codification-rtp.csv"
    ),
}

HEADERS = {"User-Agent": "canipark-here-data-pipeline/1.0 (+https://github.com/)"}


def download(name: str, url: str, retries: int = 3) -> None:
    dest = RAW_DIR / name
    for attempt in range(1, retries + 1):
        try:
            print(f"Fetching {name} (attempt {attempt}/{retries})...")
            resp = requests.get(url, headers=HEADERS, timeout=120, stream=True)
            resp.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".part")
            with open(tmp, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
            tmp.replace(dest)
            size_mb = dest.stat().st_size / (1024 * 1024)
            print(f"  -> saved {dest} ({size_mb:.1f} MB)")
            return
        except requests.RequestException as exc:
            print(f"  ! {exc}")
            if attempt == retries:
                raise
            time.sleep(2 * attempt)


def main() -> int:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        download(name, url)
    print("Done. Run parse_rtp.py next to build data/processed/signs.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
