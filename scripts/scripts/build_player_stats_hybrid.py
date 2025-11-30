#!/usr/bin/env python3
"""
Hybrid stats builder:
- BR season averages (via your CF proxy)
- BallDontLie recent game logs
- SportsData Scores (opponent, standings, def rank)
Produces player_stats.json used by your UI.
"""

import json, sys, requests
from datetime import datetime
from bs4 import BeautifulSoup, Comment

# ------------------------------
# CONFIG
# ------------------------------

YEAR = 2026          # BR season end year
SEASON_BDL = 2025    # BallDontLie season
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

BR_PROXY = "https://bbr-proxy.dblair1027.workers.dev/?url="
BR_PER_GAME = f"https://www.basketball-reference.com/leagues/NBA_{YEAR}_per_game.html"
BR_TABLE_ID = "per_game_stats"

SPORTS_SCORES_BASE = "https://api.sportsdata.io/v3/nba/scores/json"
SPORTSDATA_KEY = ""   # ← no need for paid key if you only use Scores API

# ------------------------------
# FETCH HELPERS
# ------------------------------

def fetch_json(url):
    """Simple JSON fetch (SportsData: Scores API is free, no key needed)."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()

def fetch_via_proxy(url):
    full = BR_PROXY + requests.utils.quote(url, safe="")
    r = requests.get(full, timeout=40)
    r.raise_for_status()
    return r.text

# ------------------------------
# BR SCRAPER (season averages)
# ------------------------------

def extract_commented_tables(soup):
    tables = []
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        s2 = BeautifulSoup(c, "html.parser")
        for t in s2.find_all("table"):
            tables.append(t)
    return tables

def get_br_table(html, table_id):
    soup = BeautifulSoup(html, "html.parser")
    t = soup.find("table", id=table_id)
    if t: return t
    for t in extract_commented_tables(soup):
        if t.get("id") == table_id:
            return t
    raise RuntimeError(f"BR table not found: {table_id}")

def parse_br_per_game():
    html = fetch_via_proxy(BR_PER_GAME)
    table = get_br_table(html, BR_TABLE_ID)
    rows = table.find("tbody").find_all("tr")

    per = {}
    for r in rows:
        if "class" in r.attrs and "thead" in r["class"]:
            continue
        name = r.find("td", {"data-stat":"player"})
        team = r.find("td", {"data-stat":"team_id"})
        if not name or not team: continue

        name = name.get_text(strip=True)
        team = team.get_text(strip=True)

        def num(stat):
            td = r.find("td", {"data-stat": stat})
            if not td: return 0.0
            try: return float(td.get_text(strip=True))
            except: return 0.0

        per[name] = {
            "team": team,
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
            "games": int(num("g"))
        }
    return per

# ------------------------------
# BALLDONTLIE GAME LOGS
# ------------------------------

def bdl_player_search(name):
    url = f"https://www.balldontlie.io/api/v1/players?search={name}"
    data = fetch_json(url)
    if data["data"]:
        return data["data"][0]["id"]
    return None

def bdl_game_logs(player_id):
    url = f"https://www.balldontlie.io/api/v1/stats?player_ids[]={player_id}&seasons[]={SEASON_BDL}&per_page=40"
    return fetch_json(url)["data"]

def compute_recent_form(logs):
    if not logs: return {}

    pts = [g["pts"] for g in logs]
    reb = [g["reb"] for g in logs]
    ast = [g["ast"] for g in logs]

    def avg(lst, n):
        if len(lst) < n: n = len(lst)
        return sum(lst[:n]) / max(n,1)

    return {
        "last_game_pts": pts[0],
        "last5_pts": avg(pts,5),
        "last10_pts": avg(pts,10),
        "last5_reb": avg(reb,5),
        "last5_ast": avg(ast,5)
    }

# ------------------------------
# SPORTS DATA (Scores API)
# ------------------------------

def get_todays_games():
    return fetch_json(f"{SPORTS_SCORES_BASE}/GamesByDate/{TODAY}")

def get_standings():
    return fetch_json(f"{SPORTS_SCORES_BASE}/Standings/{SEASON_BDL}")

def compute_def_ranks(standings):
    sorted_teams = sorted(standings, key=lambda t: t.get("PointsAgainst",999))
    return {t["Key"]: i+1 for i,t in enumerate(sorted_teams)}

# ------------------------------
# MAIN
# ------------------------------

def main():
    print("Building hybrid stats…", file=sys.stderr)

    # Load rosters
    with open("rosters.json") as f:
        rosters = json.load(f)

    # BR averages
    br_stats = parse_br_per_game()

    # SportsData
    todays = get_todays_games()
    standings = get_standings()
    def_ranks = compute_def_ranks(standings)

    opponent_map = {}
    for g in todays:
        home = g["HomeTeam"]
        away = g["AwayTeam"]
        opponent_map[home] = away
        opponent_map[away] = home

    final = {}

    for team, players in rosters.items():
        for name in players:

            base = br_stats.get(name, {"pts":0,"reb":0,"ast":0,"team":team})

            # opponent
            opp = opponent_map.get(team)

            # team + opp standings
            team_row = next((t for t in standings if t["Key"]==team), {})
            opp_row = next((t for t in standings if t["Key"]==opp), {})

            # bdl logs
            pid = bdl_player_search(name)
            logs = bdl_game_logs(pid) if pid else []
            recent = compute_recent_form(logs)

            final[name] = {
                **base,
                "opponent": opp,
                "def_rank": def_ranks.get(opp),
                "team_record": f"{team_row.get('Wins',0)}-{team_row.get('Losses',0)}",
                "opp_record": f"{opp_row.get('Wins',0)}-{opp_row.get('Losses',0)}",
                "opp_streak": opp_row.get("StreakDescription",""),
                **recent
            }

    with open("player_stats.json","w") as f:
        json.dump(final,f,indent=2)

    print("DONE", file=sys.stderr)

if __name__ == "__main__":
    main()
