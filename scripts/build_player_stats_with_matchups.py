#!/usr/bin/env python3
"""
Full Phase-7 Backend Builder
-----------------------------------------
Produces player_stats.json with:
- Season per-game averages
- Last 5 game trends (PTS / REB / AST)
- Usage Rate
- Pace
- Opponent
- Opponent defensive rank
- Team record
- Opponent record + streak
- Confidence score (0–100)

This EXACT format matches the new UI layouts.
"""

import json
import os
import sys
from datetime import datetime
import requests
from statistics import mean

# -------------------------------------------------------------------
# CONFIG
# -------------------------------------------------------------------

API_KEY = os.getenv("SPORTSDATA_API_KEY", "61d3779041f44f37bd511dbe1c70e84e").strip()
if not API_KEY:
    print("ERROR: Missing SPORTSDATA_API_KEY", file=sys.stderr)
    sys.exit(1)

SEASON = 2025  # SportsData uses 2025 for the 2025-26 season
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BASE_STATS = "https://api.sportsdata.io/v3/nba/stats/json"
BASE_SCORES = "https://api.sportsdata.io/v3/nba/scores/json"

HEADERS = {"Ocp-Apim-Subscription-Key": API_KEY}

# -------------------------------------------------------------------
# HELPERS
# -------------------------------------------------------------------

def fetch_json(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_season_totals():
    url = f"{BASE_STATS}/PlayerSeasonStats/{SEASON}"
    return fetch_json(url)


def fetch_game_logs():
    url = f"{BASE_STATS}/PlayerGameStatsBySeason/{SEASON}"
    return fetch_json(url)


def fetch_standings():
    url = f"{BASE_SCORES}/Standings/{SEASON}"
    return fetch_json(url)


def fetch_todays_games():
    url = f"{BASE_SCORES}/GamesByDate/{TODAY}"
    return fetch_json(url)


# -------------------------------------------------------------------
# MAIN BUILDER
# -------------------------------------------------------------------

def build_trends(game_logs):
    """Return last-5 averages for pts/reb/ast."""
    if not game_logs:
        return {"trend_pts": 0, "trend_reb": 0, "trend_ast": 0}

    # Sort newest → oldest
    game_logs = sorted(game_logs, key=lambda g: g["Date"], reverse=True)
    last5 = game_logs[:5]

    def safe_avg(field):
        vals = [g.get(field, 0) for g in last5]
        return round(mean(vals), 2) if vals else 0

    return {
        "trend_pts": safe_avg("Points"),
        "trend_reb": safe_avg("Rebounds"),
        "trend_ast": safe_avg("Assists")
    }


def compute_confidence(season_pts, trend_pts, usage, def_rank):
    """Output a 0–100 score used by UI."""
    score = 50

    # upward momentum
    if trend_pts > season_pts:
        score += 10

    # heavy usage
    if usage > 22:
        score += 10

    # good matchup
    if def_rank and def_rank >= 20:
        score += 10

    # bad matchup
    if def_rank and def_rank <= 10:
        score -= 10

    return int(max(0, min(100, score)))


def main():
    print("Building stats…", file=sys.stderr)

    # Load roster
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    season = fetch_season_totals()
    logs = fetch_game_logs()
    standings = fetch_standings()
    todays = fetch_todays_games()

    # Build lookups
    season_by_name = {p["Name"]: p for p in season}

    logs_by_player = {}
    for g in logs:
        logs_by_player.setdefault(g["Name"], []).append(g)

    # opponent map
    opp_map = {}
    for g in todays:
        opp_map[g["HomeTeam"]] = g["AwayTeam"]
        opp_map[g["AwayTeam"]] = g["HomeTeam"]

    # team standings info
    team_info = {}
    for t in standings:
        team_info[t["Key"]] = {
            "record": f"{t['Wins']}-{t['Losses']}",
            "streak": t.get("StreakDescription", "N/A"),
            "points_against": t.get("PointsAgainst", 0)
        }

    # defensive rankings
    sorted_def = sorted(standings, key=lambda t: t.get("PointsAgainst", 999))
    def_rank = {t["Key"]: i + 1 for i, t in enumerate(sorted_def)}

    final = {}
    missing = []

    for team, players in rosters.items():
        for name in players:

            raw = season_by_name.get(name)
            if raw is None:
                missing.append(name)
                continue

            games = raw.get("Games", 1)
            minutes = raw.get("Minutes", 0)

            # per game
            pts = raw.get("Points", 0) / games
            reb = raw.get("Rebounds", 0) / games
            ast = raw.get("Assists", 0) / games

            # trends
            tstats = build_trends(logs_by_player.get(name))

            # opp
            opp = opp_map.get(team)
            opp_def_rank = def_rank.get(opp) if opp else None
            opp_data = team_info.get(opp, {})

            # team
            team_data = team_info.get(team, {})

            # confidence
            conf = compute_confidence(
                pts,
                tstats["trend_pts"],
                raw.get("UsageRate", 0),
                opp_def_rank
            )

            final[name] = {
                "team": team,
                "opponent": opp,
                "def_rank": opp_def_rank,
                "team_record": team_data.get("record", "N/A"),
                "team_streak": team_data.get("streak", "N/A"),

                "opp_record": opp_data.get("record", "N/A"),
                "opp_streak": opp_data.get("streak", "N/A"),

                # core per-game stats
                "pts": round(pts, 1),
                "reb": round(reb, 1),
                "ast": round(ast, 1),

                # advanced
                "usage": raw.get("UsageRate", 0),
                "pace": raw.get("Possessions", None),

                # trends
                **tstats,

                # final score
                "confidence": conf
            }

    # write output
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, sort_keys=True)

    print("\nMissing players:")
    for m in missing:
        print(" -", m)


if __name__ == "__main__":
    main()
