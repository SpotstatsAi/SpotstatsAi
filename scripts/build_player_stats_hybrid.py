#!/usr/bin/env python3
"""
FREE-TIER FULLY COMPATIBLE STATS ENGINE
----------------------------------------------------
Generates player_stats.json using ONLY endpoints
included in SportsData.io's FREE plan.

Includes:
- Season averages (computed manually from totals)
- Today’s opponent
- Team defense rank
- Team records, streaks, points for/against
- Today's player logs (if any)
- Yesterday logs fallback
"""

import json
import os
import sys
from datetime import datetime, timedelta
import requests

# --------------------------------------------------
# CONFIG
# --------------------------------------------------

API_KEY = os.getenv("SPORTSDATA_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: SPORTSDATA_API_KEY not set!", file=sys.stderr)
    sys.exit(1)

YEAR = 2025  # For 2025–26 season
TODAY = datetime.utcnow().strftime("%Y-%m-%d")
YESTERDAY = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

SCORES = "https://api.sportsdata.io/v3/nba/scores/json"
STATS = "https://api.sportsdata.io/v3/nba/stats/json"

HEADERS = {"Ocp-Apim-Subscription-Key": API_KEY}


# --------------------------------------------------
# API HELPERS
# --------------------------------------------------

def fetch_json(url):
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.json()


def get_standings():
    url = f"{SCORES}/Standings/{YEAR}?key={API_KEY}"
    return fetch_json(url)


def get_todays_games():
    url = f"{SCORES}/GamesByDate/{TODAY}?key={API_KEY}"
    return fetch_json(url)


def get_team_season_stats(team):
    url = f"{STATS}/PlayerSeasonStatsByTeam/{YEAR}/{team}?key={API_KEY}"
    return fetch_json(url)


def get_player_logs_for_date(date):
    url = f"{STATS}/PlayerGameStatsByDate/{date}?key={API_KEY}"
    return fetch_json(url)


# --------------------------------------------------
# BUILD ENGINE
# --------------------------------------------------

def main():
    print("Building FREE-TIER hybrid stats...", file=sys.stderr)

    # Load your rosters.json
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    # Load standings for defense and team records
    standings = get_standings()

    # Build defense rank
    sorted_by_def = sorted(standings, key=lambda t: t.get("PointsAgainst", 999))
    def_rank = {t["Key"]: i + 1 for i, t in enumerate(sorted_by_def)}

    # Build team record info
    team_info = {}
    for t in standings:
        team_info[t["Key"]] = {
            "wins": t.get("Wins", 0),
            "losses": t.get("Losses", 0),
            "win_pct": t.get("Percentage", 0),
            "record_str": f"{t.get('Wins', 0)}-{t.get('Losses', 0)}",
            "streak": t.get("StreakDescription", ""),
            "points_for": t.get("PointsFor"),
            "points_against": t.get("PointsAgainst"),
            "conf_rank": t.get("ConferenceRank"),
            "div_rank": t.get("DivisionRank"),
        }

    # Get today’s matchups
    todays = get_todays_games()
    opponent_map = {}
    for g in todays:
        opponent_map[g["HomeTeam"]] = g["AwayTeam"]
        opponent_map[g["AwayTeam"]] = g["HomeTeam"]

    # Pull today’s game logs
    try:
        today_logs = get_player_logs_for_date(TODAY)
    except:
        today_logs = []

    # Pull yesterday logs as fallback
    try:
        yesterday_logs = get_player_logs_for_date(YESTERDAY)
    except:
        yesterday_logs = []

    logs_by_player = {}

    for log in today_logs + yesterday_logs:
        name = log["Name"].strip()
        logs_by_player[name] = log

    final = {}
    missing = []

    # -------------------------
    # MAIN PLAYER LOOP
    # -------------------------

    for team, players in rosters.items():

        # Free-tier season stats by TEAM (NOT league-wide)
        try:
            team_season = get_team_season_stats(team)
        except:
            team_season = []

        season_by_name = {
            p["Name"].strip(): p
            for p in team_season
        }

        for name in players:
            raw_szn = season_by_name.get(name)
            raw_log = logs_by_player.get(name)
            opp = opponent_map.get(team)
            opp_info = team_info.get(opp, {}) if opp else {}

            if raw_szn is None:
                missing.append((name, team))
                final[name] = {
                    "team": team,
                    "season": YEAR,
                    "games": 0,
                    "pts": 0,
                    "reb": 0,
                    "ast": 0,
                    "stl": 0,
                    "blk": 0,
                    "tov": 0,
                    "usage": 0,
                    "pace": None,
                    "opponent": opp,
                    "def_rank": def_rank.get(opp),
                    "team_record": team_info[team]["record_str"],
                    "opp_record": opp_info.get("record_str"),
                }
                continue

            games = raw_szn.get("Games", 0) or 1

            # PER-GAME AVERAGES
            pts = raw_szn.get("Points", 0) / games
            reb = raw_szn.get("Rebounds", 0) / games
            ast = raw_szn.get("Assists", 0) / games
            stl = raw_szn.get("Steals", 0) / games
            blk = raw_szn.get("BlockedShots", 0) / games
            tov = raw_szn.get("Turnovers", 0) / games
            min_pg = raw_szn.get("Minutes", 0) / games

            # FINAL COMPOSITE
            final[name] = {
                "team": team,
                "season": YEAR,

                "games": games,
                "min": min_pg,
                "pts": pts,
                "reb": reb,
                "ast": ast,
                "stl": stl,
                "blk": blk,
                "tov": tov,

                # These free-tier endpoints do NOT provide UsageRate or Pace
                "usage": 0,
                "pace": None,

                "opponent": opp,
                "def_rank": def_rank.get(opp),
                "team_record": team_info[team]["record_str"],
                "team_win_pct": team_info[team]["win_pct"],
                "opp_record": opp_info.get("record_str"),
                "opp_win_pct": opp_info.get("win_pct"),
                "opp_streak": opp_info.get("streak"),
                "opp_points_for": opp_info.get("points_for"),
                "opp_points_against": opp_info.get("points_against"),
                "opp_conf_rank": opp_info.get("conf_rank"),
                "opp_div_rank": opp_info.get("div_rank"),
            }

            # Merge today's logs on top
            if raw_log:
                final[name]["today_pts"] = raw_log.get("Points", 0)
                final[name]["today_reb"] = raw_log.get("Rebounds", 0)
                final[name]["today_ast"] = raw_log.get("Assists", 0)

    # Write output
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)

    print("Built FREE-TIER hybrid player_stats.json", file=sys.stderr)

    if missing:
        print("\nMissing players:", file=sys.stderr)
        for m in missing:
            print(" -", m, file=sys.stderr)


if __name__ == "__main__":
    main()
