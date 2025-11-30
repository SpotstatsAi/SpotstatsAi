#!/usr/bin/env python3
"""
NBA.com → Cloudflare Worker proxy → GitHub Action safe
Builds player_stats.json with:
- Per-game averages (NBA official)
- Team + opponent + defense rank
- Usage, pace, offensive/defensive ratings
"""

import json
import sys
import requests
from datetime import datetime

# -----------------------------------------------------------
# CONFIG
# -----------------------------------------------------------

# CHANGE THIS TO YOUR REAL WORKER URL:
NBA_PROXY = "https://nba-proxy.<YOUR_WORKER>.workers.dev/"

TODAY = datetime.utcnow().strftime("%Y-%m-%d")

SEASON = "2025-26"
SEASON_YEAR = 2025

# -----------------------------------------------------------
# PROXY HELPER
# -----------------------------------------------------------

def fetch_nba(endpoint, params_dict):
    """Fetch JSON from NBA.com through Cloudflare Worker proxy."""
    params = "&".join(f"{k}={v}" for k, v in params_dict.items())

    url = f"{NBA_PROXY}?endpoint={endpoint}&params={params}"

    print("Fetching:", url, file=sys.stderr)

    resp = requests.get(url, timeout=40)
    resp.raise_for_status()

    return resp.json()

# -----------------------------------------------------------
# DATA FETCHERS
# -----------------------------------------------------------

def get_player_base():
    return fetch_nba("leaguedashplayerstats", {
        "Season": SEASON,
        "SeasonType": "Regular Season",
        "MeasureType": "Base",
        "PerMode": "PerGame"
    })

def get_advanced_stats():
    return fetch_nba("leaguedashplayerstats", {
        "Season": SEASON,
        "SeasonType": "Regular Season",
        "MeasureType": "Advanced",
        "PerMode": "PerGame"
    })

def get_schedule_today():
    return fetch_nba("scoreboardv3", {
        "GameDate": TODAY,
        "LeagueID": "00"
    })

def get_team_defense():
    return fetch_nba("leaguedashteamstats", {
        "Season": SEASON,
        "SeasonType": "Regular Season",
        "MeasureType": "Defense",
        "PerMode": "PerGame"
    })

# -----------------------------------------------------------
# MAIN
# -----------------------------------------------------------

def main():
    print("Building player_stats.json using NBA.com data", file=sys.stderr)
    print("Today:", TODAY, file=sys.stderr)

    with open("rosters.json") as f:
        rosters = json.load(f)

    base = get_player_base()
    adv = get_advanced_stats()
    defense = get_team_defense()
    games = get_schedule_today()

    # Parse NBA.com JSON structure
    base_rows = base["resultSets"][0]["rowSet"]
    base_headers = base["resultSets"][0]["headers"]

    adv_rows = adv["resultSets"][0]["rowSet"]
    adv_headers = adv["resultSets"][0]["headers"]

    # Build player lookup
    player_base = {}
    for row in base_rows:
        entry = dict(zip(base_headers, row))
        name = entry["PLAYER_NAME"]
        player_base[name] = entry

    player_advanced = {}
    for row in adv_rows:
        entry = dict(zip(adv_headers, row))
        name = entry["PLAYER_NAME"]
        player_advanced[name] = entry

    # Build today's opponent mapping
    opponent = {}

    if "scoreboard" in games:
        for g in games["scoreboard"]["games"]:
            home = g["homeTeam"]["teamTricode"]
            away = g["awayTeam"]["teamTricode"]
            opponent[home] = away
            opponent[away] = home

    # Build defensive ranks
    def_rows = defense["resultSets"][0]["rowSet"]
    def_headers = defense["resultSets"][0]["headers"]

    def_table = [
        dict(zip(def_headers, r)) for r in def_rows
    ]

    # Sort: lower DRTG = better defense
    def_sorted = sorted(def_table, key=lambda x: x["DEF_RATING"])

    team_def_rank = {
        entry["TEAM_ABBREVIATION"]: idx + 1
        for idx, entry in enumerate(def_sorted)
    }

    # Now construct final output
    final = {}

    for team, players in rosters.items():
        for name in players:

            b = player_base.get(name)
            a = player_advanced.get(name)

            if not b:
                final[name] = {
                    "team": team,
                    "pts": 0,
                    "reb": 0,
                    "ast": 0,
                    "usage": 0,
                    "pace": None,
                    "def_rank": None,
                    "opponent": None,
                }
                continue

            opp = opponent.get(team)

            final[name] = {
                "team": team,
                "pts": b["PTS"],
                "reb": b["REB"],
                "ast": b["AST"],
                "min": b["MIN"],
                "games": b["GP"],
                "usage": a["USG_PCT"] if a else 0,
                "pace": a["PACE"] if a else None,
                "opponent": opp,
                "def_rank": team_def_rank.get(opp),
            }

    with open("player_stats.json", "w") as f:
        json.dump(final, f, indent=2)

    print("DONE — player_stats.json updated", file=sys.stderr)


if __name__ == "__main__":
    main()
