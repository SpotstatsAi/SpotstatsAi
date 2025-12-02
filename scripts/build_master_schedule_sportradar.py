import json
import requests
from datetime import datetime

# Your Sportradar trial endpoint
# Example:
# https://api.sportradar.com/nba/trial/v8/en/games/{year}/REG/schedule.json?api_key=XXXX
BASE_URL = "https://api.sportradar.com/nba/trial/v8/en/games/{year}/REG/schedule.json?api_key={key}"

# Load API key from GitHub secrets (Actions)
import os
API_KEY = os.environ.get("SPORTRADAR_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing SPORTRADAR_API_KEY GitHub secret")


def build_internal_game_id(game_date: str, index_for_day: int) -> str:
    """Stable internal ID: g_YYYYMMDD_001"""
    compact = game_date.replace("-", "")
    return f"g_{compact}_{index_for_day:03d}"


def build_master_schedule():
    """Pull full-season schedule from Sportradar and write schedule_master.json"""

    # Determine season year
    year = datetime.now().year

    url = BASE_URL.format(year=year, key=API_KEY)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()

    data = resp.json()

    # Depending on Sportradar structure:
    # games list is usually under data["games"]
    games = data.get("games", [])

    master = []
    last_date = None
    index_for_day = 0

    for g in games:
        # Example fields from Sportradar
        # g["scheduled"] → "2025-12-01T00:00:00Z"
        raw_date = g.get("scheduled", "")
        game_date = raw_date[:10] if raw_date else None

        if not game_date:
            continue

        # Reset index when date changes
        if game_date != last_date:
            last_date = game_date
            index_for_day = 0

        index_for_day += 1

        home = g.get("home", {})
        away = g.get("away", {})

        home_abbr = home.get("alias")
        away_abbr = away.get("alias")

        internal_id = build_internal_game_id(game_date, index_for_day)

        master.append({
            "internal_id": internal_id,
            "sr_game_id": g.get("id"),
            "game_date": game_date,
            "time_et": "TBD",
            "status": "Scheduled",

            "home_team_abbr": home_abbr,
            "home_team_name": home.get("name"),
            "sr_home_id": home.get("id"),

            "away_team_abbr": away_abbr,
            "away_team_name": away.get("name"),
            "sr_away_id": away.get("id"),

            "raw_sportradar": g,
        })

    with open("schedule_master.json", "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2)

    print(f"Written schedule_master.json with {len(master)} games.")


if __name__ == "__main__":
    build_master_schedule()
