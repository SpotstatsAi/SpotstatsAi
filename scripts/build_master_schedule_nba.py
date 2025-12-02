import os
import json
import requests
from datetime import datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

API_KEY = "SmaJtLajqgivttKKrMr5EFrNOV4dNk8BxnyM2jpj"
SPORTRADAR_URL = f"https://api.sportradar.us/nba/trial/v8/en/games/2024/REG/schedule.json?api_key={API_KEY}"


def build_internal_game_id(game_date: str, index_for_day: int) -> str:
    compact = game_date.replace("-", "")
    return f"g_{compact}_{index_for_day:03d}"


def build_master_schedule():
    resp = requests.get(SPORTRADAR_URL, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    games = data.get("games", [])
    master = []

    date_buckets = {}

    # Group games by date
    for g in games:
        scheduled = g.get("scheduled")  # e.g. "2024-10-25T23:00:00Z"
        if not scheduled:
            continue

        game_date = scheduled[:10]

        if game_date not in date_buckets:
            date_buckets[game_date] = []
        date_buckets[game_date].append(g)

    # Normalize structure
    for game_date, games_for_day in sorted(date_buckets.items()):
        for index, g in enumerate(games_for_day, start=1):
            internal_id = build_internal_game_id(game_date, index)

            home = g.get("home") or {}
            away = g.get("away") or {}

            master.append(
                {
                    "game_id": internal_id,

                    "game_date": game_date,
                    "time_et": g.get("scheduled"),

                    "home_team_abbr": home.get("alias"),
                    "away_team_abbr": away.get("alias"),

                    # SportRadar IDs
                    "sportradar_game_id": g.get("id"),
                    "sr_scheduled": g.get("scheduled"),
                    "sr_status": g.get("status"),

                    # Placeholder BDL merge fields
                    "bdl_game_id": None,
                    "status": g.get("status") or "Scheduled",
                    "home_score": None,
                    "away_score": None,
                    "bdl_payload": None,
                }
            )

    output_path = os.path.join(REPO_ROOT, "schedule_master.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2)


if __name__ == "__main__":
    build_master_schedule()
