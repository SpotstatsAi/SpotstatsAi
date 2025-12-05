// app.js
// Frontend wiring for PropsParlor dashboard.

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupGlobalSearch();
  setupPlayersView();
  setupGamesView();
  setupTeamsView();
  setupTrendsView();
  setupOverviewView();
  setupPlayerModal();
  // Ensure Overview loads on first paint
  ensureOverviewLoaded();
});

/* ---------------- NAV ---------------- */

function setupNav() {
  const tabs = document.querySelectorAll(".nav-tab");
  const views = document.querySelectorAll(".view");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.view;

      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      views.forEach((v) =>
        v.classList.toggle("active", v.id === target)
      );

      if (target === "players-view") {
        ensurePlayersLoaded();
      } else if (target === "games-view") {
        ensureGamesLoaded();
      } else if (target === "teams-view") {
        ensureTeamsLoaded();
      } else if (target === "trends-view") {
        ensureTrendsLoaded();
      } else if (target === "overview-view") {
        ensureOverviewLoaded();
      }
    });
  });

  const edgeBtn = document.getElementById("edge-board-btn");
  if (edgeBtn) {
    edgeBtn.addEventListener("click", () => {
      document
        .querySelector('.nav-tab[data-view="trends-view"]')
        .click();
    });
  }
}

function setupGlobalSearch() {
  const input = document.getElementById("global-search");
  if (!input) return;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (!q) return;
      document
        .querySelector('.nav-tab[data-view="players-view"]')
        .click();
      const playerSearch = document.getElementById("player-search");
      if (playerSearch) {
        playerSearch.value = q;
        applyPlayerFilters();
      }
    }
  });
}

/* ---------------- PLAYERS ---------------- */

let playersState = {
  loaded: false,
  allPlayers: [],
  filteredPlayers: [],
  snapshot: {
    uniqueTeams: 0,
    guards: 0,
    forwards: 0,
    centers: 0,
  },
};

function setupPlayersView() {
  const searchInput = document.getElementById("player-search");
  const teamSelect = document.getElementById("filter-team");
  const posSelect = document.getElementById("filter-position");
  const sortSelect = document.getElementById("sort-order");
  const resetBtn = document.getElementById("filters-reset");
  const clearBtn = document.getElementById("player-clear-filters");

  if (searchInput) {
    searchInput.addEventListener("input", debounce(applyPlayerFilters, 150));
  }
  if (teamSelect) {
    teamSelect.addEventListener("change", applyPlayerFilters);
  }
  if (posSelect) {
    posSelect.addEventListener("change", applyPlayerFilters);
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", applyPlayerFilters);
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (teamSelect) teamSelect.value = "";
      if (posSelect) posSelect.value = "";
      if (sortSelect) sortSelect.value = "name-asc";
      applyPlayerFilters();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (teamSelect) teamSelect.value = "";
      if (posSelect) posSelect.value = "";
      if (sortSelect) sortSelect.value = "name-asc";
      applyPlayerFilters();
    });
  }
}

function ensurePlayersLoaded() {
  if (playersState.loaded) return;
  loadPlayers();
}

async function loadPlayers() {
  setPlayerSubtitle("Loading players...");
  try {
    const res = await fetch("/api/players");
    if (!res.ok) throw new Error("Failed to load players");
    const json = await res.json();

    playersState.allPlayers = json.data || [];
    playersState.snapshot = {
      uniqueTeams: json.meta?.uniqueTeams || 0,
      guards: json.meta?.guards || 0,
      forwards: json.meta?.forwards || 0,
      centers: json.meta?.centers || 0,
    };
    playersState.loaded = true;

    populatePlayerFilters(playersState.allPlayers);
    updateSnapshot();
    applyPlayerFilters();
  } catch (err) {
    console.error(err);
    setPlayerSubtitle("Error loading players.");
  }
}

function populatePlayerFilters(players) {
  const teamSelect = document.getElementById("filter-team");
  if (!teamSelect) return;

  const teams = new Set();
  players.forEach((p) => {
    if (p.team) teams.add(p.team);
  });

  const options = ['<option value="">All teams</option>'];
  Array.from(teams)
    .sort()
    .forEach((abbr) => {
      options.push(`<option value="${escapeHtml(abbr)}">${escapeHtml(
        abbr
      )}</option>`);
    });

  teamSelect.innerHTML = options.join("");
}

