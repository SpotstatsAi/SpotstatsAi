#!/usr/bin/env python3
"""
build_rosters_bdl.py

Builds rosters.json from the BallDontLie API.

- Uses /v1/players with pagination
- Filters to the 30 NBA franchises
- Output format matches your UI expectations:

 {
   "ATL": ["Trae Young", "Dejounte Murray", ...],
   "BOS": [...],
   ...
 }

Environment:
 BALLDONTLIE_API_KEY  -> your BallDontLie premium API key (Bearer token)
"""

import json
import os
import sys
from time import sleep

import requests

BDL_BASE = "https://api.balldontlie.io/v1"

API_KEY = os.getenv("BALLDONTLIE_API_KEY", "").strip()
if not API_KEY:
   print("ERROR: BALLDONTLIE_API_KEY is not set", file=sys.stderr)
   sys.exit(1)

# 30 NBA franchises (current abbreviations as used in most APIs)
NBA_TEAMS = {
   "ATL", "BOS", "BKN", "CHA", "CHI", "CLE",
   "DAL", "DEN", "DET", "GSW", "HOU", "IND",
   "LAC", "LAL", "MEM", "MIA", "MIL", "MIN",
   "NOP", "NYK", "OKC", "ORL", "PHI", "PHX",
   "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
}


def bdl_get(path: str, params: dict | None = None) -> dict:
   """
   Low-level GET wrapper for BallDontLie with auth + simple retry.
   """
   url = f"{BDL_BASE}/{path}"
   headers = {
       "Authorization": f"Bearer {API_KEY}",
       "Accept": "application/json",
   }

   for attempt in range(3):
       try:
           resp = requests.get(url, headers=headers, params=params, timeout=30)
           resp.raise_for_status()
           return resp.json()
       except requests.RequestException as e:
           print(f"[bdl_get] ERROR on {url} (attempt {attempt+1}/3): {e}", file=sys.stderr)
           if attempt == 2:
               raise
           sleep(1.5)

   raise RuntimeError("bdl_get: exhausted retries")


def fetch_rosters_from_bdl() -> dict:
   """
   Query /players and build {team_abbrev: [Player Full Name, ...]}.

   We:
     - paginate through /players
     - keep only players whose team.abbreviation is one of NBA_TEAMS
     - use 'active' flag to reduce noise
   """
   print("Fetching players from BallDontLie...", file=sys.stderr)

   rosters: dict[str, list[str]] = {abbr: [] for abbr in NBA_TEAMS}

   page = 1
   per_page = 100

   while True:
       params = {
           "page": page,
           "per_page": per_page,
           # Many BDL implementations support 'active' flag; harmless if ignored
           "active": "true",
       }

       data = bdl_get("players", params=params)
       players = data.get("data", [])
       meta = data.get("meta", {})

       if not players:
           break

       print(f"  players page {page}/{meta.get('total_pages', '?')}", file=sys.stderr)

       for p in players:
           team = p.get("team") or {}
           abbr = team.get("abbreviation")
           if abbr not in NBA_TEAMS:
               continue

           first = (p.get("first_name") or "").strip()
           last = (p.get("last_name") or "").strip()
           full_name = f"{first} {last}".strip()

           if full_name and full_name not in rosters[abbr]:
               rosters[abbr].append(full_name)

       # Pagination: BallDontLie meta usually has total_pages & next_page
       next_page = meta.get("next_page")
       if not next_page:
           break
       page = next_page

   # Sort each team’s roster alphabetically for consistency
   for abbr in sorted(rosters.keys()):
       rosters[abbr].sort()

   return rosters


def main():
   print("Building rosters.json from BallDontLie...", file=sys.stderr)
   rosters = fetch_rosters_from_bdl()

   with open("rosters.json", "w", encoding="utf-8") as f:
       json.dump(rosters, f, indent=2, sort_keys=True)

   # Simple summary
   total_players = sum(len(v) for v in rosters.values())
   print(f"Wrote rosters.json with {total_players} players across {len(rosters)} teams.", file=sys.stderr)


if __name__ == "__main__":
   main()
