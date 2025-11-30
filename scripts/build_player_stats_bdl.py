#!/usr/bin/env python3
"""
Build player_stats.json using the balldontlie NBA API.

- Uses rosters.json + schedule.json from the repo
- Only builds stats for teams that play TODAY (based on schedule.json)
- Per-game season averages from /season_averages
- Optional last-5-game averages from /stats
- Keeps the JSON structure compatible with the current UI
"""

import json
import os
import sys
from datetime import datetime, date
from urllib.parse import quote_plus

import requests

# -----------------------------
# CONFIG
# -----------------------------

API_KEY = os.getenv("BALLDONTLIE_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: BALLDONTLIE_API_KEY env var is missing", file=sys.stderr)
    sys.exit(1)

API_BASE = "https://api.balldontlie.io/nba/v1"
SEASON = int(os.getenv("NBA_SEASON", "2025"))  # 2025 = 2025-26 season

HEADERS = {
    "Authorization": API_KEY,
    "Accept": "application/json",
    "User-Agent": "SpotstatsAi-PropEngine/1.0",
}

TODAY = date.today().isoformat()


# -----------------------------
# HELPERS
# -----------------------------


def fetch_json(url: str) -> dict:
    """GET wrapper with small error message."""
    print(f"  -> GET {url}", file=sys.stderr)
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def normalize_name(name: str) -> str:
    """Lowercase + remove punctuation like dots and apostrophes."""
    n = name.lower()
    for ch in [".", "'", "-", ","]:
        n = n.replace(ch, " ")
    # remove common suffixes
    for suf in [" jr", " sr", " ii", " iii", " iv"]:
        if n.endswith(suf):
            n = n[: -len(suf)]
    # squash spaces
    n = " ".join(n.split())
    return n


def lookup_player_id(full_name: str, team_code: str) -> int | None:
    """
    Look up a balldontlie player id by full_name + team abbrev.

    Strategy:
      - /players?search=<full_name>
      - pick the one whose normalized name & team.abbreviation match
      - if none, fall back to first player with that team abbrev (best effort)
    """
    q = quote_plus(full_name)
    url = f"{API_BASE}/players?search={q}&per_page=100"
    data = fetch_json(url)

    target = normalize_name(full_name)
    candidates = data.get("data", [])

    # 1) strict match on normalized full name + team
    for p in candidates:
        bdl_name = f"{p.get('first_name','')} {p.get('last_name','')}"
        if normalize_name(bdl_name) == target and p.get("team", {}).get(
            "abbreviation"
        ) == team_code:
            return p["id"]

    # 2) fallback: any player with this team abbreviation
    for p in candidates:
        if p.get("team", {}).get("abbreviation") == team_code:
            return p["id"]

    print(f"  !! Could not find player id for {full_name} ({team_code})", file=sys.stderr)
    return None


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def get_season_averages(player_ids: list[int]) -> dict[int, dict]:
    """Batch fetch season averages for many players at once."""
    result: dict[int, dict] = {}
    if not player_ids:
        return result

    for batch in chunked(player_ids, 50):
        ids_qs = "&".join(f"player_ids[]={pid}" for pid in batch)
        url = f"{API_BASE}/season_averages?season={SEASON}&{ids_qs}"
        data = fetch_json(url)
        for row in data.get("data", []):
            pid = row["player_id"]
            result[pid] = row

    return result


def get_last5_averages(player_id: int) -> dict:
    """Fetch last 5 regular-season games for a player and average pts/reb/ast."""
    url = (
        f"{API_BASE}/stats?player_ids[]={player_id}"
        f"&seasons[]={SEASON}&per_page=100&postseason=false"
    )
    data = fetch_json(url)
    games = data.get("data", [])

    if not games:
        return {"pts": 0.0, "reb": 0.0, "ast": 0.0}

    # sort by game date descending just to be safe
    def game_date(g):
        # g['game']['date'] is ISO8601; slice date portion
        return g.get("game", {}).get("date", "")[:10]

    games_sorted = sorted(games, key=game_date, reverse=True)
    last5 = games_sorted[:5]
    n = len(last5)

    pts = sum(g.get("pts", 0.0) for g in last5) / n
    reb = sum(g.get("reb", 0.0) for g in last5) / n
    ast = sum(g.get("ast", 0.0) for g in last5) / n

    return {"pts": pts, "reb": reb, "ast": ast}


# -----------------------------
# MAIN
# -----------------------------