function applyPlayerFilters() {
  if (!playersState.loaded) return;
  const searchInput = document.getElementById("player-search");
  const teamSelect = document.getElementById("filter-team");
  const posSelect = document.getElementById("filter-position");
  const sortSelect = document.getElementById("sort-order");

  const search = (searchInput?.value || "").trim().toLowerCase();
  const team = (teamSelect?.value || "").trim();
  const pos = (posSelect?.value || "").trim().toUpperCase();
  const sortKey = sortSelect?.value || "name-asc";

  let filtered = playersState.allPlayers.slice();

  if (search) {
    filtered = filtered.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const teamStr = (p.team || "").toLowerCase();
      const jersey = p.jersey ? String(p.jersey).toLowerCase() : "";
      return (
        name.includes(search) ||
        teamStr.includes(search) ||
        jersey.includes(search)
      );
    });
  }

  if (team) {
    filtered = filtered.filter((p) => p.team === team);
  }

  if (pos) {
    filtered = filtered.filter((p) =>
      (p.pos || "").toUpperCase().includes(pos)
    );
  }

  filtered = sortPlayersLocal(filtered, sortKey);

  playersState.filteredPlayers = filtered;
  renderPlayerGrid();
}

function sortPlayersLocal(players, sortKeyRaw) {
  const sortKey = sortKeyRaw || "name-asc";
  const list = players.slice();

  switch (sortKey) {
    case "team":
      list.sort((a, b) => {
        if (a.team === b.team) {
          return (a.last_name || a.name || "").localeCompare(
            b.last_name || b.name || ""
          );
        }
        return (a.team || "").localeCompare(b.team || "");
      });
      break;

    case "height-desc":
      list.sort((a, b) => {
        const ha = a.heightInches ?? -1;
        const hb = b.heightInches ?? -1;
        if (hb !== ha) return hb - ha;
        return (a.last_name || a.name || "").localeCompare(
          b.last_name || b.name || ""
        );
      });
      break;

    case "weight-desc":
      list.sort((a, b) => {
        const wa = a.weightNum ?? -1;
        const wb = b.weightNum ?? -1;
        if (wb !== wa) return wb - wa;
        return (a.last_name || a.name || "").localeCompare(
          b.last_name || b.name || ""
        );
      });
      break;

    case "jersey-asc":
      list.sort((a, b) => {
        const ja = parseInt(a.jersey, 10) || 0;
        const jb = parseInt(b.jersey, 10) || 0;
        if (ja !== jb) return ja - jb;
        return (a.last_name || a.name || "").localeCompare(
          b.last_name || b.name || ""
        );
      });
      break;

    case "name-asc":
    default:
      list.sort((a, b) =>
        (a.last_name || a.name || "").localeCompare(
          b.last_name || b.name || ""
        )
      );
      break;
  }

  return list;
}

function renderPlayerGrid() {
  const grid = document.getElementById("player-grid");
  const empty = document.getElementById("player-empty");
  const countEl = document.getElementById("player-count");

  if (!grid || !empty) return;

  const players = playersState.filteredPlayers || [];

  if (countEl) {
    countEl.textContent = String(players.length);
  }

  if (players.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    setPlayerSubtitle("0 Players");
    return;
  }

  empty.classList.add("hidden");
  setPlayerSubtitle(
    `${players.length} players • All teams • No game context required`
  );

  const cards = players.map((p) => renderPlayerCard(p)).join("");
  grid.innerHTML = cards;
}

function renderPlayerCard(p) {
  const name = escapeHtml(p.name || "");
  const pos = escapeHtml(p.pos || "");
  const idStr = p.id != null ? `ID ${p.id}` : "";
  const team = escapeHtml(p.team || "");
  const height = escapeHtml(p.height || "–");
  const weight = p.weight ? `${p.weight} lb` : "–";
  const jersey = p.jersey ? `#${p.jersey}` : "—";
  const id = p.id != null ? String(p.id) : "";

  return `
    <div class="player-card"
         data-player-id="${id}"
         data-player-name="${name}"
         data-player-team="${team}"
         data-player-pos="${pos}">
      <div class="player-card-header">
        <div>
          <div class="player-name">${name}</div>
          <div class="player-meta-line">
            ${pos ? `${pos}` : ""}${idStr ? ` • ${idStr}` : ""}
          </div>
          <div class="player-tagline">
            Always available • Player-only view
          </div>
        </div>
        <div class="player-badge">
          ${team || "FA"}
        </div>
      </div>
      <div class="player-body-row">
        <span>Height</span>
        <span>${height}</span>
      </div>
      <div class="player-body-row">
        <span>Weight</span>
        <span>${weight}</span>
      </div>
      <div class="player-body-row">
        <span>Jersey</span>
        <span>${jersey}</span>
      </div>
      <span class="jersey-pill">${jersey}</span>
    </div>
  `;
}

