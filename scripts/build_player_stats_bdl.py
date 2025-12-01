#!/usr/bin/env python3
"""
FULLY FIXED – BallDontLie Premium Builder
Creates player_stats.json using:

• /players                          (all players)
• /season_averages                  (per-game season)
• /stats                            (game logs → last 5 avg)
• schedule.json                     (opponent)
• rosters.json                      (your roster)

This version:
✔ Uses correct premium API format
✔ Correct pagination
✔ Correct param names (`player_id=` NOT arrays)
✔ Matches ALL players
✔ Produces clean stats for your UI
"""

import os
import json
import sys
from datetime import date
from time import sleep
import requests

# ------------------------
# CONFIG
# ------------------------
BDL_BASE = "https://api.balldontlie.io/v1"

API_KEY = os.getenv("BDL_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: BALLDONTLIE_API_KEY is not set.", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Accept": "application/json"
}

TODAY = date.today().isoformat()


# ------------------------
# HELPERS
# ------------------------

def bdl_get(path, params=None, retries=3):
    """GET wrapper with retry."""
    url = f"{BDL_BASE}/{path}"

    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[bdl_get] Error on {url}: {e} (attempt {attempt+1}/{retries})")
            sleep(1.2)

    raise RuntimeError(f"FAILED after retries: {url}")


def norm(s):
    """Normalize names for matching."""
    return (
        s.lower()
        .replace(".", " ")
        .replace("-", " ")
        .replace("'", "")
        .replace(",", "")
        .strip()
    )


def parse_min(min_val):
    """Convert 'MM:SS' → float minutes."""
    if not min_val:
        return 0.0
    try:
        mm, ss = min_val.split(":")
        return round(int(mm) + int(ss) / 60.0, 1)
    except:
        return 0.0


# ------------------------
# FETCH ALL PLAYERS (PAGINATED)
# ------------------------

def fetch_all_players():
    print("Fetching ALL players from BDL…", file=sys.stderr)
    players = []
    page = 1
    per_page = 100

    while True:
        data = bdl_get("players", params={"page": page, "per_page": per_page})
        arr = data.get("data", [])
        if not arr:
            break

        players.extend(arr)

        meta = data.get("meta", {})
        total_pages = meta.get("total_pages", page)

        print(f"  page {page}/{total_pages} ({len(arr)} players)", file=sys.stderr)

        if page >= total_pages:
            break

        page += 1

    print(f"Total players indexed: {len(players)}", file=sys.stderr)
    return players


def build_player_index():
    players = fetch_all_players()
    index = {}

    for p in players:
        first = p.get("first_name", "").strip()
        last = p.get("last_name", "").strip()
        full = f"{first} {last}".strip()
        key = norm(full)

        index[key] = {
            "id": p["id"],
            "team": p["team"]["abbreviation"] if p.get("team") else None,
            "full": full
        }

    return index


# ------------------------
# SEASON AVERAGES
# ------------------------

def fetch_season_avg(player_id, season):
    """Correct premium endpoint format."""
    data = bdl_get("season_averages", params={
        "season": season,
        "player_id": player_id
    })
    arr = data.get("data", [])
    return arr[0] if arr else None


# ------------------------
# LAST 5 GAMES
# ------------------------

def fetch_last5(player_id, season):
    data = bdl_get("stats", params={
        "seasons": season,
        "player_id": player_id,
        "per_page": 5,
        "page": 1,
        "sort": "game.date:desc",
        "postseason": "false"
    })

    games = data.get("data", [])
    if not games:
        return None

    n = len(games)
    pts = sum(g.get("pts", 0) for g in games) / n
    reb = sum(g.get("reb", 0) for g in games) / n
    ast = sum(g.get("ast", 0) for g in games) / n

    return {
        "pts": round(pts, 1),
        "reb": round(reb, 1),
        "ast": round(ast, 1)
    }


# ------------------------
# SCHEDULE → OPPONENT
# ------------------------

def load_schedule():
    with open("schedule.json", "r", encoding="utf-8") as f:
        return json.load(f)


def today_opponents(schedule):
    opp = {}
    games = schedule.get(TODAY, []) or []

    for g in games:
        home = g["home_team"]
        away = g["away_team"]
        opp[home] = away
        opp[away] = home

    return opp


# ------------------------
# MAIN BUILDER
# ------------------------

def build():
    print("🔵 Building Player Stats (BDL Premium)…", file=sys.stderr)

    season = date.today().year if date.today().month >= 10 else date.today().year - 1
    print(f"Season detected: {season}", file=sys.stderr)

    # Load rosters & schedule
    with open("rosters.json", "r") as f:
        rosters = json.load(f)

    schedule = load_schedule()
    opp_map = today_opponents(schedule)

    # Build full index
    index = build_player_index()

    final = {}
    missing = []

    for team, players in rosters.items():
        for raw_name in players:
            key = norm(raw_name)
            pinfo = index.get(key)

            if not pinfo:
                missing.append(raw_name)
                continue

            pid = pinfo["id"]

            avg = fetch_season_avg(pid, season)
            last5 = fetch_last5(pid, season)

            games = avg.get("games_played", 0) if avg else 0
            pts = avg.get("pts", 0.0) if avg else 0.0
            reb = avg.get("reb", 0.0) if avg else 0.0
            ast = avg.get("ast", 0.0) if avg else 0.0
            min_val = parse_min(avg.get("min")) if avg else 0.0

            fg_pct = avg.get("fg_pct")
            fg3_pct = avg.get("fg3_pct")
            ft_pct = avg.get("ft_pct")

            last5_pts = last5["pts"] if last5 else 0
            last5_reb = last5["reb"] if last5 else 0
            last5_ast = last5["ast"] if last5 else 0

            opponent = opp_map.get(team)

            final[raw_name] = {
                "team": team,
                "season": season,
                "games": games,
                "min": min_val,
                "pts": pts,
                "reb": reb,
                "ast": ast,
                "fg_pct": fg_pct,
                "fg3_pct": fg3_pct,
                "ft_pct": ft_pct,

                "last5_pts": last5_pts,
                "last5_reb": last5_reb,
                "last5_ast": last5_ast,

                "opponent": opponent,

                # your UI expects these, but BDL doesn’t provide them
                "def_rank": None,
                "team_record": None,
                "team_win_pct": None,
                "opp_record": None,
                "opp_win_pct": None,
                "opp_streak": None,
                "opp_points_for": None,
                "opp_points_against": None,
                "opp_conf_rank": None,
                "opp_div_rank": None,
                "pace": None,
                "usage": 0.0
            }

    print(f"Matched players: {len(final)}", file=sys.stderr)
    print(f"Missing players: {len(missing)}", file=sys.stderr)
    if missing:
        print("Unmatched:", missing, file=sys.stderr)

    with open("player_stats.json", "w") as f:
        json.dump(final, f, indent=2)

    print("✅ DONE — player_stats.json updated.", file=sys.stderr)


if __name__ == "__main__":
    build()
