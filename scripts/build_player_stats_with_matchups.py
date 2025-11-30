#!/usr/bin/env python3
"""
Builds player_stats.json with:

- Per-game season averages from SportsData.io
- Last-5-game averages (PTS / REB / AST)
- Trend flags & consistency scores
- Matchup context (opponent, def rank, records, streak)
- SMI (Strength of Matchup Index)
- Overall confidence score + recommendation tag

Designed to feed the NBA Prop Engine UI.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime

import requests

# -----------------------------
# CONFIG
# -----------------------------

API_KEY = os.getenv("SPORTSDATA_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: SPORTSDATA_API_KEY missing!", file=sys.stderr)
    sys.exit(1)

SEASON = 2025  # 2025-26 season in SportsData terms
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BASE_STATS_URL = "https://api.sportsdata.io/v3/nba/stats/json"
BASE_SCORES_URL = "https://api.sportsdata.io/v3/nba/scores/json"


# -----------------------------
# HELPERS
# -----------------------------

def fetch_json(url: str):
    headers = {"Ocp-Apim-Subscription-Key": API_KEY}
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_player_season_stats():
    url = f"{BASE_STATS_URL}/PlayerSeasonStats/{SEASON}?key={API_KEY}"
    return fetch_json(url)


def fetch_player_game_stats():
    """
    All player-game stats for the season.
    Used to compute last-5-game trends & variance.
    """
    url = f"{BASE_STATS_URL}/PlayerGameStatsBySeason/{SEASON}?key={API_KEY}"
    return fetch_json(url)


def fetch_todays_games():
    url = f"{BASE_SCORES_URL}/GamesByDate/{TODAY}?key={API_KEY}"
    return fetch_json(url)


def fetch_standings():
    url = f"{BASE_SCORES_URL}/Standings/{SEASON}?key={API_KEY}"
    return fetch_json(url)


def safe_div(num, den):
    return num / den if den else 0.0


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# -----------------------------
# MAIN
# -----------------------------

def main():
    print(f"Building stats for season {SEASON}, date {TODAY}", file=sys.stderr)

    # Load rosters
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    # Fetch raw data
    print("Fetching season stats...", file=sys.stderr)
    season_stats = fetch_player_season_stats()

    print("Fetching player game logs...", file=sys.stderr)
    game_logs = fetch_player_game_stats()

    print("Fetching today's games...", file=sys.stderr)
    todays_games = fetch_todays_games()

    print("Fetching standings...", file=sys.stderr)
    standings = fetch_standings()

    # ------------------------ #
    # Build lookups
    # ------------------------ #

    # Season stats by player name
    season_by_name = {p["Name"].strip(): p for p in season_stats}

    # Game logs grouped by player name (sorted by date later)
    logs_by_name = defaultdict(list)
    for g in game_logs:
        name = g["Name"].strip()
        logs_by_name[name].append(g)
    for name in logs_by_name:
        logs_by_name[name].sort(key=lambda x: x.get("Date", ""))

    # Opponent mapping for today
    opponents = {}
    for g in todays_games:
        home = g["HomeTeam"]
        away = g["AwayTeam"]
        opponents[home] = away
        opponents[away] = home

    # Standings info by team key
    team_info = {}
    for t in standings:
        code = t["Key"]
        wins = t.get("Wins", 0)
        losses = t.get("Losses", 0)
        pct = t.get("Percentage", safe_div(wins, wins + losses))
        team_info[code] = {
            "wins": wins,
            "losses": losses,
            "pct": pct,
            "record_str": f"{wins}-{losses}",
            "streak": t.get("StreakDescription") or "N/A",
            "pf": t.get("PointsFor"),
            "pa": t.get("PointsAgainst"),
            "conf_rank": t.get("ConferenceRank"),
            "div_rank": t.get("DivisionRank"),
        }

    # Defensive rank (lower PointsAgainst = better defense)
    sorted_def = sorted(standings, key=lambda x: x.get("PointsAgainst", 999))
    def_rank = {t["Key"]: i + 1 for i, t in enumerate(sorted_def)}

    # League averages for SMI normalization
    avg_pf = safe_div(
        sum(t.get("PointsFor", 0) for t in standings),
        len(standings) or 1
    )

    # ------------------------ #
    # Build final player objects
    # ------------------------ #

    final = {}
    missing = []

    for team_code, players in rosters.items():
        for name in players:
            season_raw = season_by_name.get(name)

            if season_raw is None:
                missing.append((name, team_code))
                final[name] = {
                    "team": team_code,
                    "season": SEASON,
                    "games": 0,
                    "min": 0.0,
                    "pts": 0.0,
                    "reb": 0.0,
                    "ast": 0.0,
                    "stl": 0.0,
                    "blk": 0.0,
                    "tov": 0.0,
                    "usage": 0.0,
                    "pace": None,
                    "opponent": None,
                    "def_rank": None,
                    "team_record": None,
                    "opp_record": None,
                    "opp_streak": None,
                    "smi": 0.5,
                    "confidence": 50,
                    "rec_tag": "Unknown",
                }
                continue

            # --- season per-game averages ---
            games = season_raw.get("Games", 0)
            g = games or 1

            season_pts = safe_div(season_raw.get("Points", 0), g)
            season_reb = safe_div(season_raw.get("Rebounds", 0), g)
            season_ast = safe_div(season_raw.get("Assists", 0), g)
            season_min = safe_div(season_raw.get("Minutes", 0), g)
            season_stl = safe_div(season_raw.get("Steals", 0), g)
            season_blk = safe_div(season_raw.get("BlockedShots", 0), g)
            season_tov = safe_div(season_raw.get("Turnovers", 0), g)

            usage = season_raw.get("UsageRate", 0.0) or 0.0
            poss = season_raw.get("Possessions")

            # --- last 5 games trends & variance ---
            logs = logs_by_name.get(name, [])
            last5 = logs[-5:] if logs else []

            if last5:
                l5_pts = safe_div(sum(l.get("Points", 0) for l in last5), len(last5))
                l5_reb = safe_div(sum(l.get("Rebounds", 0) for l in last5), len(last5))
                l5_ast = safe_div(sum(l.get("Assists", 0) for l in last5), len(last5))

                def std(values, mean):
                    if not values:
                        return 0.0
                    var = sum((v - mean) ** 2 for v in values) / len(values)
                    return var ** 0.5

                pts_values = [l.get("Points", 0) for l in last5]
                reb_values = [l.get("Rebounds", 0) for l in last5]
                ast_values = [l.get("Assists", 0) for l in last5]

                pts_std = std(pts_values, l5_pts)
                reb_std = std(reb_values, l5_reb)
                ast_std = std(ast_values, l5_ast)

                # consistency = 1 - coefficient of variation (clamped)
                def cons(std_val, mean_val):
                    if mean_val <= 0:
                        return 0.5
                    cv = std_val / mean_val
                    return clamp(1.0 - cv, 0.0, 1.0)

                cons_pts = cons(pts_std, l5_pts)
                cons_reb = cons(reb_std, l5_reb)
                cons_ast = cons(ast_std, l5_ast)
            else:
                l5_pts = season_pts
                l5_reb = season_reb
                l5_ast = season_ast
                cons_pts = cons_reb = cons_ast = 0.5

            # trend labels
            def trend_label(last5_val, season_val):
                if season_val <= 0:
                    return "flat"
                diff_pct = (last5_val - season_val) / season_val
                if diff_pct > 0.15:
                    return "up"
                if diff_pct < -0.15:
                    return "down"
                return "flat"

            trend_pts = trend_label(l5_pts, season_pts)
            trend_reb = trend_label(l5_reb, season_reb)
            trend_ast = trend_label(l5_ast, season_ast)

            # --- matchup context ---
            opp_team = opponents.get(team_code)
            team_rec = team_info.get(team_code, {})
            opp_rec = team_info.get(opp_team, {}) if opp_team else {}

            dr = def_rank.get(opp_team) if opp_team else None

            # --- Strength of Matchup Index (0–1) ---
            # def_component: 1 when def_rank=30 (weak D), ~0 when def_rank=1 (elite D)
            if dr:
                def_component = (dr - 1) / 29.0
            else:
                def_component = 0.5

            # pace component: using opponent PointsFor vs league avg
            if opp_rec.get("pf") and avg_pf:
                pace_component = clamp(opp_rec["pf"] / avg_pf, 0.5, 1.5)
                pace_component = (pace_component - 0.5) / 1.0  # normalize 0–1
            else:
                pace_component = 0.5

            win_pct = opp_rec.get("pct", 0.5)
            win_component = 1.0 - win_pct  # weaker teams → better matchup

            smi = clamp(
                0.4 * def_component +
                0.3 * pace_component +
                0.3 * win_component,
                0.0,
                1.0
            )

            # --- Confidence score (0–100) ---
            confidence = 50.0

            # usage & minutes
            if usage >= 28:
                confidence += 15
            elif usage >= 22:
                confidence += 8

            if season_min >= 32:
                confidence += 12
            elif season_min >= 26:
                confidence += 6

            # matchup
            if smi >= 0.7:
                confidence += 10
            elif smi >= 0.55:
                confidence += 5
            elif smi <= 0.35:
                confidence -= 8

            # trends
            if trend_pts == "up":
                confidence += 6
            elif trend_pts == "down":
                confidence -= 6

            # consistency
            avg_cons = (cons_pts + cons_reb + cons_ast) / 3.0
            if avg_cons >= 0.75:
                confidence += 6
            elif avg_cons <= 0.4:
                confidence -= 6

            confidence = clamp(round(confidence), 0, 100)

            # recommendation
            if confidence >= 80:
                rec_tag = "AUTO-GREEN"
            elif confidence >= 60:
                rec_tag = "Value Play"
            elif confidence >= 40:
                rec_tag = "Volatile"
            else:
                rec_tag = "Avoid"

            final[name] = {
                "team": team_code,
                "season": SEASON,

                # per-game season averages
                "games": games,
                "min": season_min,
                "pts": season_pts,
                "reb": season_reb,
                "ast": season_ast,
                "stl": season_stl,
                "blk": season_blk,
                "tov": season_tov,

                # last-5 averages
                "l5_pts": l5_pts,
                "l5_reb": l5_reb,
                "l5_ast": l5_ast,

                # trend labels
                "trend_pts": trend_pts,
                "trend_reb": trend_reb,
                "trend_ast": trend_ast,

                # consistency (0–1)
                "cons_pts": cons_pts,
                "cons_reb": cons_reb,
                "cons_ast": cons_ast,

                # advanced
                "usage": usage,
                "pace": poss,
                "smi": smi,
                "confidence": confidence,
                "rec_tag": rec_tag,

                # matchup
                "opponent": opp_team,
                "def_rank": dr,

                # team context
                "team_record": team_rec.get("record_str"),
                "team_win_pct": team_rec.get("pct"),
                "opp_record": opp_rec.get("record_str"),
                "opp_win_pct": opp_rec.get("pct"),
                "opp_streak": opp_rec.get("streak"),
                "opp_points_for": opp_rec.get("pf"),
                "opp_points_against": opp_rec.get("pa"),
                "opp_conf_rank": opp_rec.get("conf_rank"),
                "opp_div_rank": opp_rec.get("div_rank"),
            }

    # Write output
    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, sort_keys=True)

    if missing:
        print("\nPlayers not found in SportsData:", file=sys.stderr)
        for n, t in missing:
            print(f" - {n} ({t})", file=sys.stderr)


if __name__ == "__main__":
    main()
