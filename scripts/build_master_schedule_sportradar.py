import json
import requests
from datetime import datetime
import os

# Load SportRadar key from GitHub Secrets
API_KEY = os.environ.get("SPORTRADAR_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing SPORTRADAR_API_KEY GitHub secret")

# Season year (auto-detect current)
YEAR = datetime.now().year

# REGULAR season schedule endpoint
REG_URL = f"https://api.sportradar.com/nba/trial/v8/en/games/{YEAR}/REG/schedule.json?api_key={API_KEY}"

# POSTSEASON schedule endpoint
PST_URL = f"https://api.sportradar.com/nba/trial/v8/en/games/{YEAR}/PST/schedule.json?api_key={API_KEY}"


def build_internal_game_id(game_date: str, index_for_day: int) -> str:
    """Stable internal ID format → g_YYYYMMDD_001"""
    compact = game_date.replace("-", "")
    return f"g_{compact}_{index_for_day:03d}"


def fetch_schedule(url):
    """Requests wrapper with error handling"""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("games", [])


def normalize_games(raw_games):
    """Convert Sportradar games into our internal structure"""

    normalized = []
    last_date = None
    index_for_day = 0

    for g in raw_games:
        raw_date = g.get("scheduled", "")
        game_date = raw_date[:10] if raw_date else None
        if not game_date:
            continue

        # Reset daily counter
        if game_date != last_date:
            last_date = game_date
            index_for_day = 0

        index_for_day += 1

        home = g.get("home", {}) or {}
        away = g.get("away", {}) or {}

        home_abbr = home.get("alias")
        away_abbr = away.get("alias")

        internal_id = build_internal_game_id(game_date, index_for_day)

        normalized.append({
            "internal_id": internal_id,

            # Sportradar info
            "sr_game_id": g.get("id"),

            # Base info
            "game_date": game_date,
            "time_et": "TBD",
            "status": "Scheduled",

            # Home
            "home_team_abbr": home_abbr,
            "home_team_name": home.get("name"),
            "sr_home_id": home.get("id"),

            # Away
            "away_team_abbr": away_abbr,
            "away_team_name": away.get("name"),
            "sr_away_id": away.get("id"),

            # Raw source
            "raw_sportradar": g
        })

    return normalized


def build_master_schedule():
    print("Fetching Regular Season...")
    reg_games = fetch_schedule(REG_URL)

    print("Fetching Postseason...")
    pst_games = fetch_schedule(PST_URL)

    print("Normalizing...")
    reg_norm = normalize_games(reg_games)
    pst_norm = normalize_games(pst_games)

    full = reg_norm + pst_norm

    print(f"Total games loaded: {len(full)}")

    # Write output
    with open("schedule_master.json", "w", encoding="utf-8") as f:
        json.dump(full, f, indent=2)

    print("schedule_master.json written successfully.")


if __name__ == "__main__":
    build_master_schedule()
