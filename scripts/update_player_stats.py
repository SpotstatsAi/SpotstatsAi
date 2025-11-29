#!/usr/bin/env python3
"""
Pulls current-season stats from Basketball Reference (via your Cloudflare Worker)
and writes player_stats.json in the format app.js expects.

- Top-level object keyed by full player name (exactly as in rosters.json)
- Each value is a stats object with fields like:
  pts, reb, ast, stl, blk, tov, min, fg3a, fg3_pct, fga, fg_pct,
  fta, ft_pct, games, usage, team, season, pace, foul_difficulty, blowout_risk
"""

import csv
import json
import sys
from io import StringIO
from typing import Dict, List, Tuple

import requests

# ===== CONFIG =====

# Season end year. Your 2025–26 season is "2026" on Basketball Reference.
YEAR = 2026

# Raw Basketball Reference CSV endpoints (on basketball-reference.com)
BREF_PER_GAME_CSV = (
    f"https://widgets.sports-reference.com/w2.csv"
    f"?site=bbr&url=/leagues/NBA_{YEAR}_per_game.html"
)
BREF_ADV_CSV = (
    f"https://widgets.sports-reference.com/w2.csv"
    f"?site=bbr&url=/leagues/NBA_{YEAR}_advanced.html"
)

# Your Cloudflare Worker proxy base URL
PROXY_BASE = "https://bbr-proxy.dblair1027.workers.dev/"

# Map your team codes -> Basketball Reference team codes
TEAM_ALIASES: Dict[str, str] = {
    "BKN": "BRK",
    "CHA": "CHO",
    "PHX": "PHO",
    # UTA is already "UTA" on BR
    # Add more here if you ever need them
}


def to_bref_team(team_code: str) -> str:
    """Convert your team code to Basketball Reference's code if needed."""
    return TEAM_ALIASES.get(team_code, team_code)


def fetch_csv_via_proxy(source_url: str) -> List[Dict[str, str]]:
    """
    Hit your Cloudflare Worker, which then fetches Basketball Reference.

    We pass the real BR URL as a `url` query param to the Worker.
    """
    print(f"Fetching CSV via proxy: {source_url}", file=sys.stderr)

    headers = {
        "User-Agent": "Mozilla/5.0 (SpotstatsAi stats updater)",
        "Accept-Language": "en-US,en;q=0.9",
    }

    # requests will URL-encode the `url` param for us
    resp = requests.get(
        PROXY_BASE,
        params={"url": source_url},
        headers=headers,
        timeout=60,
    )
    resp.raise_for_status()

    return list(csv.DictReader(StringIO(resp.text)))


def parse_per_game() -> Tuple[Dict[Tuple[str, str], Dict], Dict[str, Dict]]:
    """
    Parse per-game CSV.

    Returns:
      - per_by_name_team: (name, team_code) -> stats dict
      - tot_by_name: name -> stats dict for 'TOT' rows
    """
    rows = fetch_csv_via_proxy(BREF_PER_GAME_CSV)

    per_by_name_team: Dict[Tuple[str, str], Dict] = {}
    tot_by_name: Dict[str, Dict] = {}

    for row in rows:
        name = (row.get("Player") or "").strip()
        team = (row.get("Tm") or "").strip()

        if not name or not team:
            continue

        def f(key: str) -> float:
            val = (row.get(key) or "").strip()
            if val in ("", "NA"):
                return 0.0
            try:
                return float(val)
            except ValueError:
                return 0.0

        def i(key: str) -> int:
            val = (row.get(key) or "").strip()
            if not val:
                return 0
            try:
                return int(val)
            except ValueError:
                return 0

        record = {
            "games": i("G"),
            "min": f("MP"),
            "pts": f("PTS"),
            "reb": f("TRB"),
            "ast": f("AST"),
            "stl": f("STL"),
            "blk": f("BLK"),
            "tov": f("TOV"),
            "fg3a": f("3PA"),
            "fg3_pct": f("3P%"),
            "fga": f("FGA"),
            "fg_pct": f("FG%"),
            "fta": f("FTA"),
            "ft_pct": f("FT%"),
        }

        if team == "TOT":
            tot_by_name[name] = record
        else:
            per_by_name_team[(name, team)] = record

    return per_by_name_team, tot_by_name


def parse_advanced_usage() -> Dict[str, float]:
    """
    Parse advanced CSV and pull usage rate (USG%).

    Returns: name -> usage%
    """
    rows = fetch_csv_via_proxy(BREF_ADV_CSV)
    usage_by_name: Dict[str, float] = {}

    for row in rows:
        name = (row.get("Player") or "").strip()
        team = (row.get("Tm") or "").strip()
        if not name or not team:
            continue

        usg_str = (row.get("USG%") or "").strip()
        if not usg_str or usg_str == "NA":
            continue

        try:
            usg_val = float(usg_str)
        except ValueError:
            continue

        # Prefer 'TOT' when available
        if team == "TOT":
            usage_by_name[name] = usg_val
        else:
            usage_by_name.setdefault(name, usg_val)

    return usage_by_name


def main() -> None:
    # 1) Load rosters.json so we only keep players you care about
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    # 2) Fetch and parse stats from Basketball Reference (via Worker)
    per_by_name_team, tot_by_name = parse_per_game()
    usage_by_name = parse_advanced_usage()

    result: Dict[str, Dict] = {}
    missing: List[Tuple[str, str]] = []

    # 3) Build the JSON keyed by player name
    for team_code, players in rosters.items():
        bref_team = to_bref_team(team_code)

        for name in players:
            # Try to match the (name, team) row first
            stats = per_by_name_team.get((name, bref_team))

            # If no team-specific row, fall back to 'TOT'
            if stats is None:
                stats = tot_by_name.get(name)

            # If still missing, create a neutral entry so app.js doesn't break
            if stats is None:
                missing.append((name, team_code))
                stats = {
                    "games": 0,
                    "min": 0.0,
                    "pts": 0.0,
                    "reb": 0.0,
                    "ast": 0.0,
                    "stl": 0.0,
                    "blk": 0.0,
                    "tov": 0.0,
                    "fg3a": 0.0,
                    "fg3_pct": 0.0,
                    "fga": 0.0,
                    "fg_pct": 0.0,
                    "fta": 0.0,
                    "ft_pct": 0.0,
                }

            out = dict(stats)
            out.update(
                {
                    "team": team_code,
                    "season": YEAR,
                    "usage": usage_by_name.get(name, 0.0),
                    # Neutral placeholders you can refine later
                    "pace": None,
                    "foul_difficulty": None,
                    "blowout_risk": None,
                }
            )

            # Final key in player_stats.json is the full name string (must match rosters.json)
            result[name] = out

    # 4) Write player_stats.json
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, sort_keys=True)

    # 5) Log any players we couldn’t find (for debugging)
    if missing:
        print("Players not found on Basketball Reference:", file=sys.stderr)
        for name, team_code in sorted(missing):
            print(f" - {name} ({team_code})", file=sys.stderr)


if __name__ == "__main__":
    main()
