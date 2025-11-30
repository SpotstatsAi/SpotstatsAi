#!/usr/bin/env python3
"""
NBA.com → Cloudflare Worker proxy → GitHub Action safe

Builds player_stats.json with:
- Per-game averages (NBA official)
- Usage, Pace, Advanced analytics
- Opponent matchups for TODAY
- Opponent defensive rank
- Fully compatible with your current UI
"""

import json
import sys
import requests
from datetime import datetime

# -----------------------------------------------------------
# CONFIG
# -----------------------------------------------------------

# Your actual Cloudflare Worker:
NBA_PROXY = "https://nba-proxy.dblair1027.workers.dev/"

TODAY = datetime.utcnow().strftime("%Y-%m-%d")

SEASON = "2025-26"     # NBA.com format
SEASON_YEAR = 2025     # Used only in some endpoints


# -----------------------------------------------------------
# PROXY FETCH WRAPPER
# -----------------------------------------------------------

def fetch_nba(endpoint, params_dict):
    """
    Fetch JSON from NBA.com THROUGH your Cloudflare Worker
    → 100% bypasses NBA blocking
    """
    params = "&".join(f"{k}={v}" for k, v in params_dict.items())
    url = f"{NBA_PROXY}?endpoint={endpoint}&params={params}"

    print("Fetching:", url, file=sys.stderr)

    resp = requests.get(url, timeout=40)
    resp.raise_for_status()
    return resp.json()


# -----------------------------------------------------------
# ENDPOINTS
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

def get_team_defense():
    return fetch_nba("leaguedashteamstats", {
        "Season": SEASON,
        "SeasonType": "Regular Season",
        "MeasureType": "Defense",
        "PerMode": "PerGame"
    })

def get_schedule_today():
    return fetch_nba("scoreboardv3", {
        "GameDate": TODAY,
        "LeagueID": "00"
    })


# -----------------------------------------------------------
# MAIN
# -----------------------------------------------------------

def main():
    print("Building player_stats.json via NBA.com Cloudflare Proxy", file=sys.stderr)
    print("Today:", TODAY, file=sys.stderr)

    # Load your rosters.json to determine which players we care about
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    # Pull data
    base = get_player_base()
    adv  = get_advanced_stats()
    defense = get_team_defense()
    games = get_schedule_today()

    # ----- Parse base stats -----
    base_headers = base["resultSets"][0]["headers"]
    base_rows = base["resultSets"][0]["rowSet"]

    player_base = {}
    for row in base_rows:
        entry = dict(zip(base_headers, row))
        name = entry["PLAYER_NAME"]
        player_base[name] = entry

    # ----- Parse advanced stats -----
    adv_headers = adv["resultSets"][0]["headers"]
    adv_rows = adv["resultSets"][0]["rowSet"]

    player_adv = {}
    for row in adv_rows:
        entry = dict(zip(adv_headers, row))
        name = entry["PLAYER_NAME"]
        player_adv[name] = entry

    # ----- Opponent Mapping (Today) -----
    opponent = {}
    if "scoreboard" in games and "games" in games["scoreboard"]:
        for g in games["scoreboard"]["games"]:
            home = g["homeTeam"]["teamTricode"]
            away = g["awayTeam"]["teamTricode"]
            opponent[home] = away
            opponent[away] = home

    # ----- Defensive ranking -----
    def_headers = defense["resultSets"][0]["headers"]
    def_rows = defense["resultSets"][0]["rowSet"]

    def_table = [dict(zip(def_headers, r)) for r in def_rows]

    # Sort by DEF_RATING ascending = better defense
    def_sorted = sorted(def_table, key=lambda x: x["DEF_RATING"])

    team_def_rank = {
        entry["TEAM_ABBREVIATION"]: idx + 1
        for idx, entry in enumerate(def_sorted)
    }

    # -----------------------------------------------------------
    # Build final output
    # -----------------------------------------------------------

    final = {}
    missing = []

    for team, players in rosters.items():
        for name in players:

            b = player_base.get(name)
            a = player_adv.get(name)

            if not b:
                missing.append(name)
                final[name] = {
                    "team": team,
                    "pts": 0,
                    "reb": 0,
                    "ast": 0,
                    "min": 0,
                    "games": 0,
                    "usage": 0,
                    "pace": None,
                    "opponent": None,
                    "def_rank": None
                }
                continue

            opp = opponent.get(team)

            final[name] = {
                "team": team,
                "games": b["GP"],
                "min": b["MIN"],
                "pts": b["PTS"],
                "reb": b["REB"],
                "ast": b["AST"],
                "stl": b["STL"],
                "blk": b["BLK"],
                "tov": b["TOV"],

                # Advanced
                "usage": a["USG_PCT"] if a else 0,
                "pace": a["PACE"] if a else None,

                # Matchup info
                "opponent": opp,
                "def_rank": team_def_rank.get(opp)
            }

    # Save JSON
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)

    print("DONE — player_stats.json updated!", file=sys.stderr)

    if missing:
        print("\nPlayers not found:", file=sys.stderr)
        for name in missing:
            print(" -", name)


if __name__ == "__main__":
    main()
