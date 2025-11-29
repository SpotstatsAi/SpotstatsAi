#!/usr/bin/env python3
"""
FINAL VERSION — WORKING WITH YOUR ACTUAL HTML FILES

Matches:
  - per_game  (from your Per Game HTML)
  - advanced  (from your Advanced HTML)

Extracts comment-wrapped tables and produces correct player_stats.json
for your UI.
"""

import json
import sys
import requests
from bs4 import BeautifulSoup, Comment

YEAR = 2026

PROXY = "https://bbr-proxy.dblair1027.workers.dev/?url="

PER_GAME_URL = f"https://www.basketball-reference.com/leagues/NBA_{YEAR}_per_game.html"
ADV_URL      = f"https://www.basketball-reference.com/leagues/NBA_{YEAR}_advanced.html"

# *** THESE ARE THE ACTUAL TABLE IDs FROM YOUR FILES ***
PER_TABLE_ID = "per_game"
ADV_TABLE_ID = "advanced"

TEAM_ALIASES = {
    "BKN": "BRK",
    "CHA": "CHO",
    "PHX": "PHO",
}

def to_bref_team(code):
    return TEAM_ALIASES.get(code, code)


def fetch_via_proxy(url):
    full = PROXY + requests.utils.quote(url, safe="")
    print(f"[fetch] {full}", file=sys.stderr)
    headers = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"}
    r = requests.get(full, headers=headers, timeout=40)
    r.raise_for_status()
    return r.text


def extract_commented_tables(soup):
    tables = []
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        try:
            sub = BeautifulSoup(c, "html.parser")
            for t in sub.find_all("table"):
                tables.append(t)
        except:
            pass
    return tables


def get_table(html, table_id):
    soup = BeautifulSoup(html, "html.parser")

    # try direct
    t = soup.find("table", id=table_id)
    if t:
        return t

    # try inside <!-- comments -->
    for tbl in extract_commented_tables(soup):
        if tbl.get("id") == table_id:
            return tbl

    raise RuntimeError(f"Table id={table_id} not found")


def parse_per_game():
    html = fetch_via_proxy(PER_GAME_URL)
    table = get_table(html, PER_TABLE_ID)
    rows = table.find("tbody").find_all("tr")

    per = {}
    tot = {}

    def cell(r, stat):
        td = r.find("td", {"data-stat": stat})
        return td.get_text(strip=True) if td else ""

    def num(v):
        try: return float(v)
        except: return 0.0

    for r in rows:
        if "class" in r.attrs and "thead" in r["class"]:
            continue

        name = cell(r, "player")
        team = cell(r, "team_id")

        if not name: continue

        rec = {
            "games": int(num(cell(r, "g"))),
            "min":  num(cell(r, "mp_per_g")),
            "pts":  num(cell(r, "pts_per_g")),
            "reb":  num(cell(r, "trb_per_g")),
            "ast":  num(cell(r, "ast_per_g")),
            "stl":  num(cell(r, "stl_per_g")),
            "blk":  num(cell(r, "blk_per_g")),
            "tov":  num(cell(r, "tov_per_g")),
            "fg3a": num(cell(r, "fg3a_per_g")),
            "fg3_pct": num(cell(r, "fg3_pct")),
            "fga":  num(cell(r, "fga_per_g")),
            "fg_pct": num(cell(r, "fg_pct")),
            "fta":  num(cell(r, "fta_per_g")),
            "ft_pct": num(cell(r, "ft_pct")),
        }

        if team == "TOT":
            tot[name] = rec
        else:
            per[(name, team)] = rec

    return per, tot


def parse_advanced():
    html = fetch_via_proxy(ADV_URL)
    table = get_table(html, ADV_TABLE_ID)

    rows = table.find("tbody").find_all("tr")
    usage = {}

    def cell(r, stat):
        td = r.find("td", {"data-stat": stat})
        return td.get_text(strip=True) if td else ""

    for r in rows:
        if "class" in r.attrs and "thead" in r["class"]:
            continue

        name = cell(r, "player")
        team = cell(r, "team_id")
        usg = cell(r, "usg_pct")

        if not name:
            continue

        try:
            val = float(usg)
        except:
            val = 0.0

        if team == "TOT":
            usage[name] = val
        else:
            usage.setdefault(name, val)

    return usage


def main():
    with open("rosters.json") as f:
        rosters = json.load(f)

    per, tot = parse_per_game()
    usage = parse_advanced()

    final = {}
    missing = []

    for team_code, players in rosters.items():
        bteam = to_bref_team(team_code)

        for name in players:
            stats = per.get((name, bteam)) or tot.get(name)

            if stats is None:
                missing.append(name)
                stats = {k:0 for k in [
                    "games","min","pts","reb","ast","stl","blk",
                    "tov","fg3a","fg3_pct","fga","fg_pct","fta","ft_pct"
                ]}

            out = dict(stats)
            out.update({
                "team": team_code,
                "season": YEAR,
                "usage": usage.get(name, 0.0),
                "pace": None,
                "foul_difficulty": None,
                "blowout_risk": None
            })

            final[name] = out

    with open("player_stats.json","w") as f:
        json.dump(final, f, indent=2, sort_keys=True)

    print("[DONE] Stats updated")
    if missing:
        print("Missing players:", missing)


if __name__ == "__main__":
    main()
