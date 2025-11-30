#!/usr/bin/env python3
"""
Builds player_stats.json by:

- Loading static per-player season averages from player_stats_base.json
- Pulling today's schedule + standings from Sportradar (NBA Base)
- Attaching:
   - opponent team code for today's game
   - simple defensive rank (by points allowed)
   - team record
   - opponent record & streak

This keeps your UI happy without needing paid stats endpoints.
"""

import json
import os
import sys
from datetime import datetime, timezone
import time
import requests

# --------------------
# CONFIG
# --------------------

API_KEY = os.getenv("SPORTRADAR_NBA_KEY")
if not API_KEY:
   print("ERROR: SPORTRADAR_NBA_KEY is not set in the environment.", file=sys.stderr)
   sys.exit(1)

# Example: 2025–26 NBA season
SEASON_YEAR = 2025        # change if needed
SEASON_PHASE = "REG"      # REG, PST, etc.

# Sportradar NBA Base root – adjust "trial" vs "production" if you later upgrade
BASE_URL = "https://api.sportradar.us/nba/trial/v8/en"

# --------------------
# HELPERS
# --------------------


def sr_get(path):
   """
   Basic Sportradar GET helper.
   path: "/seasons/.../standings.json" etc. (without api_key)
   """
   url = f"{BASE_URL}{path}?api_key={API_KEY}"
   for attempt in range(3):
       try:
           resp = requests.get(url, timeout=20)
           if resp.status_code >= 500:
               # retry server errors
               print(f"Sportradar 5xx on {path}, retry {attempt+1}/3", file=sys.stderr)
               time.sleep(2)
               continue
           resp.raise_for_status()
           return resp.json()
       except requests.RequestException as e:
           print(f"Error calling Sportradar {path}: {e}", file=sys.stderr)
           if attempt == 2:
               raise
           time.sleep(2)
   # Should not reach here
   raise RuntimeError(f"Failed to fetch {path} after retries")


def get_today_iso():
   # GitHub runners are UTC, we'll just use UTC date
   return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_base_stats():
   with open("player_stats_base.json", "r", encoding="utf-8") as f:
       return json.load(f)


# --------------------
# SPORTRADAR DATA
# --------------------

def get_standings():
   """
   Pull standings for the season.

   Endpoint to confirm in docs:
   NBA Base typically exposes:
     /seasons/{season_year}/{season_phase}/standings.json

   If your docs say it's 'rankings.json' instead, change the path below.
   """
   path = f"/seasons/{SEASON_YEAR}/{SEASON_PHASE}/standings.json"
   data = sr_get(path)

   # We normalize into:
   #   { team_alias (e.g. "BOS") : {wins, losses, record_str, points_for, points_against} }
   teams = {}

   # The exact shape may differ slightly; adjust keys based on your JSON.
   # For NBA Base, "conferences" -> divisions -> teams is typical.
   conferences = data.get("conferences", [])
   for conf in conferences:
       for div in conf.get("divisions", []):
           for t in div.get("teams", []):
               alias = t.get("alias")       # e.g. "BOS"
               if not alias:
                   continue
               wins = t.get("wins", 0)
               losses = t.get("losses", 0)
               pf = t.get("points_for", 0)
               pa = t.get("points_against", 0)
               teams[alias] = {
                   "wins": wins,
                   "losses": losses,
                   "record_str": f"{wins}-{losses}",
                   "points_for": pf,
                   "points_against": pa,
               }

   # Build simple defensive rank (1 = lowest points allowed)
   # If no points_against, we just skip ranking.
   sortable = [
       (alias, info["points_against"])
       for alias, info in teams.items()
       if info["points_against"] is not None
   ]
   sortable.sort(key=lambda x: x[1])  # lower PA = better defense

   def_rank = {}
   for i, (alias, _) in enumerate(sortable, start=1):
       def_rank[alias] = i

   return teams, def_rank


def get_todays_games():
   """
   Pull today's schedule.

   Common NBA Base daily schedule pattern:
     /games/{yyyy}/{mm}/{dd}/schedule.json

   If docs show a slightly different path, update it here.
   """
   today = get_today_iso()          # '2025-11-30'
   yyyy, mm, dd = today.split("-")
   path = f"/games/{yyyy}/{mm}/{dd}/schedule.json"
   data = sr_get(path)

   games = []
   for g in data.get("games", []):
       home = g.get("home", {})
       away = g.get("away", {})

       games.append({
           "home_code": home.get("alias"),
           "away_code": away.get("alias"),
           "status": g.get("status"),
           "scheduled": g.get("scheduled"),  # full ISO time
       })

   return games


def build_opponent_map(todays_games):
   """
   Take list of games → map team_code -> opponent_code.
   """
   opp = {}
   for g in todays_games:
       h = g["home_code"]
       a = g["away_code"]
       if h and a:
           opp[h] = a
           opp[a] = h
   return opp


# --------------------
# MAIN MERGE LOGIC
# --------------------

def main():
   print("Building Sportradar-enriched player_stats.json...", file=sys.stderr)
   today = get_today_iso()
   print(f"Today: {today}", file=sys.stderr)

   # 1) Load your base player stats (BRef-derived)
   base_stats = load_base_stats()
   print(f"Loaded base stats for {len(base_stats)} players.", file=sys.stderr)

   # 2) Pull Sportradar data (standings + today's schedule)
   print("Fetching standings from Sportradar...", file=sys.stderr)
   standings, def_rank = get_standings()
   print(f"Got standings for {len(standings)} teams.", file=sys.stderr)

   print("Fetching today's games from Sportradar...", file=sys.stderr)
   todays_games = get_todays_games()
   print(f"Games today: {len(todays_games)}", file=sys.stderr)

   opponent_map = build_opponent_map(todays_games)

   # 3) Merge into final player_stats.json
   final = {}

   for name, s in base_stats.items():
       team = s.get("team")
       if not team:
           final[name] = s
           continue

       team_info = standings.get(team, {})
       opp_code = opponent_map.get(team)
       opp_info = standings.get(opp_code, {}) if opp_code else {}

       # Copy everything from base first
       merged = dict(s)

       # Attach / overwrite matchup fields
       merged["opponent"] = opp_code
       merged["def_rank"] = def_rank.get(opp_code)

       merged["team_record"] = team_info.get("record_str")
       merged["team_win_pct"] = None  # could compute if you want

       merged["opp_record"] = opp_info.get("record_str")
       # If standings JSON exposes "streak", add here:
       merged["opp_streak"] = opp_info.get("streak") if "streak" in opp_info else None

       merged["opp_points_for"] = opp_info.get("points_for")
       merged["opp_points_against"] = opp_info.get("points_against")

       final[name] = merged

   # 4) Write output
   with open("player_stats.json", "w", encoding="utf-8") as f:
       json.dump(final, f, indent=2, sort_keys=True)

   print(f"Wrote player_stats.json with {len(final)} players.", file=sys.stderr)


if __name__ == "__main__":
   main()