function setPlayerSubtitle(text) {
  const el = document.getElementById("player-board-subtitle");
  if (el) el.textContent = text;
}

function updateSnapshot() {
  const snap = playersState.snapshot;
  const teamsEl = document.getElementById("snapshot-teams");
  const gEl = document.getElementById("snapshot-guards");
  const fEl = document.getElementById("snapshot-forwards");
  const cEl = document.getElementById("snapshot-centers");

  if (teamsEl) teamsEl.textContent = String(snap.uniqueTeams || 0);
  if (gEl) gEl.textContent = String(snap.guards || 0);
  if (fEl) fEl.textContent = String(snap.forwards || 0);
  if (cEl) cEl.textContent = String(snap.centers || 0);
}

/* ---------------- GAMES ---------------- */

let gamesLoaded = false;

function setupGamesView() {
  const toggles = document.querySelectorAll("[data-games-range]");
  toggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      toggles.forEach((b) => b.classList.toggle("active", b === btn));
      loadGames(btn.dataset.gamesRange || "today");
    });
  });
}

function ensureGamesLoaded() {
  if (gamesLoaded) return;
  const active = document.querySelector("[data-games-range].active");
  const range = active?.dataset.gamesRange || "today";
  loadGames(range);
}

async function loadGames(range) {
  const list = document.getElementById("games-list");
  if (!list) return;
  list.innerHTML = `<p class="muted">Loading games...</p>`;

  try {
    const { dateStr } = buildDate(range);
    const res = await fetch(`/api/games?date=${dateStr}`);
    if (!res.ok) throw new Error("Failed to load games");
    const json = await res.json();
    const games = json.data || [];
    gamesLoaded = true;

    if (games.length === 0) {
      list.innerHTML = `<p class="muted">No games for ${dateStr}.</p>`;
      return;
    }

    const rows = games.map((g) => renderGameRow(g)).join("");
    list.innerHTML = `<div class="overview-list">${rows}</div>`;
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="muted">Error loading games.</p>`;
  }
}

function renderGameRow(g) {
  const home = escapeHtml(
    g.home_team_abbr ||
      g.home_team ||
      (g.home_team && g.home_team.abbreviation) ||
      "HOME"
  );
  const away = escapeHtml(
    g.away_team_abbr ||
      g.away_team ||
      (g.away_team && g.away_team.abbreviation) ||
      "AWAY"
  );
  const tip =
    g.start_time_local ||
    g.tipoff ||
    g.start_time ||
    "";
  const tipText = tip ? String(tip).slice(11, 16) : "TBD";

  return `
    <div class="overview-row">
      <div class="overview-row-main">
        <span>${away} @ ${home}</span>
        <span class="muted">Tip: ${tipText}</span>
      </div>
      <div class="overview-row-meta">
        <span class="badge-soft">Matchup</span>
      </div>
    </div>
  `;
}

/* ---------------- TEAMS ---------------- */

let teamsLoaded = false;

function setupTeamsView() {}

function ensureTeamsLoaded() {
  if (teamsLoaded) return;
  loadTeams();
}

async function loadTeams() {
  const list = document.getElementById("teams-list");
  const filterSelect = document.getElementById("teams-filter-team");
  const overviewFilter = document.getElementById("overview-teams-filter");
  if (!list) return;
  list.innerHTML = `<p class="muted">Loading teams...</p>`;

  try {
    const res = await fetch("/api/teams");
    if (!res.ok) throw new Error("Failed to load teams");
    const json = await res.json();
    const teams = json.data || [];
    teamsLoaded = true;

    if (filterSelect) {
      const opts = ['<option value="">All teams</option>'];
      teams.forEach((t) => {
        if (!t.team) return;
        opts.push(
          `<option value="${escapeHtml(t.team)}">${escapeHtml(
            t.team
          )}</option>`
        );
      });
      filterSelect.innerHTML = opts.join("");
      filterSelect.addEventListener("change", () => {
        renderTeamsList(teams, filterSelect.value || "");
      });
    }

    if (overviewFilter) {
      const opts = ['<option value="">All teams</option>'];
      teams.forEach((t) => {
        if (!t.team) return;
        opts.push(
          `<option value="${escapeHtml(t.team)}">${escapeHtml(
            t.team
          )}</option>`
        );
      });
      overviewFilter.innerHTML = opts.join("");
      overviewFilter.addEventListener("change", () => {
        renderTeamsOverview(teams, overviewFilter.value || "");
      });
    }

    renderTeamsList(teams, "");
    renderTeamsOverview(teams, "");
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="muted">Error loading teams.</p>`;
  }
}

