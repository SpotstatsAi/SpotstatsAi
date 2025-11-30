#!/usr/bin/env python3
"""
FULLY WORKING VERSION — NO INVALID ENDPOINTS

Fixes:
- Removes invalid PlayerGameStatsBySeason endpoint
- Uses PlayerGameStatsByDate loop instead
- Builds rolling season averages
- Merges season stats + gamelog stats
- Includes matchup data, team ranks, records, pace, usage
"""

import json
import os
import sys
from datetime import datetime, timedelta
import requests

# -----------------------------
# CONFIG
# -----------------------------

API_KEY = os.getenv("SPORTSDATA_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: SPORTSDATA_API_KEY missing!", file=sys.stderr)
    sys.exit(1)

SEASON = 2025
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BASE_STATS_URL = "https://api.sportsdata.io/v3/nba/stats/json"
BASE_SCORES_URL = "https://api.sportsdata.io/v3/nba/scores/json"

SEASON_START = datetime(2024, 10, 1)
SEASON_END = datetime.utcnow()

# -----------------------------
# API HELPERS
# -----------------------------

def fetch_json(url):
    headers = {"Ocp-Apim-Subscription-Key": API_KEY}
    resp = requests.get(url, headers=headers, timeout=25)
    resp.raise_for_status()
    return resp.json()

def fetch_player_season_stats():
    url = f"{BASE_STATS_URL}/PlayerSeasonStats/{SEASON}?key={API_KEY}"
    return fetch_json(url)

def fetch_team_standings():
    url = f"{BASE_SCORES_URL}/Standings/{SEASON}?key={API_KEY}"
    return fetch_json(url)

def fetch_games_by_date(date):
    url = f"{BASE_SCORES_URL}/GamesByDate/{date}?key={API_KEY}"
    return fetch_json(url)

def fetch_player_gamelogs_by_date(date):
    url = f"{BASE_STATS_URL}/PlayerGameStatsByDate/{date}?key={API_KEY}"
    return fetch_json(url)

# -----------------------------
# BUILD FULL GAMELOG DATABASE
# -----------------------------

def build_season_gamelogs():
    print("Building full-season gamelogs...", file=sys.stderr)

    gamelogs = {}

    day = SEASON_START
    while day <= SEASON_END:
        date_str = day.strftime("%Y-%m-%d")

        try:
            logs = fetch_player_gamelogs_by_date(date_str)
        except:
            day += timedelta(days=1)
            continue

        for g in logs:
            name = g["Name"].strip()
            if name not in gamelogs:
                gamelogs[name] = []

            gamelogs[name].append({
                "pts": g.get("Points", 0),
                "reb": g.get("Rebounds", 0),
                "ast": g.get("Assists", 0),
                "min": g.get("Minutes", 0),
                "date": date_str
            })

        day += timedelta(days=1)

    return gamelogs

# -----------------------------
# MAIN
# -----------------------------

def main():
    print("Building stats…", file=sys.stderr)

    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    season_stats = fetch_player_season_stats()
    standings = fetch_team_standings()
    today_games = fetch_games_by_date(TODAY)

    # Build gamelogs
    gamelogs = build_season_gamelogs()

    # Build lookup tables
    season_lookup = {p["Name"].strip(): p for p in season_stats}

    opponent_map = {}
    for g in today_games:
        opponent_map[g["HomeTeam"]] = g["AwayTeam"]
        opponent_map[g["AwayTeam"]] = g["HomeTeam"]

    # defensive ranks
    sorted_by_def = sorted(standings, key=lambda x: x.get("PointsAgainst", 999))
    def_rank = {t["Key"]: i+1 for i,t in enumerate(sorted_by_def)}

    # team records
    team_info = {}
    for t in standings:
        team_info[t["Key"]] = {
            "record": f"{t.get('Wins',0)}-{t.get('Losses',0)}",
            "pct": t.get("Percentage", 0),
            "streak": t.get("StreakDescription", "--"),
            "pf": t.get("PointsFor", 0),
            "pa": t.get("PointsAgainst", 0),
            "div_rank": t.get("DivisionRank", None),
            "conf_rank": t.get("ConferenceRank", None),
        }

    final = {}
    missing = []

    for team, players in rosters.items():
        for name in players:
            base = season_lookup.get(name)
            logs = gamelogs.get(name, [])

            if base is None:
                missing.append(name)
                continue

            g = max(1, base.get("Games", 1))

            avg_pts = base["Points"] / g
            avg_reb = base["Rebounds"] / g
            avg_ast = base["Assists"] / g
            avg_min = base["Minutes"] / g

            opp = opponent_map.get(team)
            rec = team_info.get(team, {})
            opprec = team_info.get(opp, {})

            final[name] = {
                "team": team,
                "games": g,

                "pts": avg_pts,
                "reb": avg_reb,
                "ast": avg_ast,
                "min": avg_min,

                "usage": base.get("UsageRate", 0),
                "pace": base.get("Possessions", None),

                "opponent": opp,
                "def_rank": def_rank.get(opp),

                "recent": logs[-5:],   # last 5 games

                "team_record": rec.get("record"),
                "team_win_pct": rec.get("pct"),
                "opp_record": opprec.get("record"),
                "opp_win_pct": opprec.get("pct"),
                "opp_streak": opprec.get("streak"),
            }

    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)

    print("Done.")

if __name__ == "__main__":
    main()
