// functions/api/edges.js
//
// Edge candidates from player_stats.json (aggregate per-player file).
//
// Edge score = recentStat - seasonStat, where:
//   recentStat = last5_* field
//   seasonStat = base field (pts, reb, ast)
//
// For stat=pts:  delta = last5_pts - pts
// For stat=reb:  delta = last5_reb - reb
// For stat=ast:  delta = last5_ast - ast
//
// Usage examples:
//   /api/edges
//   /api/edges?stat=pts&limit=40
//   /api/edges?team=LAL
//   /api/edges?position=G

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const sp = url.searchParams;

    const stat = (sp.get("stat") || "pts").toLowerCase(); // pts | reb | ast
    const limit = sp.get("limit")
      ? clampInt(sp.get("limit"), 1, 200)
      : 50;
    const minGames = sp.get("min_games")
      ? clampInt(sp.get("min_games"), 1, 82)
      : 5;

    const teamFilter = (sp.get("team") || "").trim().toUpperCase();
    const posFilter = (sp.get("position") || "").trim().toUpperCase();

    // Load stats
    const statsUrl = new URL("/player_stats.json", url);
    const statsRes = await fetch(statsUrl.toString(), {
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!statsRes.ok) {
      throw new Error(
        `Failed to load player_stats.json (HTTP ${statsRes.status})`
      );
    }
    const statsRaw = await statsRes.json();
    const players = normalizePlayersFromMap(statsRaw);

    // Load rosters for team/pos filters
    const rosters = await loadRosters(url);
    const rosterIndex = buildRosterIndex(rosters);

    const edges = [];

    for (const p of players) {
      if ((p.games || 0) < minGames) continue;

      const roster = rosterIndex.get(p.id) || rosterIndex.get(p.name) || null;
      const team = roster ? roster.team : p.team;
      const pos = roster ? roster.pos : null;

      if (teamFilter && team !== teamFilter) continue;
      if (
        posFilter &&
        (!pos || !pos.toUpperCase().includes(posFilter))
      )
        continue;

      const { recent, season } = getStatPair(p, stat);
      if (recent == null || season == null) continue;

      const delta = recent - season;
      if (!(delta > 0)) continue;

      edges.push({
        playerId: p.id,
        name: p.name,
        team,
        pos,
        stat,
        games: p.games,
        season: p.season,
        recent,
        seasonAvg: season,
        delta,
        pts: p.pts,
        reb: p.reb,
        ast: p.ast,
        last5_pts: p.last5_pts,
        last5_reb: p.last5_reb,
        last5_ast: p.last5_ast,
        usage: p.usage,
      });
    }

    edges.sort((a, b) => b.delta - a.delta);

    const limited = edges.slice(0, limit);

    const meta = {
      totalPlayers: players.length,
      edgePlayers: limited.length,
      stat,
      limit,
      minGames,
      filters: {
        team: teamFilter || "",
        position: posFilter || "",
      },
      source: "player_stats.json",
    };

    return jsonResponse(
      {
        data: limited,
        meta,
      },
      {
        status: 200,
        headers: { "cache-control": "public, max-age=30" },
      }
    );
  } catch (err) {
    console.error("api/edges error:", err);

    return jsonResponse(
      { error: "Failed to compute edge players." },
      { status: 500 }
    );
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

function getStatPair(p, stat) {
  switch (stat) {
    case "reb":
      return { recent: p.last5_reb, season: p.reb };
    case "ast":
      return { recent: p.last5_ast, season: p.ast };
    case "pts":
    default:
      return { recent: p.last5_pts, season: p.pts };
  }
}

async function loadRosters(baseUrl) {
  try {
    const rosterUrl = new URL("/rosters.json", baseUrl);
    const res = await fetch(rosterUrl.toString(), {
      cf: { cacheTtl: 120, cacheEverything: true },
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function buildRosterIndex(rosters) {
  const idx = new Map();
  rosters.forEach((p) => {
    const id =
      p.id != null ? String(p.id) :
      p.player_id != null ? String(p.player_id) :
      null;
    const name = p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
    const team =
      p.team ||
      p.team_abbr ||
      (p.team && p.team.abbreviation) ||
      "";
    const pos = p.pos || p.position || "";
    if (id) {
      idx.set(id, {
        team: team ? String(team).toUpperCase() : "",
        pos,
      });
    }
    if (name) {
      idx.set(name, {
        team: team ? String(team).toUpperCase() : "",
        pos,
      });
    }
  });
  return idx;
}