function renderTeamsList(teams, filterTeam) {
  const list = document.getElementById("teams-list");
  if (!list) return;

  let visible = teams;
  if (filterTeam) {
    visible = teams.filter((t) => t.team === filterTeam);
  }

  if (!visible.length) {
    list.innerHTML = `<p class="muted">No teams.</p>`;
    return;
  }

  const rows = visible
    .map((t) => {
      const name = escapeHtml(t.full_name || t.name || t.team);
      const abbr = escapeHtml(t.team);
      const guards = t.counts?.guards ?? 0;
      const forwards = t.counts?.forwards ?? 0;
      const centers = t.counts?.centers ?? 0;
      const total = t.counts?.totalPlayers ?? 0;

      return `
        <div class="team-row">
          <div class="team-header">
            ${name}
            <div class="team-sub">${abbr} • ${total} players</div>
          </div>
          <div class="overview-row-meta">
            <div class="team-sub">G: ${guards} • F: ${forwards} • C: ${centers}</div>
          </div>
        </div>
      `;
    })
    .join("");

  list.innerHTML = `<div class="teams-list">${rows}</div>`;
}

function renderTeamsOverview(teams, filterTeam) {
  const el = document.getElementById("overview-teams");
  if (!el) return;

  let visible = teams;
  if (filterTeam) {
    visible = teams.filter((t) => t.team === filterTeam);
  }

  if (!visible.length) {
    el.innerHTML = `<p class="muted">No team data.</p>`;
    return;
  }

  const rows = visible
    .slice(0, 8)
    .map((t) => {
      const name = escapeHtml(t.team);
      const total = t.counts?.totalPlayers ?? 0;
      return `
        <div class="overview-row">
          <div class="overview-row-main">
            <span>${name}</span>
            <span class="muted">${total} players</span>
          </div>
        </div>
      `;
    })
    .join("");

  el.innerHTML = `<div class="overview-list">${rows}</div>`;
}

/* ---------------- TRENDS ---------------- */

let trendsLoaded = false;

function setupTrendsView() {
  const statSelect = document.getElementById("trends-stat");
  const posSelect = document.getElementById("trends-position");

  if (statSelect) {
    statSelect.addEventListener("change", () => {
      loadTrends(statSelect.value, posSelect?.value || "");
    });
  }
  if (posSelect) {
    posSelect.addEventListener("change", () => {
      loadTrends(statSelect?.value || "pts", posSelect.value);
    });
  }
}

function ensureTrendsLoaded() {
  if (trendsLoaded) return;
  const statSelect = document.getElementById("trends-stat");
  const posSelect = document.getElementById("trends-position");
  const stat = statSelect?.value || "pts";
  const pos = posSelect?.value || "";
  loadTrends(stat, pos);
}

