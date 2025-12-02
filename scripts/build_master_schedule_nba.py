import os
import json
import requests

NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_internal_game_id(game_date: str, index_for_day: int) -> str:
    compact = game_date.replace("-", "")
    return f"g_{compact}_{index_for_day:03d}"


def build_master_schedule():
    resp = requests.get(NBA_SCHEDULE_URL, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    game_dates = (
        data.get("leagueSchedule", {})
        .get("gameDates", [])
    )

    master = []

    for gd in game_dates:
        game_date = gd.get("gameDate")
        if not game_date:
            raw_date = gd.get("gameDateEst") or gd.get("gameDateUTC")
            if raw_date:
                game_date = raw_date[:10]

        if not game_date:
            continue

        games = gd.get("games", [])
        index_for_day = 0

        for g in games:
            index_for_day += 1

            nba_game_id = g.get("gameId")

            home_team = g.get("homeTeam", {}) or {}
            away_team = g.get("awayTeam", {}) or {}

            home_abbr = home_team.get("teamTricode")
            away_abbr = away_team.get("teamTricode")

            time_et = g.get("gameTimeET") or "TBD"

            status = "Scheduled"
            game_status = g.get("gameStatusText") or g.get("gameStatus")
            if isinstance(game_status, dict):
                status = game_status.get("gameStatusText") or status
            elif isinstance(game_status, str):
                status = game_status

            internal_id = build_internal_game_id(game_date, index_for_day)

            master.append(
                {
                    "game_id": internal_id,

                    "game_date": game_date,
                    "time_et": time_et,

                    "home_team_abbr": home_abbr,
                    "away_team_abbr": away_abbr,

                    "nba_game_id": nba_game_id,
                    "bdl_game_id": None,

                    "status": status,
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
