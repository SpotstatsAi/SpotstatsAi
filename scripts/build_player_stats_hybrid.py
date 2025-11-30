#!/usr/bin/env python3
"""
Hybrid stats builder (FINAL PATCHED VERSION)

Sources:
- Basketball Reference (season averages)
- BallDontLie.io (recent game logs)
- SportsData.io Scores API (today's games, standings)

Produces:
player_stats.json ready for UI
"""

import json, sys, os, requests
from datetime import datetime
from bs4 import BeautifulSoup, Comment

# ----------------------------------------
# CONFIG
# ----------------------------------------

YEAR_BR = 2026          # Basketball-Reference season end year
BDL_SEASON = 2025       # BallDontLie season
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BR_PROXY = "https://bbr-proxy.dblair1027.workers.dev/?url="
BR_PER_GAME = f"https://www.basketball-reference.com/leagues/NBA_{YEAR_BR}_per_game.html"
BR_TABLE_ID = "per_game_stats"

SPORTS_SCORES = "https://api.sportsdata.io/v3/nba/scores/json"

SPORTSDATA_KEY = os.getenv("SPORTSDATA_API_KEY", "").strip()
if not SPORTSDATA_KEY:
    print("ERROR: SPORTSDATA_API_KEY is missing!", file=sys.stderr)
    sys.exit(1)

# ----------------------------------------
# BASIC FETCHERS
# ----------------------------------------

def fetch_json(url):
    """Generic safe JSON fetcher."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_via_proxy(url):
    """Fetch BR HTML through your Cloudflare Worker."""
    full = BR_PROXY + requests.utils.quote(url, safe="")
    resp = requests.get(full, timeout=40)
    resp.raise_for_status()
    return resp.text

# ----------------------------------------
# BASKETBALL REFERENCE SCRAPER
# ----------------------------------------

def extract_commented_tables(soup):
    tables = []
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        s2 = BeautifulSoup(c, "html.parser")
        for t in s2.find_all("table"):
            tables.append(t)
    return tables


def get_br_table(html, table_id):
    soup = BeautifulSoup(html, "html.parser")

    # direct table
    t = soup.find("table", id=table_id)
    if t:
        return t

    # commented tables
    for t in extract_commented_tables(soup):
        if t.get("id") == table_id:
            return t

    raise RuntimeError(f"BR table not found: {table_id}")


def parse_br_per_game():
    """Return {player_name: {pts, reb, ast, ...}}"""
    html = fetch_via_proxy(BR_PER_GAME)
    table = get_br_table(html, BR_TABLE_ID)
    rows = table.find("tbody").find_all("tr")

    per = {}

    for r in rows:
        if "class" in r.attrs and "thead" in r["class"]:
            continue

        name_td = r.find("td", {"data-stat": "player"})
        team_td = r.find("td", {"data-stat": "team_id"})
        if not name_td or not team_td:
            continue

        name = name_td.get_text(strip=True)
        team = team_td.get_text(strip=True)

        def num(stat):
            td = r.find("td", {"data-stat": stat})
            if not td:
                return 0.0
            txt = td.get_text(strip=True)
            try:
                return float(txt)
            except:
                return 0.0

        per[name] = {
            "team": team,
            "games": int(num("g")),
            "pts": num("pts_per_g"),
            "reb": num("trb_per_g"),
            "ast": num("ast_per_g"),
            "min": num("mp_per_g"),
            "stl": num("stl_per_g"),
            "blk": num("blk_per_g"),
            "tov": num("tov_per_g"),
            "fg3_pct": num("fg3_pct"),
            "fg_pct": num("fg_pct"),
            "ft_pct": num("ft_pct"),
        }

    return per

# ----------------------------------------
# BALLDONTLIE GAME LOGS (Free)
# ----------------------------------------

def bdl_search_player(name):
    """Return BallDontLie player ID or None."""
    url = f"https://www.balldontlie.io/api/v1/players?search={name}"
    data = fetch_json(url)
    if data["data"]:
        return data["data"][0]["id"]
    return None


def bdl_fetch_game_logs(pid):
    url = f"https://www.balldontlie.io/api/v1/stats?player_ids[]={pid}&seasons[]={BDL_SEASON}&per_page=40"
    return fetch_json(url)["data"]


def compute_recent_form(logs):
    if not logs:
        return {}

    pts = [g["pts"] for g in logs]
    reb = [g["reb"] for g in logs]
    ast = [g["ast"] for g in logs]

    def avg(arr, n):
        if len(arr) < n:
            n = len(arr)
        return sum(arr[:n]) / max(n, 1)

    return {
        "last_game_pts": pts[0],
        "last5_pts": avg(pts, 5),
        "last10_pts": avg(pts, 10),
        "last5_reb": avg(reb, 5),
        "last5_ast": avg(ast, 5),
    }

# ----------------------------------------
# SPORTSDATA SCORES API (Free tier)
# ----------------------------------------

def get_todays_games():
    url = f"{SPORTS_SCORES}/GamesByDate/{TODAY}?key={SPORTSDATA_KEY}"
    return fetch_json(url)


def get_standings():
    url = f"{SPORTS_SCORES}/Standings/{BDL_SEASON}?key={SPORTSDATA_KEY}"
    return fetch_json(url)


def compute_def_ranks(standings):
    sorted_rows = sorted(standings, key=lambda x: x.get("PointsAgainst", 999))
    return {row["Key"]: i + 1 for i, row in enumerate(sorted_rows)}

# ----------------------------------------
# MAIN COMPILE FUNCTION
# ----------------------------------------

def main():
    print("Building hybrid stats…", file=sys.stderr)

    # Load rosters.json
    with open("rosters.json", "r", encoding="utf-8") as f:
        rosters = json.load(f)

    # Fetch data
    br_stats = parse_br_per_game()
    todays_games = get_todays_games()
    standings = get_standings()
    def_ranks = compute_def_ranks(standings)

    # Opponent map
    opponents = {}
    for g in todays_games:
        home = g["HomeTeam"]
        away = g["AwayTeam"]
        opponents[home] = away
        opponents[away] = home

    # Build final dataset
    final = {}

    for team, players in rosters.items():
        for name in players:

            base = br_stats.get(name, {"team": team, "pts": 0, "reb": 0, "ast": 0})

            # Opponent
            opp = opponents.get(team)

            # Standings
            team_row = next((x for x in standings if x["Key"] == team), {})
            opp_row = next((x for x in standings if x["Key"] == opp), {})

            # Recent game logs
            pid = bdl_search_player(name)
            logs = bdl_fetch_game_logs(pid) if pid else []
            recent = compute_recent_form(logs)

            final[name] = {
                **base,
                "opponent": opp,
                "def_rank": def_ranks.get(opp),

                # team record
                "team_record": f"{team_row.get('Wins',0)}-{team_row.get('Losses',0)}",
                "team_win_pct": team_row.get("Percentage", 0),

                # opp record
                "opp_record": f"{opp_row.get('Wins',0)}-{opp_row.get('Losses',0)}",
                "opp_win_pct": opp_row.get("Percentage",0),
                "opp_streak": opp_row.get("StreakDescription", ""),

                # recent performance
                **recent
            }

    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)

    print("DONE", file=sys.stderr)


if __name__ == "__main__":
    main()
