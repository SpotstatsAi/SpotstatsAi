# -*- coding: utf-8 -*-
"""
Builds player_stats.json from BallDontLie using your flat rosters.json.

- Uses BDL_API_KEY from environment (set in GitHub Actions)
- Reads rosters.json (flat list of players with "id", "name", "team", etc.)
- For each season (current + previous):
    - Fetches season averages for all roster player IDs, in batches
- Writes player_stats.json as a dict keyed by player_id (string)

Output structure:

{
  "237": {
    "id": 237,
    "name": "LeBron James",
    "team": "LAL",
    "seasons": {
      "2025": { ... BDL season averages object ... },
      "2024": { ... }
    }
  },
  ...
}
"""

import os
import json
import datetime
import requests

API_BASE = "https://api.balldontlie.io/v1"
API_KEY = os.environ.get("BDL_API_KEY")

if not API_KEY:
    raise SystemExit("BDL_API_KEY env var is not set")


def detect_seasons():
    """
    Returns (current_season, previous_season) as integers.

    Simple rule:
    - If month >= October, current season is this year
    - Else, current season is last year
    """
    today = datetime.date.today()
    year = today.year
    if today.month >= 10:
        current = year
    else:
        current = year - 1
    prev = current - 1
    print(f"Auto-detected BDL seasons: current={current}, previous={prev}")
    return current, prev


def bdl_get(path, params=None):
    """
    Wrapper for GET calls to BDL.
    """
    if params is None:
        params = {}

    url = f"{API_BASE}{path}"

    resp = requests.get(
        url,
        headers={"Authorization": API_KEY},
        params=params,
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(
            f"BDL GET {url} failed "
            f"({resp.status_code}): {resp.text}"
        )
    return resp.json()


def load_roster(roster_path="rosters.json"):
    """
    Load your flat roster.json

    Expected format:
    [
      {
        "id": 237,
        "name": "LeBron James",
        "team": "LAL",
        "first_name": "...",
        "last_name": "...",
        "pos": "F",
        "height": "...",
        "weight": "...",
        "jersey": "23"
      },
      ...
    ]
    """
    with open(roster_path, "r", encoding="utf-8") as f:
        roster = json.load(f)
    print(f"Loaded {len(roster)} players from {roster_path}")
    return roster


def fetch_season_averages_for_season(season, player_ids, batch_size=75):
    """
    Fetch season averages for the given season & list of player_ids.

    Uses BDL endpoint:
        /season_averages
    with params:
        season=SEASON
        player_ids[]=...

    Returns dict: player_id -> season_average_object
    """
    print(f"Fetching season averages for season {season}...")
    season_map = {}

    # BDL limits URL length, so we batch player_ids
    ids = list(player_ids)
    for i in range(0, len(ids), batch_size):
        batch = ids[i:i + batch_size]
        print(f"  batch {i // batch_size + 1}: {len(batch)} players")

        params = {
            "season": season,
        }
        # BDL expects player_ids[] repeated in the query
        for pid in batch:
            params.setdefault("player_ids[]", [])
            params["player_ids[]"].append(pid)

        data = bdl_get("/season_averages", params)

        for entry in data.get("data", []):
            pid = entry.get("player_id")
            if pid is None:
                continue
            season_map[pid] = entry

    print(
        f"Season {season}: got season averages for "
        f"{len(season_map)} of {len(player_ids)} players"
    )
    return season_map


def build_player_stats(roster, seasons):
    """
    Build the final player_stats structure.

    - roster: list of player objects
    - seasons: list of ints (e.g. [2025, 2024])

    Returns a dict keyed by player_id (string).
    """
    # Map player_id -> basic info from roster
    players_by_id = {}
    player_ids = []

    for p in roster:
        pid = p.get("id")
        if pid is None:
            continue
        player_ids.append(pid)
        players_by_id[pid] = {
            "id": pid,
            "name": p.get("name"),
            "first_name": p.get("first_name"),
            "last_name": p.get("last_name"),
            "team": p.get("team"),
            "pos": p.get("pos"),
            "height": p.get("height"),
            "weight": p.get("weight"),
            "jersey": p.get("jersey"),
            "seasons": {},
        }

    print(f"Building stats for {len(player_ids)} players")

    # Fetch season averages for each requested season
    for season in seasons:
        season_avgs = fetch_season_averages_for_season(season, player_ids)

        for pid, avg in season_avgs.items():
            player_rec = players_by_id.get(pid)
            if not player_rec:
                continue
            player_rec["seasons"][str(season)] = avg

    # Convert to dict keyed by player_id as string
    out = {}
    for pid, player_rec in players_by_id.items():
        out[str(pid)] = player_rec

    return out


def main():
    current_season, prev_season = detect_seasons()
    seasons = [current_season, prev_season]

    roster = load_roster("rosters.json")

    print("Building player_stats.json from BallDontLie…")
    stats = build_player_stats(roster, seasons)

    with open("player_stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print(
        f"Done. Wrote stats for {len(stats)} players "
        f"across seasons {seasons}"
    )


if __name__ == "__main__":
    main()