def main():
    print("Building player_stats.json from balldontlie…", file=sys.stderr)
    print(f"Today: {TODAY}, Season: {SEASON}", file=sys.stderr)

    # 1) Load rosters + schedule
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    with open("schedule.json", "r", encoding="utf-8") as f:
        schedule = json.load(f)

    games_today = schedule.get(TODAY, [])
    if not games_today:
        print("No games in schedule.json for today. Writing empty player_stats.json.", file=sys.stderr)
        with open("player_stats.json", "w", encoding="utf-8") as f:
            json.dump({}, f, indent=2, sort_keys=True)
        return

    # figure out which teams play today
    teams_today: set[str] = set()
    opponent_map: dict[str, str] = {}

    for g in games_today:
        home = g["home_team"]
        away = g["away_team"]
        teams_today.add(home)
        teams_today.add(away)
        opponent_map[home] = away
        opponent_map[away] = home

    print(f"Teams playing today: {sorted(teams_today)}", file=sys.stderr)

    # 2) Build list of (name, team) for players we care about
    player_entries: list[tuple[str, str]] = []
    for t in sorted(teams_today):
        for name in rosters.get(t, []):
            player_entries.append((name, t))

    print(f"Players to resolve: {len(player_entries)}", file=sys.stderr)

    # 3) Look up balldontlie player ids
    id_by_name_team: dict[tuple[str, str], int] = {}
    for full_name, team_code in player_entries:
        pid = lookup_player_id(full_name, team_code)
        if pid is not None:
            id_by_name_team[(full_name, team_code)] = pid

    all_ids = sorted(set(id_by_name_team.values()))
    print(f"Resolved {len(all_ids)} unique player IDs", file=sys.stderr)

    # 4) Season averages for all resolved IDs
    print("Fetching season averages…", file=sys.stderr)
    season_avgs = get_season_averages(all_ids)

    # 5) Last-5-game averages per player (only for resolved IDs)
    print("Fetching last-5-game averages…", file=sys.stderr)
    last5_by_id: dict[int, dict] = {}
    for pid in all_ids:
        try:
            last5_by_id[pid] = get_last5_averages(pid)
        except Exception as e:  # don't blow up whole run for one player
            print(f"  !! last5 fetch failed for pid={pid}: {e}", file=sys.stderr)
            last5_by_id[pid] = {"pts": 0.0, "reb": 0.0, "ast": 0.0}

    # 6) Build final player_stats.json
    final: dict[str, dict] = {}

    for full_name, team_code in player_entries:
        pid = id_by_name_team.get((full_name, team_code))

        season_row = season_avgs.get(pid, {}) if pid is not None else {}
        last5_row = last5_by_id.get(pid, {}) if pid is not None else {}

        games = season_row.get("games_played", 0) or 0
        pts = float(season_row.get("pts", 0.0) or 0.0)
        reb = float(season_row.get("reb", 0.0) or 0.0)
        ast = float(season_row.get("ast", 0.0) or 0.0)
        stl = float(season_row.get("stl", 0.0) or 0.0)
        blk = float(season_row.get("blk", 0.0) or 0.0)
        tov = float(season_row.get("turnover", 0.0) or 0.0)

        fg3a = float(season_row.get("fg3a", 0.0) or 0.0)
        fg3_pct = float(season_row.get("fg3_pct", 0.0) or 0.0)
        fga = float(season_row.get("fga", 0.0) or 0.0)
        fg_pct = float(season_row.get("fg_pct", 0.0) or 0.0)
        fta = float(season_row.get("fta", 0.0) or 0.0)
        ft_pct = float(season_row.get("ft_pct", 0.0) or 0.0)

        opp = opponent_map.get(team_code)

        # Last 5
        l5_pts = float(last5_row.get("pts", 0.0) or 0.0)
        l5_reb = float(last5_row.get("reb", 0.0) or 0.0)
        l5_ast = float(last5_row.get("ast", 0.0) or 0.0)

        final[full_name] = {
            "team": team_code,
            "season": SEASON,

            "games": games,
            "pts": pts,
            "reb": reb,
            "ast": ast,
            "stl": stl,
            "blk": blk,
            "tov": tov,

            "fg3a": fg3a,
            "fg3_pct": fg3_pct,
            "fga": fga,
            "fg_pct": fg_pct,
            "fta": fta,
            "ft_pct": ft_pct,

            # matchup info (you can extend later with team records, def_rank, etc.)
            "opponent": opp,
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

            # advanced placeholders
            "usage": None,
            "pace": None,

            # last-5-game averages (for future UI use)
            "last5_pts": l5_pts,
            "last5_reb": l5_reb,
            "last5_ast": l5_ast,
        }

    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, sort_keys=True)

    print(f"Wrote player_stats.json with {len(final)} players", file=sys.stderr)


if __name__ == "__main__":
    main()
