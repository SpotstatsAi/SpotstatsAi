#!/usr/bin/env python3
"""
FULL NBA Player Stats Builder for SpotStatsAI
------------------------------------------------------
Includes:
- Season averages
- Opponent + defense rank
- Usage, pace
- Team record, opponent record
- Last 5 game trends (PTS / REB / AST)
- Stable 60-day PlayerGameStatsByDate scraper (no 404)
"""

import json
import os
import sys
from datetime import datetime, timedelta
import requests

# ----------------------------------------------------------
# CONFIG
# ----------------------------------------------------------
API_KEY = os.getenv("SPORTSDATA_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: Missing SPORTSDATA_API_KEY", file=sys.stderr)
    sys.exit(1)

SEASON = 2025   # SportsData season for 2025–26
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BASE_STATS = "https://api.sportsdata.io/v3/nba/stats/json"
BASE_SCORES = "https://api.sportsdata.io/v3/nba/scores/json"

# ----------------------------------------------------------
# HELPERS
# ----------------------------------------------------------

def fetch_json(url):
    headers = {"Ocp-Apim-Subscription-Key": API_KEY}
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    return resp.json()


def fetch_season_stats():
    url = f"{BASE_STATS}/PlayerSeasonStats/{SEASON}?key={API_KEY}"
    return fetch_json(url)


def fetch_todays_games():
    url = f"{BASE_SCORES}/GamesByDate/{TODAY}?key={API_KEY}"
    return fetch_json(url)


def fetch_standings():
    url = f"{BASE_SCORES}/Standings/{SEASON}?key={API_KEY}"
    return fetch_json(url)


def fetch_last_60_days_logs():
    """
    SportsData does NOT have PlayerGameStatsBySeason.
    We must collect player game logs day-by-day.

    This fetches the last 60 days (covers all recent form).
    """
    logs = []
    today = datetime.utcnow().date()
    for i in range(60):
        day = today - timedelta(days=i)
        date_str = day.strftime("%Y-%m-%d")

        try:
            url = f"{BASE_STATS}/PlayerGameStatsByDate/{date_str}?key={API_KEY}"
            day_logs = fetch_json(url)
            logs.extend(day_logs)
        except:
            continue

    return logs


# ----------------------------------------------------------
# MAIN
# ----------------------------------------------------------

def main():
    print(f"Building stats for {TODAY} (Season {SEASON})", file=sys.stderr)

    # ------------------------------------------------------
    # LOAD ROSTERS
    # ------------------------------------------------------
    try:
        with open("rosters.json", "r", encoding="utf-8") as f:
            rosters = json.load(f)
    except FileNotFoundError:
        print("ERROR: rosters.json missing!", file=sys.stderr)
        sys.exit(1)

    # ------------------------------------------------------
    # FETCH ALL DATA
    # ------------------------------------------------------
    print("Fetching season stats...", file=sys.stderr)
    season_stats = fetch_season_stats()

    print("Fetching last 60 days of game logs...", file=sys.stderr)
    game_logs = fetch_last_60_days_logs()

    print("Fetching today's games...", file=sys.stderr)
    todays_games = fetch_todays_games()

    print("Fetching standings (team context + defense)...", file=sys.stderr)
    standings = fetch_standings()

    # ------------------------------------------------------
    # PREP LOOKUPS
    # ------------------------------------------------------
    # Map player → season totals
    season_lookup = {p["Name"]: p for p in season_stats}

    # Team defensive rank (lower PointsAgainst = better)
    sorted_def = sorted(standings, key=lambda x: x.get("PointsAgainst", 999))
    defense_rank = {t["Key"]: i + 1 for i, t in enumerate(sorted_def)}

    # Team record lookup
    team_info = {}
    for t in standings:
        team_info[t["Key"]] = {
            "record": f"{t.get('Wins', 0)}-{t.get('Losses', 0)}",
            "win_pct": t.get("Percentage"),
            "points_for": t.get("PointsFor"),
            "points_against": t.get("PointsAgainst"),
            "streak": t.get("StreakDescription"),
            "conference_rank": t.get("ConferenceRank"),
            "division_rank": t.get("DivisionRank")
        }

    # Opponent map for today's games
    opponents = {}
    for g in todays_games:
        home = g["HomeTeam"]
        away = g["AwayTeam"]
        opponents[home] = away
        opponents[away] = home

    # ------------------------------------------------------
    # BUILD LAST 5 GAME TRENDS
    # ------------------------------------------------------
    trend_map = {}

    for log in game_logs:
        name = log.get("Name")
        if not name:
            continue

        trend_map.setdefault(name, [])
        trend_map[name].append({
            "pts": log.get("Points", 0),
            "reb": log.get("Rebounds", 0),
            "ast": log.get("Assists", 0)
        })

    # Reduce each to last 5 games
    for name, games in trend_map.items():
        trend_map[name] = games[:5]

    # ------------------------------------------------------
    # BUILD FINAL JSON
    # ------------------------------------------------------
    final = {}
    missing_players = []

    for team_code, players in rosters.items():
        for name in players:
            season = season_lookup.get(name)

            if not season:
                missing_players.append(name)
                # still output placeholder so UI doesn't break
                final[name] = {
                    "team": team_code,
                    "games": 0,
                    "pts": 0,
                    "reb": 0,
                    "ast": 0,
                    "usage": 0,
                    "pace": None,
                    "opponent": None,
                    "def_rank": None,
                    "team_record": None,
                    "opp_record": None,
                    "trend_pts": [],
                    "trend_reb": [],
                    "trend_ast": [],
                }
                continue

            games = season.get("Games", 0) or 1
            opp = opponents.get(team_code)
            opp_info = team_info.get(opp, {}) if opp else {}

            # Last 5
            tlist = trend_map.get(name, [])
            trend_pts = [g["pts"] for g in tlist]
            trend_reb = [g["reb"] for g in tlist]
            trend_ast = [g["ast"] for g in tlist]

            final[name] = {
                "team": team_code,
                "games": games,

                # PER GAME AVERAGES
                "pts": season.get("Points", 0) / games,
                "reb": season.get("Rebounds", 0) / games,
                "ast": season.get("Assists", 0) / games,
                "min": season.get("Minutes", 0) / games,

                # ADVANCED
                "usage": season.get("UsageRate", 0),
                "pace": season.get("Possessions", None),

                # MATCHUP
                "opponent": opp,
                "def_rank": defense_rank.get(opp),

                # TEAM CONTEXT
                "team_record": team_info.get(team_code, {}).get("record"),
                "opp_record": opp_info.get("record"),
                "opp_streak": opp_info.get("streak"),
                "opp_points_for": opp_info.get("points_for"),
                "opp_points_against": opp_info.get("points_against"),
                "opp_conf_rank": opp_info.get("conference_rank"),
                "opp_div_rank": opp_info.get("division_rank"),

                # LAST 5 GAME TRENDS
                "trend_pts": trend_pts,
                "trend_reb": trend_reb,
                "trend_ast": trend_ast,
            }

    # ------------------------------------------------------
    # WRITE OUTPUT
    # ------------------------------------------------------
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)

    print("\nDONE: player_stats.json written.", file=sys.stderr)

    if missing_players:
        print("\nPlayers not found in SportsData:", file=sys.stderr)
        for p in missing_players:
            print(" -", p, file=sys.stderr)


if __name__ == "__main__":
    main()