async function loadTrends(stat, pos) {
  const list = document.getElementById("trends-list");
  if (!list) return;

  list.innerHTML = `<p class="muted">Loading trends...</p>`;

  try {
    const params = new URLSearchParams();
    params.set("stat", stat);
    if (pos) params.set("position", pos);

    const res = await fetch(`/api/trending?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load trending");
    const json = await res.json();
    const data = json.data || [];
    trendsLoaded = true;

    if (!data.length) {
      list.innerHTML = `<p class="muted">No trending players available.</p>`;
      return;
    }

    const rows = data
      .map((p) => renderTrendRow(p))
      .join("");
    list.innerHTML = `<div class="trends-list">${rows}</div>`;
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="muted">Error loading trends.</p>`;
  }
}

function renderTrendRow(p) {
  const name = escapeHtml(p.name);
  const team = escapeHtml(p.team || "");
  const pos = escapeHtml(p.pos || "");
  const stat = p.stat || "pts";
  const val = p.score != null ? p.score.toFixed(1) : "–";
  const id = p.player_id != null ? String(p.player_id) : p.id != null ? String(p.id) : "";

  return `
    <div class="trend-row"
         data-player-id="${id}"
         data-player-name="${name}"
         data-player-team="${team}"
         data-player-pos="${pos}">
      <div class="trend-main">
        <span>${name}</span>
        <span class="muted">${team}${pos ? " • " + pos : ""}</span>
      </div>
      <div class="trend-meta">
        <div>${val} ${stat.toUpperCase()}</div>
      </div>
    </div>
  `;
}

/* ---------------- OVERVIEW ---------------- */

let overviewLoaded = false;

function setupOverviewView() {
  const edgesStatSelect = document.getElementById("overview-edges-stat");
  if (edgesStatSelect) {
    edgesStatSelect.addEventListener("change", () => {
      const stat = edgesStatSelect.value || "pts";
      loadOverviewEdges(stat);
      loadOverviewEdgeBoard();
    });
  }

  const trendingStatSelect = document.getElementById("overview-trending-stat");
  if (trendingStatSelect) {
    trendingStatSelect.addEventListener("change", () => {
      loadOverviewTrending(trendingStatSelect.value || "pts");
    });
  }
}

function ensureOverviewLoaded() {
  if (overviewLoaded) return;
  loadOverview();
}

function loadOverview() {
  overviewLoaded = true;
  const edgesStatSelect = document.getElementById("overview-edges-stat");
  const trendingStatSelect = document.getElementById("overview-trending-stat");

  loadOverviewGames();
  loadOverviewEdges(edgesStatSelect?.value || "pts");
  loadOverviewTrending(trendingStatSelect?.value || "pts");
  ensureTeamsLoaded();
  loadOverviewEdgeBoard();
}

// Today's Games card in Overview
async function loadOverviewGames() {
  const body = document.getElementById("overview-games");
  const countEl = document.getElementById("overview-games-count");
  if (!body) return;
  body.innerHTML = `<p class="muted">Loading games...</p>`;

  try {
    const { dateStr } = buildDate("today");
    const res = await fetch(`/api/games?date=${dateStr}`);
    if (!res.ok) throw new Error("Failed to load games");
    const json = await res.json();
    const games = json.data || [];

    if (countEl) {
      countEl.textContent = `${games.length} games`;
    }

    if (!games.length) {
      body.innerHTML = `<p class="muted">No games for ${dateStr}.</p>`;
      return;
    }

    const rows = games.map((g) => renderGameRow(g)).join("");
    body.innerHTML = `<div class="overview-list">${rows}</div>`;
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="muted">Error loading games.</p>`;
  }
}

async function loadOverviewEdges(stat) {
  const el = document.getElementById("overview-edges");
  if (!el) return;
  el.innerHTML = `<p class="muted">Loading edge candidates...</p>`;

  try {
    const params = new URLSearchParams();
    params.set("stat", stat);
    params.set("limit", "6");
    const res = await fetch(`/api/edges?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load edges");
    const json = await res.json();
    const data = json.data || [];

    if (!data.length) {
      el.innerHTML = `<p class="muted">No edge candidates available.</p>`;
      return;
    }

    const rows = data
      .map((p) => {
        const name = escapeHtml(p.name);
        const team = escapeHtml(p.team || "");
        const pos = escapeHtml(p.pos || "");
        const delta = p.delta != null ? p.delta.toFixed(1) : "–";
        const recent = p.recent != null ? p.recent.toFixed(1) : "–";
        const season = p.seasonAvg != null ? p.seasonAvg.toFixed(1) : "–";
        const id = p.player_id != null ? String(p.player_id) : p.id != null ? String(p.id) : "";

        return `
          <div class="overview-row"
               data-player-id="${id}"
               data-player-name="${name}"
               data-player-team="${team}"
               data-player-pos="${pos}">
            <div class="overview-row-main">
              <span>${name}</span>
              <span class="muted">${team}${pos ? " • " + pos : ""}</span>
            </div>
            <div class="overview-row-meta">
              <div class="team-sub">Recent: ${recent}</div>
              <div class="team-sub">Season: ${season}</div>
              <div class="badge-soft">Δ ${delta}</div>
            </div>
          </div>
        `;
      })
      .join("");

    el.innerHTML = `<div class="overview-list">${rows}</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="muted">Error loading edge candidates.</p>`;
  }
}

async function loadOverviewTrending(stat) {
  const el = document.getElementById("overview-trending");
  if (!el) return;
  el.innerHTML = `<p class="muted">Loading trending players...</p>`;

  try {
    const params = new URLSearchParams();
    params.set("stat", stat);
    params.set("limit", "6");
    const res = await fetch(`/api/trending?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load trending");
    const json = await res.json();
    const data = json.data || [];

    if (!data.length) {
      el.innerHTML = `<p class="muted">No trending players.</p>`;
      return;
    }

    const rows = data
      .map((p) => {
        const name = escapeHtml(p.name);
        const team = escapeHtml(p.team || "");
        const pos = escapeHtml(p.pos || "");
        const score = p.score != null ? p.score.toFixed(1) : "–";
        const id = p.player_id != null ? String(p.player_id) : p.id != null ? String(p.id) : "";

        return `
          <div class="overview-row"
               data-player-id="${id}"
               data-player-name="${name}"
               data-player-team="${team}"
               data-player-pos="${pos}">
            <div class="overview-row-main">
              <span>${name}</span>
              <span class="muted">${team}${pos ? " • " + pos : ""}</span>
            </div>
            <div class="overview-row-meta">
              <div>${score} ${stat.toUpperCase()}</div>
            </div>
          </div>
        `;
      })
      .join("");

    el.innerHTML = `<div class="overview-list">${rows}</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="muted">Error loading trending players.</p>`;
  }
}

// Edge Board summary: combine top edges across PTS/REB/AST
async function loadOverviewEdgeBoard() {
  const el = document.getElementById("overview-edgeboard");
  if (!el) return;
  el.innerHTML = `<p class="muted">Loading edge board...</p>`;

  try {
    const stats = ["pts", "reb", "ast"];
    const labels = { pts: "PTS", reb: "REB", ast: "AST" };

    const promises = stats.map((s) =>
      fetch(`/api/edges?stat=${s}&limit=3`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("edges fetch failed"))
      )
    );

    const results = await Promise.allSettled(promises);
    const rows = [];

    results.forEach((res, idx) => {
      if (res.status !== "fulfilled") return;
      const stat = stats[idx];
      const data = res.value.data || [];
      data.forEach((p) => {
        rows.push({ ...p, stat });
      });
    });

    if (!rows.length) {
      el.innerHTML = `<p class="muted">No edge candidates available yet.</p>`;
      return;
    }

    rows.sort((a, b) => (b.delta || 0) - (a.delta || 0));

    const html = rows
      .map((p) => {
        const name = escapeHtml(p.name);
        const team = escapeHtml(p.team || "");
        const pos = escapeHtml(p.pos || "");
        const statLabel = labels[p.stat] || p.stat.toUpperCase();
        const recent = p.recent != null ? p.recent.toFixed(1) : "–";
        const season = p.seasonAvg != null ? p.seasonAvg.toFixed(1) : "–";
        const delta = p.delta != null ? p.delta.toFixed(1) : "–";
        const id = p.player_id != null ? String(p.player_id) : p.id != null ? String(p.id) : "";

        return `
          <div class="overview-row"
               data-player-id="${id}"
               data-player-name="${name}"
               data-player-team="${team}"
               data-player-pos="${pos}">
            <div class="overview-row-main">
              <span>${name}</span>
              <span class="muted">${team}${pos ? " • " + pos : ""}</span>
            </div>
            <div class="overview-row-meta">
              <div class="team-sub">${statLabel}</div>
              <div class="team-sub">Recent: ${recent} • Season: ${season}</div>
              <div class="badge-soft">Δ ${delta}</div>
            </div>
          </div>
        `;
      })
      .join("");

    el.innerHTML = `<div class="overview-list">${html}</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="muted">Error loading edge board.</p>`;
  }
}

/* ---------------- PLAYER MODAL ---------------- */

function setupPlayerModal() {
  const modal = document.getElementById("player-modal");
  if (!modal) return;

  const closeBtn = document.getElementById("modal-close");
  const backdrop = modal.querySelector(".modal-backdrop");

  if (closeBtn) closeBtn.addEventListener("click", closePlayerModal);
  if (backdrop) backdrop.addEventListener("click", closePlayerModal);

  // Delegate clicks from any element carrying data-player-id
  document.addEventListener("click", (evt) => {
    const target = evt.target.closest("[data-player-id]");
    if (!target) return;

    const id = target.dataset.playerId || "";
    const name = target.dataset.playerName || "";
    const team = target.dataset.playerTeam || "";
    const pos = target.dataset.playerPos || "";

    if (!id) return; // no id, nothing to fetch

    openPlayerModal({ id, name, team, pos });
  });
}

function openPlayerModal(player) {
  const modal = document.getElementById("player-modal");
  if (!modal) return;

  modal.classList.remove("hidden");

  const nameEl = document.getElementById("modal-player-name");
  const metaEl = document.getElementById("modal-player-meta");
  const summaryEl = document.getElementById("modal-summary");
  const tbody = document.getElementById("modal-stats-rows");

  if (nameEl) nameEl.textContent = player.name || "Player";
  if (metaEl) {
    const bits = [];
    if (player.team) bits.push(player.team);
    if (player.pos) bits.push(player.pos);
    if (player.id) bits.push(`ID ${player.id}`);
    metaEl.textContent = bits.join(" • ");
  }

  if (summaryEl)
    summaryEl.textContent = "Loading last games from BallDontLie...";
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted">Loading...</td></tr>';
  }

  if (!player.id) {
    if (summaryEl) summaryEl.textContent = "No player id available.";
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">No stats to display.</td></tr>';
    }
    return;
  }

  loadPlayerStats(player.id, summaryEl, tbody);
}

function closePlayerModal() {
  const modal = document.getElementById("player-modal");
  if (modal) modal.classList.add("hidden");
}

async function loadPlayerStats(playerId, summaryEl, tbody) {
  try {
    const url = `/api/stats?player_id=${encodeURIComponent(
      playerId
    )}&last_n=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("stats fetch failed");
    const json = await res.json();
    const rows = json.data || [];
    const meta = json.meta || {};

    if (!rows.length) {
      if (summaryEl)
        summaryEl.textContent =
          "No recent games found in player_stats.json.";
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="muted">No rows.</td></tr>';
      }
      return;
    }

    const lastN = meta.lastN || rows.length;
    const teamMeta = meta.team || meta.teamAbbr || "";
    if (summaryEl) {
      summaryEl.textContent = `Last ${lastN} games${
        teamMeta ? ` • ${teamMeta}` : ""
      }`;
    }

    const trHtml = rows
      .map((r) => {
        const date = r.game_date || r.date || "";
        const opp = r.opponent || r.opp || "";
        const min =
          r.min != null ? r.min : r.minutes != null ? r.minutes : "";
        const pts = r.pts != null ? r.pts : "";
        const reb = r.reb != null ? r.reb : r.reb_tot != null ? r.reb_tot : "";
        const ast = r.ast != null ? r.ast : "";

        return `<tr>
          <td class="cell-left">${escapeHtml(String(date).slice(5))}</td>
          <td class="cell-left">${escapeHtml(opp)}</td>
          <td>${escapeHtml(min)}</td>
          <td>${escapeHtml(pts)}</td>
          <td>${escapeHtml(reb)}</td>
          <td>${escapeHtml(ast)}</td>
        </tr>`;
      })
      .join("");
    if (tbody) tbody.innerHTML = trHtml;
  } catch (err) {
    console.error(err);
    if (summaryEl) summaryEl.textContent = "Error loading stats.";
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">Error loading stats.</td></tr>';
    }
  }
}

/* ---------------- UTIL ---------------- */

function buildDate(range) {
  const today = new Date();
  const targetDate = new Date(
    today.getTime() + (range === "tomorrow" ? 86400000 : 0)
  );
  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getUTCDate()).padStart(2, "0");
  return { dateStr: `${yyyy}-${mm}-${dd}` };
}

function debounce(fn, delay) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
