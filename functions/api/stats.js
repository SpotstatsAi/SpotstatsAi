// functions/api/stats.js
//
// Per-player aggregate stats endpoint backed by player_stats.json.
//
// Shape of player_stats.json (per your repo):
// {
//   "Player Name": {
//      "pts": 23.1,
//      "reb": 7.4,
//      "ast": 5.2,
//      "last5_pts": 28.3,
//      "last5_reb": 8.1,
//      "last5_ast": 6.4,
//      "games": 60,
//      "team": "LAL",
//      "season": 2025,
//      "usage": 29.4,
//      ...
//   },
//   ...
// }
//
// Usage examples:
//   /api/stats
//   /api/stats?team=LAL
//   /api/stats?player=LeBron%20James
//   /api/stats?sort=pts-desc
//   /api/stats?sort=last5_pts-desc&limit=50

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const sp = url.searchParams;

    const filters = {
      player: (sp.get("player") || "").trim(),        // match by name
      team: (sp.get("team") || "").trim().toUpperCase(),
      minGames: sp.get("min_games")
        ? parseInt(sp.get("min_games"), 10) || 0
        : 0,
      season: sp.get("season")
        ? parseInt(sp.get("season"), 10) || null
        : null,
      sort: (sp.get("sort") || "name-asc").trim(),    // name-asc | pts-desc | last5_pts-desc | usage-desc | games-desc
      limit: sp.get("limit")
        ? clampInt(sp.get("limit"), 1, 500)
        : 500,
    };

    const statsUrl = new URL("/player_stats.json", url);
    const statsRes = await fetch(statsUrl.toString(), {
      cf: { cacheTtl: 60, cacheEverything: true },
    });

    if (!statsRes.ok) {
      throw new Error(
        `Failed to load player_stats.json (HTTP ${statsRes.status})`
      );
    }

    const raw = await statsRes.json();
    const players = normalizePlayersFromMap(raw);

    let filtered = applyPlayerFilters(players, filters);
    filtered = applyPlayerSort(filtered, filters.sort);

    if (filters.limit && filtered.length > filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    const meta = buildMeta(players, filtered, filters);

    return jsonResponse(
      {
        data: filtered,
        meta,
      },
      {
        status: 200,
        headers: {
          "cache-control": "public, max-age=30",
        },
      }
    );
  } catch (err) {
    console.error("api/stats error:", err);

    return jsonResponse({ error: "Failed to load stats." }, { status: 500 });
  }
}

/* ---------- helpers ---------- */

function jsonResponse(body, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body, null, 2), { ...options, headers });
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function numberOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Convert map { "Name": { ...stats... }, ... } -> array of player objects.
function normalizePlayersFromMap(raw) {
  if (!raw || typeof raw !== "object") return [];

  const players = [];

  for (const [name, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;

    const id =
      v.player_id != null ? String(v.player_id) : name;

    const team = v.team ? String(v.team).toUpperCase() : "";

    players.push({
      id,
      name,
      team,
      season: v.season != null ? Number(v.season) : null,
      games: numberOrNull(v.games),
      pts: numberOrNull(v.pts),
      reb: numberOrNull(v.reb),
      ast: numberOrNull(v.ast),
      last5_pts: numberOrNull(v.last5_pts),
      last5_reb: numberOrNull(v.last5_reb),
      last5_ast: numberOrNull(v.last5_ast),
      usage: numberOrNull(v.usage),
      raw: v,
    });
  }

  return players;
}

function applyPlayerFilters(players, filters) {
  const { player, team, minGames, season } = filters;
  let list = players.slice();

  if (player) {
    const q = player.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(q));
  }

  if (team) {
    list = list.filter((p) => p.team === team);
  }

  if (season) {
    list = list.filter((p) => p.season === season);
  }

  if (minGames > 0) {
    list = list.filter((p) => (p.games || 0) >= minGames);
  }

  return list;
}

function applyPlayerSort(players, sortKeyRaw) {
  const sortKey = sortKeyRaw || "name-asc";
  const list = players.slice();

  const byNumeric = (field, dir = -1) => (a, b) => {
    const av = a[field] ?? -1;
    const bv = b[field] ?? -1;
    if (av === bv) return a.name.localeCompare(b.name);
    return dir * (av - bv);
  };

  switch (sortKey) {
    case "pts-desc":
      list.sort(byNumeric("pts", -1));
      break;
    case "reb-desc":
      list.sort(byNumeric("reb", -1));
      break;
    case "ast-desc":
      list.sort(byNumeric("ast", -1));
      break;
    case "last5_pts-desc":
      list.sort(byNumeric("last5_pts", -1));
      break;
    case "usage-desc":
      list.sort(byNumeric("usage", -1));
      break;
    case "games-desc":
      list.sort(byNumeric("games", -1));
      break;
    case "name-asc":
    default:
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return list;
}

function buildMeta(allPlayers, filteredPlayers, filters) {
  const teams = new Set(
    allPlayers.map((p) => p.team).filter(Boolean)
  );

  return {
    totalPlayers: allPlayers.length,
    filteredPlayers: filteredPlayers.length,
    uniqueTeams: teams.size,
    filters: {
      player: filters.player || "",
      team: filters.team || "",
      minGames: filters.minGames || 0,
      season: filters.season || null,
      sort: filters.sort || "name-asc",
      limit: filters.limit || null,
    },
    source: "player_stats.json",
  };
}
