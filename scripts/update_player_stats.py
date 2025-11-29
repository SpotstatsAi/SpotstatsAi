#!/usr/bin/env python3
"""
SportsData.io → player_stats.json converter
Pulls NBA current-season per-game + advanced stats and outputs JSON
identical to what your Prop Engine expects.
"""

import json
import sys
import requests

API_KEY = "61d3779041f44f37bd511dbe1c70e84e"

# SportsData.io endpoint
# Documentation: https://sportsdata.io/developers/api-documentation/nba#/player-season-stats
ENDPOINT = (
    "https://api.sportsdata.io/v3/nba/stats/json/PlayerSeasonStats/2026"
    f"?key={API_KEY}"
)


def fetch_stats():
    print("[fetch] Requesting SportsData.io season stats", file=sys.stderr)
    r = requests.get(ENDPOINT, timeout=30)
    r.raise_for_status()
    return r.json()


def to_internal_format(sd_player):
    """
    Convert SportsData.io fields → your app.js format.
    """
    return {
        "games": sd_player.get("Games", 0),
        "min": sd_player.get("Minutes", 0.0),
        "pts": sd_player.get("Points", 0.0),
        "reb": sd_player.get("Rebounds", 0.0),
        "ast": sd_player.get("Assists", 0.0),
        "stl": sd_player.get("Steals", 0.0),
        "blk": sd_player.get("BlockedShots", 0.0),
        "tov": sd_player.get("Turnovers", 0.0),

        "fg3a": sd_player.get("ThreePointAttempts", 0.0),
        "fg3_pct": sd_player.get("ThreePointPercentage", 0.0),

        "fga": sd_player.get("FieldGoalsAttempted", 0.0),
        "fg_pct": sd_player.get("FieldGoalsPercentage", 0.0),

        "fta": sd_player.get("FreeThrowsAttempted", 0.0),
        "ft_pct": sd_player.get("FreeThrowsPercentage", 0.0),

        # Extra fields needed by your engine
        "usage": sd_player.get("UsageRate", 0.0),
        "pace": None,
        "foul_difficulty": None,
        "blowout_risk": None,

        "season": 2026,
        "team": sd_player.get("Team", ""),
    }


def main():
    # load rosters.json so we only include players you use
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    sd_stats = fetch_stats()

    out = {}
    missing = []

    # build set of roster names for fast lookup
    roster_players = {name for team in rosters.values() for name in team}

    # index SportsData by full name
    sd_by_name = {}
    for p in sd_stats:
        name = p.get("Name", "").strip()
        if name:
            sd_by_name[name] = p

    # match each roster player with SportsData
    for name in roster_players:
        if name in sd_by_name:
            out[name] = to_internal_format(sd_by_name[name])
        else:
            # fallback zero
            missing.append(name)
            out[name] = to_internal_format({})

    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, sort_keys=True)

    print("[DONE] player_stats.json updated")

    if missing:
        print("\n[WARNING] Missing players:", file=sys.stderr)
        for name in missing:
            print(f" - {name}", file=sys.stderr)


if __name__ == "__main__":
    main()
