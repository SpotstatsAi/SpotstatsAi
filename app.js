// PropsParlor Frontend – Player Detail Page + Core Views
// Assumes Cloudflare Pages Functions/Workers backend with the described API.

const API_BASE = '';

const AppState = {
  today: null,
  players: [],
  playersById: new Map(),
  teams: [],
  edgesCache: {
    pts: null,
    reb: null,
    ast: null,
  },
  currentGamesDate: 'today',
  currentView: 'overview',
  currentPlayerId: null,
};

/**
 * HTTP helpers
 */
async function fetchJSON(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

/**
 * Date helpers
 */
function getTodayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToISO(iso, deltaDays) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatISOForLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * View switching
 */
function setActiveView(viewName) {
  AppState.currentView = viewName;
  document
    .querySelectorAll('.view')
    .forEach((v) => v.classList.remove('active'));
  const viewEl = document.getElementById(`view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');

  document
    .querySelectorAll('.nav-tab')
    .forEach((btn) => btn.classList.remove('active'));

  const tab = document.querySelector(`.nav-tab[data-view="${viewName}"]`);
  if (tab) tab.classList.add('active');
}

function setupNav() {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view) return;
      window.location.hash = `#${view}`;
    });
  });

  const backBtn = document.getElementById('player-detail-back');
  backBtn.addEventListener('click', () => {
    window.location.hash = '#players';
  });
}

/**
 * Router
 * Hash patterns:
 *   #overview | #games | #players | #teams | #trends
 *   #player-<playerId>
 */
function routeFromHash() {
  const hash = window.location.hash || '#overview';

  if (hash.startsWith('#player-')) {
    const idStr = hash.replace('#player-', '');
    if (idStr) {
      const playerId = idStr;
      setActiveView('player-detail');
      loadPlayerDetail(playerId).catch((err) => {
        console.error(err);
        showPlayerDetailError('Failed to load player.');
      });
      return;
    }
  }

  const view = hash.replace('#', '') || 'overview';
  if (
    ['overview', 'games', 'players', 'teams', 'trends'].includes(view)
  ) {
    setActiveView(view);
  } else {
    setActiveView('overview');
  }
}

function initRouter() {
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

/**
 * Global search (BDL)
 */
function setupGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const resultsEl = document.getElementById('global-search-results');

  let searchTimeout = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimeout);

    if (!q) {
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('visible');
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const data = await fetchJSON(`/api/bdl/players?search=${encodeURIComponent(q)}`);
        const list = Array.isArray(data) ? data : data.data || [];
        renderGlobalSearchResults(list);
      } catch (err) {
        console.error(err);
        resultsEl.innerHTML =
          '<div class="global-search-result-item">Search failed.</div>';
        resultsEl.classList.add('visible');
      }
    }, 220);
  });

  document.addEventListener('click', (evt) => {
    if (!resultsEl.contains(evt.target) && evt.target !== input) {
      resultsEl.classList.remove('visible');
    }
  });

  function renderGlobalSearchResults(players) {
    const resultsEl = document.getElementById('global-search-results');
    if (!players || players.length === 0) {
      resultsEl.innerHTML =
        '<div class="global-search-result-item">No matches.</div>';
      resultsEl.classList.add('visible');
      return;
    }

    resultsEl.innerHTML = '';
    players.slice(0, 20).forEach((p) => {
      const item = document.createElement('div');
      item.className = 'global-search-result-item';
      const team = p.team || p.team_abbreviation || '';
      const pos = p.position || p.pos || '';
      item.innerHTML = `
        <div>
          <div>${p.first_name || ''} ${p.last_name || ''}</div>
          <div class="global-search-result-meta">${team} · ${pos}</div>
        </div>
        <div class="global-search-result-meta">ID: ${p.id}</div>
      `;
      item.addEventListener('click', () => {
        resultsEl.classList.remove('visible');
        input.value = '';
        if (p.id != null) {
          navigateToPlayerDetail(String(p.id));
        }
      });
      resultsEl.appendChild(item);
    });

    resultsEl.classList.add('visible');
  }
}

/**
 * Overview
 */
async function loadOverview() {
  const todayISO = AppState.today;
  if (!todayISO) return;

  const [games, edgesPts, trending, teams] = await Promise.allSettled([
    fetchJSON(`/api/games?date=${todayISO}`),
    fetchJSON(`/api/edges?stat=pts&limit=15`),
    fetchJSON(`/api/trending?stat=pts&limit=15`),
    fetchJSON(`/api/teams`),
  ]);

  if (games.status === 'fulfilled') {
    renderOverviewGames(games.value || []);
  }

  if (edgesPts.status === 'fulfilled') {
    renderOverviewTopProps(edgesPts.value || []);
    AppState.edgesCache.pts = edgesPts.value || [];
  }

  if (trending.status === 'fulfilled') {
    renderOverviewTrending(trending.value || []);
  }

  if (teams.status === 'fulfilled') {
    renderOverviewTeamsSnapshot(teams.value || []);
  }

  // Simple Edge summary using points edges
  if (edgesPts.status === 'fulfilled') {
    renderOverviewEdgeSummary(edgesPts.value || []);
  }
}

function renderOverviewGames(games) {
  const listEl = document.getElementById('overview-games-list');
  const countEl = document.getElementById('overview-games-count');
  listEl.innerHTML = '';

  if (!Array.isArray(games) || games.length === 0) {
    listEl.textContent = 'No games scheduled.';
    countEl.textContent = '0';
    return;
  }

  countEl.textContent = games.length;

  games.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'player-detail-gamelog-row';
    const home = g.home_team || g.home || g.h || '';
    const away = g.away_team || g.away || g.a || '';
    const spread = g.spread || '';
    const total = g.total || g.ou || '';

    row.innerHTML = `
      <div class="player-detail-gamelog-date">
        ${g.time || g.tip || ''}
      </div>
      <div class="player-detail-gamelog-opp">
        ${away} @ ${home}
        <div class="player-detail-gamelog-line">
          ${spread ? `Spread: ${spread}` : ''} ${
      total ? `· Total: ${total}` : ''
    }
        </div>
      </div>
      <div class="player-detail-gamelog-statline">
        ${g.book || ''} ${g.line || ''}
      </div>
    `;

    row.addEventListener('click', () => {
      openGameModal(g);
    });

    listEl.appendChild(row);
  });
}

function renderOverviewTopProps(edges) {
  const el = document.getElementById('overview-top-props-list');
  el.innerHTML = '';

  if (!Array.isArray(edges) || edges.length === 0) {
    el.textContent = 'No edges available.';
    return;
  }

  edges.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'player-detail-stat-row';
    const playerName = e.player_name || e.player || '';
    const team = e.team || '';
    const stat = e.stat || e.market || 'PTS';
    const book = e.book || '';
    const line = e.line != null ? e.line : e.prop_line;
    const edgeVal =
      e.edge != null ? e.edge : e.ev_edge != null ? e.ev_edge : null;

    const statLabel = `${stat} ${line != null ? `@ ${line}` : ''}`;
    const edgeLabel =
      edgeVal != null ? `${edgeVal.toFixed ? edgeVal.toFixed(1) : edgeVal}%` : '';

    row.innerHTML = `
      <div class="player-detail-stat-label">
        <strong>${playerName}</strong> · ${team}
        <div class="player-detail-gamelog-line">${book} · ${statLabel}</div>
      </div>
      <div class="player-detail-stat-values">
        <span class="tag ${
          edgeVal != null && edgeVal >= 5 ? 'tag-accent' : 'tag-secondary'
        }">${edgeLabel}</span>
      </div>
    `;

    row.addEventListener('click', () => {
      if (e.player_id != null) {
        navigateToPlayerDetail(String(e.player_id));
      }
    });

    el.appendChild(row);
  });
}

function renderOverviewTrending(trending) {
  const el = document.getElementById('overview-trending-list');
  el.innerHTML = '';

  if (!Array.isArray(trending) || trending.length === 0) {
    el.textContent = 'No trending players.';
    return;
  }

  trending.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'player-detail-stat-row';
    const player = t.player_name || t.player || '';
    const stat = t.stat || t.market || 'PTS';
    const trend = t.trend || t.streak || '';
    const team = t.team || '';

    row.innerHTML = `
      <div class="player-detail-stat-label">
        <strong>${player}</strong> · ${team}
        <div class="player-detail-gamelog-line">${stat}</div>
      </div>
      <div class="player-detail-stat-values">
        <span class="tag tag-secondary">${trend}</span>
      </div>
    `;

    row.addEventListener('click', () => {
      if (t.player_id != null) {
        navigateToPlayerDetail(String(t.player_id));
      }
    });

    el.appendChild(row);
  });
}

function renderOverviewTeamsSnapshot(teamData) {
  const el = document.getElementById('overview-rosters-list');
  el.innerHTML = '';

  if (!Array.isArray(teamData) || teamData.length === 0) {
    el.textContent = 'No roster data.';
    return;
  }

  teamData.forEach((t) => {
    const team = t.team || t.abbr || t.code;
    const count = t.count || t.roster_count || 0;
    const div = document.createElement('div');
    div.className = 'player-detail-stat-row';
    div.innerHTML = `
      <div class="player-detail-stat-label">${team}</div>
      <div class="player-detail-stat-values">
        <span class="tag tag-secondary">${count}</span>
      </div>
    `;
    el.appendChild(div);
  });

  // This snapshot structure should align with the rosters.json the backend uses. :contentReference[oaicite:0]{index=0}
}

function renderOverviewEdgeSummary(edges) {
  const el = document.getElementById('overview-edge-summary-body');
  el.innerHTML = '';

  if (!Array.isArray(edges) || edges.length === 0) {
    el.textContent = 'No edge summary available.';
    return;
  }

  const top = edges.slice(0, 5);
  top.forEach((e) => {
    const div = document.createElement('div');
    div.className = 'player-detail-stat-row';
    const player = e.player_name || e.player || '';
    const stat = e.stat || 'PTS';
    const edgeVal =
      e.edge != null ? e.edge : e.ev_edge != null ? e.ev_edge : null;

    div.innerHTML = `
      <div class="player-detail-stat-label">
        <strong>${player}</strong> · ${stat}
      </div>
      <div class="player-detail-stat-values">
        <span class="tag ${
          edgeVal != null && edgeVal >= 5 ? 'tag-accent' : 'tag-secondary'
        }">
          ${edgeVal != null ? (edgeVal.toFixed ? edgeVal.toFixed(1) : edgeVal) : ''}
        </span>
      </div>
    `;

    div.addEventListener('click', () => {
      if (e.player_id != null) {
        navigateToPlayerDetail(String(e.player_id));
      }
    });

    el.appendChild(div);
  });
}

/**
 * Games tab
 */
function setupGamesToolbar() {
  const btns = document.querySelectorAll('[data-games-date]');
  btns.forEach((btn) => {
    const dateKey = btn.dataset.gamesDate;
    if (dateKey === AppState.currentGamesDate) btn.classList.add('active');

    btn.addEventListener('click', () => {
      btns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.currentGamesDate = dateKey;
      loadGames();
    });
  });
}

async function loadGames() {
  const todayISO = AppState.today;
  if (!todayISO) return;

  const targetISO =
    AppState.currentGamesDate === 'tomorrow'
      ? addDaysToISO(todayISO, 1)
      : todayISO;

  const labelEl = document.getElementById('games-date-label');
  if (labelEl) labelEl.textContent = formatISOForLabel(targetISO);

  try {
    const games = await fetchJSON(`/api/games?date=${targetISO}`);
    renderGamesList(games || []);
  } catch (err) {
    console.error(err);
    const listEl = document.getElementById('games-list');
    listEl.textContent = 'Failed to load games.';
  }
}

function renderGamesList(games) {
  const listEl = document.getElementById('games-list');
  listEl.innerHTML = '';

  if (!Array.isArray(games) || games.length === 0) {
    listEl.textContent = 'No games.';
    return;
  }

  games.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'player-detail-gamelog-row';
    const home = g.home_team || g.home || '';
    const away = g.away_team || g.away || '';
    const time = g.time || '';
    const spread = g.spread || '';
    const total = g.total || '';

    row.innerHTML = `
      <div class="player-detail-gamelog-date">${time}</div>
      <div class="player-detail-gamelog-opp">
        <strong>${away}</strong> @ <strong>${home}</strong>
        <div class="player-detail-gamelog-line">
          ${spread ? `Spread: ${spread}` : ''} ${
      total ? `· Total: ${total}` : ''
    }
        </div>
      </div>
      <div class="player-detail-gamelog-statline">${g.book || ''}</div>
    `;

    row.addEventListener('click', () => openGameModal(g));
    listEl.appendChild(row);
  });
}

/**
 * Players tab
 */
async function loadPlayers() {
  try {
    const players = await fetchJSON('/api/players');
    AppState.players = Array.isArray(players) ? players : players.data || [];
    AppState.playersById.clear();
    AppState.players.forEach((p) => {
      if (p.id != null) {
        AppState.playersById.set(String(p.id), p);
      }
    });
    renderPlayersFilters(AppState.players);
    renderPlayersTable(AppState.players);
  } catch (err) {
    console.error(err);
    const tbody = document.getElementById('players-table-body');
    tbody.innerHTML = '<tr><td colspan="6">Failed to load players.</td></tr>';
  }
}

function renderPlayersFilters(players) {
  const teamSelect = document.getElementById('players-filter-team');
  const teams = new Set();
  players.forEach((p) => {
    if (p.team) teams.add(p.team);
  });

  const sorted = Array.from(teams).sort();
  teamSelect.innerHTML = '<option value="">All</option>';
  sorted.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    teamSelect.appendChild(opt);
  });
}

function setupPlayersFilters() {
  const teamSelect = document.getElementById('players-filter-team');
  const posSelect = document.getElementById('players-filter-pos');
  const textInput = document.getElementById('players-filter-text');

  const recompute = () => {
    const team = teamSelect.value;
    const pos = posSelect.value;
    const text = textInput.value.trim().toLowerCase();

    const filtered = AppState.players.filter((p) => {
      if (team && p.team !== team) return false;
      if (pos && !(p.pos || '').includes(pos)) return false;
      if (text) {
        const full = `${p.name || ''} ${p.first_name || ''} ${
          p.last_name || ''
        }`.toLowerCase();
        if (!full.includes(text)) return false;
      }
      return true;
    });

    renderPlayersTable(filtered);
  };

  teamSelect.addEventListener('change', recompute);
  posSelect.addEventListener('change', recompute);
  textInput.addEventListener('input', recompute);
}

function renderPlayersTable(players) {
  const tbody = document.getElementById('players-table-body');
  tbody.innerHTML = '';

  if (!Array.isArray(players) || players.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6">No players.</td>';
    tbody.appendChild(tr);
    return;
  }

  players.forEach((p) => {
    const tr = document.createElement('tr');
    const name = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
    tr.innerHTML = `
      <td>${name}</td>
      <td>${p.team || ''}</td>
      <td>${p.pos || ''}</td>
      <td>${p.height || ''}</td>
      <td>${p.weight || ''}</td>
      <td>${p.jersey || ''}</td>
    `;

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      if (p.id != null) {
        navigateToPlayerDetail(String(p.id));
      } else if (p.name) {
        openPlayerModal(p);
      }
    });

    tbody.appendChild(tr);
  });
}

/**
 * Teams tab
 */
async function loadTeams() {
  try {
    const teams = await fetchJSON('/api/teams');
    const list = Array.isArray(teams) ? teams : teams.data || [];
    AppState.teams = list;
    renderTeamsTable(list);
  } catch (err) {
    console.error(err);
    const tbody = document.getElementById('teams-table-body');
    tbody.innerHTML = '<tr><td colspan="2">Failed to load teams.</td></tr>';
  }
}

function renderTeamsTable(teams) {
  const tbody = document.getElementById('teams-table-body');
  tbody.innerHTML = '';

  if (!Array.isArray(teams) || teams.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="2">No teams.</td>';
    tbody.appendChild(tr);
    return;
  }

  teams.forEach((t) => {
    const team = t.team || t.abbr || t.code;
    const count = t.count || t.roster_count || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${team}</td><td>${count}</td>`;
    tbody.appendChild(tr);
  });
}

/**
 * Trends tab
 */
function setupTrendsFilters() {
  const statSelect = document.getElementById('trends-filter-stat');
  const limitSelect = document.getElementById('trends-filter-limit');

  const load = () => {
    const stat = statSelect.value || 'pts';
    const limit = Number(limitSelect.value) || 25;
    loadTrends(stat, limit);
  };

  statSelect.addEventListener('change', load);
  limitSelect.addEventListener('change', load);
}

async function loadTrends(stat = 'pts', limit = 25) {
  try {
    const data = await fetchJSON(
      `/api/trending?stat=${encodeURIComponent(stat)}&limit=${limit}`,
    );
    const list = Array.isArray(data) ? data : data.data || [];
    renderTrendsTable(list);
  } catch (err) {
    console.error(err);
    const tbody = document.getElementById('trends-table-body');
    tbody.innerHTML = '<tr><td colspan="4">Failed to load trends.</td></tr>';
  }
}

function renderTrendsTable(list) {
  const tbody = document.getElementById('trends-table-body');
  tbody.innerHTML = '';

  if (!Array.isArray(list) || list.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">No trends.</td>';
    tbody.appendChild(tr);
    return;
  }

  list.forEach((t) => {
    const player = t.player_name || t.player || '';
    const team = t.team || '';
    const stat = t.stat || t.market || 'PTS';
    const trend = t.trend || t.streak || '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${player}</td>
      <td>${team}</td>
      <td>${stat}</td>
      <td>${trend}</td>
    `;

    tr.style.cursor = t.player_id != null ? 'pointer' : 'default';
    tr.addEventListener('click', () => {
      if (t.player_id != null) {
        navigateToPlayerDetail(String(t.player_id));
      }
    });

    tbody.appendChild(tr);
  });
}

/**
 * Player Detail page
 */

function navigateToPlayerDetail(playerId) {
  window.location.hash = `#player-${playerId}`;
}

function showPlayerDetailLoading() {
  document.getElementById('player-detail-loading').classList.remove('hidden');
  document.getElementById('player-detail-error').classList.add('hidden');
}

function hidePlayerDetailLoading() {
  document.getElementById('player-detail-loading').classList.add('hidden');
}

function showPlayerDetailError(msg) {
  const el = document.getElementById('player-detail-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/**
 * Compute averages for fields from game logs.
 * Expects numeric fields (pts, reb, ast, etc).
 */
function computeAverages(gameLogs, fields, sliceCount) {
  const subset =
    sliceCount && sliceCount > 0 ? gameLogs.slice(0, sliceCount) : gameLogs;
  const result = {};
  fields.forEach((f) => {
    let total = 0;
    let n = 0;
    subset.forEach((g) => {
      const val = Number(g[f]);
      if (!Number.isNaN(val)) {
        total += val;
        n += 1;
      }
    });
    if (n > 0) {
      result[f] = total / n;
    } else {
      result[f] = null;
    }
  });
  return result;
}

/**
 * Load and render Player Detail
 */
async function loadPlayerDetail(playerId) {
  if (!playerId) return;
  AppState.currentPlayerId = playerId;
  showPlayerDetailLoading();

  // Ensure players roster is loaded, to get meta.
  if (!AppState.players || AppState.players.length === 0) {
    try {
      const players = await fetchJSON('/api/players');
      AppState.players = Array.isArray(players) ? players : players.data || [];
      AppState.playersById.clear();
      AppState.players.forEach((p) => {
        if (p.id != null) {
          AppState.playersById.set(String(p.id), p);
        }
      });
    } catch (err) {
      console.error(err);
    }
  }

  const rosterPlayer = AppState.playersById.get(String(playerId)) || null;

  const statsPromise = fetchJSON(`/api/stats?player_id=${playerId}&last_n=82`);
  const edgesPtsPromise = fetchJSON(`/api/edges?stat=pts&limit=200`);
  const edgesRebPromise = fetchJSON(`/api/edges?stat=reb&limit=200`);
  const edgesAstPromise = fetchJSON(`/api/edges?stat=ast&limit=200`);

  const [statsRes, ptsRes, rebRes, astRes] = await Promise.allSettled([
    statsPromise,
    edgesPtsPromise,
    edgesRebPromise,
    edgesAstPromise,
  ]);

  hidePlayerDetailLoading();

  let gameLogs = [];
  if (statsRes.status === 'fulfilled') {
    gameLogs = Array.isArray(statsRes.value)
      ? statsRes.value
      : statsRes.value.data || [];
  } else {
    console.error(statsRes.reason);
    showPlayerDetailError('Failed to load game logs.');
  }

  const edgesByStat = {
    pts:
      ptsRes.status === 'fulfilled'
        ? Array.isArray(ptsRes.value)
          ? ptsRes.value
          : ptsRes.value.data || []
        : [],
    reb:
      rebRes.status === 'fulfilled'
        ? Array.isArray(rebRes.value)
          ? rebRes.value
          : rebRes.value.data || []
        : [],
    ast:
      astRes.status === 'fulfilled'
        ? Array.isArray(astRes.value)
          ? astRes.value
          : astRes.value.data || []
        : [],
  };

  renderPlayerDetailHeader(rosterPlayer, playerId);
  renderPlayerDetailSeasonSnapshot(rosterPlayer, gameLogs);
  renderPlayerDetailGameLog(gameLogs);
  renderPlayerDetailSeasonAverages(gameLogs);
  renderPlayerDetailPropPreview(rosterPlayer, playerId, edgesByStat);

  const edgeBtn = document.getElementById('player-detail-edgeboard-btn');
  edgeBtn.onclick = () => openEdgeBoardForPlayer(playerId, rosterPlayer);
}

function renderPlayerDetailHeader(player, playerId) {
  const nameEl = document.getElementById('player-detail-name');
  const metaEl = document.getElementById('player-detail-meta');
  const tagsEl = document.getElementById('player-detail-tags');

  const name =
    player?.name ||
    `${player?.first_name || ''} ${player?.last_name || ''}`.trim() ||
    `Player ${playerId}`;
  nameEl.textContent = name;

  const pieces = [];
  if (player?.team) pieces.push(player.team);
  if (player?.pos) pieces.push(player.pos);
  if (player?.height) pieces.push(player.height);
  if (player?.weight) pieces.push(`${player.weight} lb`);
  metaEl.innerHTML = pieces.map((p) => `<span>${p}</span>`).join('');

  tagsEl.innerHTML = '';

  const idTag = document.createElement('span');
  idTag.className = 'tag tag-secondary';
  idTag.textContent = `ID: ${playerId}`;
  tagsEl.appendChild(idTag);

  if (player?.jersey) {
    const jerseyTag = document.createElement('span');
    jerseyTag.className = 'tag tag-secondary';
    jerseyTag.textContent = `#${player.jersey}`;
    tagsEl.appendChild(jerseyTag);
  }
}

/**
 * Season snapshot (simple quick row summary)
 */
function renderPlayerDetailSeasonSnapshot(player, gameLogs) {
  const container = document.getElementById('player-detail-season-snapshot');
  container.innerHTML = '';

  const hasLogs = Array.isArray(gameLogs) && gameLogs.length > 0;

  const metaDiv = document.createElement('div');
  metaDiv.className = 'player-detail-stat-row';
  const team = player?.team || '';
  const pos = player?.pos || '';
  metaDiv.innerHTML = `
    <div class="player-detail-stat-label">
      Team: <strong>${team}</strong> · Pos: <strong>${pos}</strong>
    </div>
    <div class="player-detail-stat-values">
      <span class="tag tag-secondary">${hasLogs ? gameLogs.length : 0} GP</span>
    </div>
  `;
  container.appendChild(metaDiv);

  if (!hasLogs) {
    const noData = document.createElement('div');
    noData.className = 'inline-status';
    noData.textContent = 'No game logs available.';
    container.appendChild(noData);
    return;
  }

  const fields = ['pts', 'reb', 'ast'];
  const seasonAvg = computeAverages(gameLogs, fields);
  const last10Avg = computeAverages(gameLogs, fields, 10);
  const last5Avg = computeAverages(gameLogs, fields, 5);

  fields.forEach((f) => {
    const label = f.toUpperCase();
    const row = document.createElement('div');
    row.className = 'player-detail-stat-row';

    const fmt = (v) =>
      v == null || Number.isNaN(v) ? '-' : (v.toFixed ? v.toFixed(1) : v);

    row.innerHTML = `
      <div class="player-detail-stat-label">${label}</div>
      <div class="player-detail-stat-values">
        <span>Season: <strong>${fmt(seasonAvg[f])}</strong></span>
        <span>L10: <strong>${fmt(last10Avg[f])}</strong></span>
        <span>L5: <strong>${fmt(last5Avg[f])}</strong></span>
      </div>
    `;

    container.appendChild(row);
  });
}

/**
 * Game log (recent 10 games)
 */
function renderPlayerDetailGameLog(gameLogs) {
  const container = document.getElementById('player-detail-gamelog');
  container.innerHTML = '';

  if (!Array.isArray(gameLogs) || gameLogs.length === 0) {
    container.textContent = 'No game logs.';
    return;
  }

  const recent = gameLogs.slice(0, 10);
  recent.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'player-detail-gamelog-row';

    const date = g.game_date || g.date || '';
    const opp = g.opponent || g.opp || '';
    const homeAway = g.home_away || g.ha || '';
    const pts = g.pts ?? g.points;
    const reb = g.reb ?? g.rebounds;
    const ast = g.ast ?? g.assists;

    row.innerHTML = `
      <div class="player-detail-gamelog-date">${date}</div>
      <div class="player-detail-gamelog-opp">
        ${homeAway || ''} vs ${opp}
        <div class="player-detail-gamelog-line">
          Line: ${
            g.line_pts != null
              ? `PTS ${g.line_pts}`
              : g.prop_pts_line != null
              ? `PTS ${g.prop_pts_line}`
              : ''
          }
        </div>
      </div>
      <div class="player-detail-gamelog-statline">
        ${pts != null ? `P:${pts}` : ''} ${
      reb != null ? `R:${reb}` : ''
    } ${ast != null ? `A:${ast}` : ''}
      </div>
    `;

    container.appendChild(row);
  });
}

/**
 * Season averages table (Season / Last 10 / Last 5)
 */
function renderPlayerDetailSeasonAverages(gameLogs) {
  const tbody = document.getElementById(
    'player-detail-season-averages-body',
  );
  tbody.innerHTML = '';

  if (!Array.isArray(gameLogs) || gameLogs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">No game logs.</td>';
    tbody.appendChild(tr);
    return;
  }

  const fields = ['pts', 'reb', 'ast'];
  const seasonAvg = computeAverages(gameLogs, fields);
  const last10Avg = computeAverages(gameLogs, fields, 10);
  const last5Avg = computeAverages(gameLogs, fields, 5);

  const fmt = (v) =>
    v == null || Number.isNaN(v) ? '-' : (v.toFixed ? v.toFixed(1) : v);

  fields.forEach((f) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f.toUpperCase()}</td>
      <td>${fmt(seasonAvg[f])}</td>
      <td>${fmt(last10Avg[f])}</td>
      <td>${fmt(last5Avg[f])}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Prop preview (per stat: PTS / REB / AST)
 */
function filterEdgesForPlayer(edges, playerId, rosterPlayer) {
  if (!Array.isArray(edges) || edges.length === 0) return [];

  const name =
    rosterPlayer?.name ||
    `${rosterPlayer?.first_name || ''} ${
      rosterPlayer?.last_name || ''
    }`.trim();

  return edges.filter((e) => {
    if (e.player_id != null && String(e.player_id) === String(playerId)) {
      return true;
    }
    if (name) {
      const n = name.toLowerCase();
      const ep = (e.player_name || e.player || '').toLowerCase();
      if (ep === n) return true;
    }
    return false;
  });
}

function renderPlayerDetailPropPreview(player, playerId, edgesByStat) {
  const container = document.getElementById('player-detail-prop-preview');
  container.innerHTML = '';

  const stats = ['pts', 'reb', 'ast'];
  let any = false;

  stats.forEach((stat) => {
    const all = edgesByStat[stat] || [];
    const filtered = filterEdgesForPlayer(all, playerId, player)
      .slice()
      .sort((a, b) => {
        const ea =
          a.edge != null ? a.edge : a.ev_edge != null ? a.ev_edge : 0;
        const eb =
          b.edge != null ? b.edge : b.ev_edge != null ? b.ev_edge : 0;
        return Number(eb) - Number(ea);
      })
      .slice(0, 5);

    if (filtered.length === 0) return;

    any = true;
    const group = document.createElement('div');
    group.className = 'prop-preview-group';

    const header = document.createElement('div');
    header.className = 'prop-preview-header';
    header.innerHTML = `
      <div class="prop-preview-header-left">
        <span class="prop-preview-stat-label">${stat.toUpperCase()}</span>
        <span class="tag tag-secondary">${filtered.length} edges</span>
      </div>
    `;
    group.appendChild(header);

    filtered.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'prop-preview-row';

      const book = e.book || '';
      const line =
        e.line != null
          ? e.line
          : e.prop_line != null
          ? e.prop_line
          : e.market_line;
      const proj = e.proj != null ? e.proj : e.projection;
      const edgeVal =
        e.edge != null ? e.edge : e.ev_edge != null ? e.ev_edge : null;

      row.innerHTML = `
        <div>${book}</div>
        <div>${line != null ? line : '-'}</div>
        <div>${proj != null ? proj.toFixed ? proj.toFixed(1) : proj : '-'}</div>
        <div>${
          edgeVal != null
            ? edgeVal.toFixed
              ? edgeVal.toFixed(1)
              : edgeVal
            : '-'
        }%</div>
      `;

      group.appendChild(row);
    });

    container.appendChild(group);
  });

  if (!any) {
    container.textContent = 'No props currently available for this player.';
  }
}

/**
 * Edge Board modal (global, plus per-player prefilter)
 */
async function openEdgeBoardForPlayer(playerId, rosterPlayer) {
  // For now just open the full Edge Board modal and highlight the player.
  try {
    const edges = await fetchJSON(`/api/edges?stat=pts&limit=200`);
    const list = Array.isArray(edges) ? edges : edges.data || [];
    const filtered = filterEdgesForPlayer(list, playerId, rosterPlayer);
    openEdgeBoardModal(filtered.length ? filtered : list);
  } catch (err) {
    console.error(err);
    openEdgeBoardModal([]);
  }
}

function openEdgeBoardModal(edges) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('edgeboard-modal');
  overlay.classList.remove('hidden');
  modal.classList.add('active');

  const body = document.getElementById('edgeboard-modal-body');
  body.innerHTML = '';

  if (!edges || edges.length === 0) {
    body.textContent = 'No edges.';
    return;
  }

  edges.slice(0, 200).forEach((e) => {
    const div = document.createElement('div');
    div.className = 'player-detail-stat-row';
    const player = e.player_name || e.player || '';
    const team = e.team || '';
    const stat = e.stat || e.market || '';
    const book = e.book || '';
    const line =
      e.line != null
        ? e.line
        : e.prop_line != null
        ? e.prop_line
        : e.market_line;
    const edgeVal =
      e.edge != null ? e.edge : e.ev_edge != null ? e.ev_edge : null;

    div.innerHTML = `
      <div class="player-detail-stat-label">
        <strong>${player}</strong> · ${team}
        <div class="player-detail-gamelog-line">${book} · ${stat} ${
      line != null ? `@ ${line}` : ''
    }</div>
      </div>
      <div class="player-detail-stat-values">
        <span class="tag ${
          edgeVal != null && edgeVal >= 5 ? 'tag-accent' : 'tag-secondary'
        }">
          ${edgeVal != null ? (edgeVal.toFixed ? edgeVal.toFixed(1) : edgeVal) : ''}%
        </span>
      </div>
    `;

    div.addEventListener('click', () => {
      if (e.player_id != null) {
        navigateToPlayerDetail(String(e.player_id));
      }
    });

    body.appendChild(div);
  });
}

/**
 * Player modal (legacy)
 */
function openPlayerModal(player) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('player-modal');
  overlay.classList.remove('hidden');
  modal.classList.add('active');

  const titleEl = document.getElementById('player-modal-title');
  const bodyEl = document.getElementById('player-modal-body');

  const name =
    player?.name ||
    `${player?.first_name || ''} ${player?.last_name || ''}`.trim();
  titleEl.textContent = name;

  bodyEl.innerHTML = `
    <div class="player-detail-stat-row">
      <div class="player-detail-stat-label">Team</div>
      <div class="player-detail-stat-values">${player.team || ''}</div>
    </div>
    <div class="player-detail-stat-row">
      <div class="player-detail-stat-label">Pos</div>
      <div class="player-detail-stat-values">${player.pos || ''}</div>
    </div>
  `;
}

/**
 * Game modal
 */
function openGameModal(game) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('game-modal');
  overlay.classList.remove('hidden');
  modal.classList.add('active');

  const titleEl = document.getElementById('game-modal-title');
  const bodyEl = document.getElementById('game-modal-body');

  const home = game.home_team || game.home || '';
  const away = game.away_team || game.away || '';
  const time = game.time || '';

  titleEl.textContent = `${away} @ ${home}`;

  bodyEl.innerHTML = `
    <div class="player-detail-stat-row">
      <div class="player-detail-stat-label">Tip</div>
      <div class="player-detail-stat-values">${time}</div>
    </div>
    <div class="player-detail-stat-row">
      <div class="player-detail-stat-label">Spread</div>
      <div class="player-detail-stat-values">${game.spread || '-'}</div>
    </div>
    <div class="player-detail-stat-row">
      <div class="player-detail-stat-label">Total</div>
      <div class="player-detail-stat-values">${game.total || '-'}</div>
    </div>
  `;
}

/**
 * Modal close wiring
 */
function setupModals() {
  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('click', (evt) => {
    if (evt.target === overlay) {
      closeAllModals();
    }
  });

  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeAllModals());
  });
}

function closeAllModals() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  document.querySelectorAll('.modal').forEach((m) => m.classList.remove('active'));
}

/**
 * Init
 */
async function initApp() {
  AppState.today = getTodayISO();

  const todayLabel = document.getElementById('today-date');
  if (todayLabel) {
    todayLabel.textContent = formatISOForLabel(AppState.today);
  }

  setupNav();
  setupGlobalSearch();
  setupGamesToolbar();
  setupPlayersFilters();
  setupTrendsFilters();
  setupModals();
  initRouter();

  // Preload key data for snappy switching.
  try {
    await Promise.all([
      loadOverview(),
      loadGames(),
      loadPlayers(),
      loadTeams(),
      loadTrends('pts', 25),
    ]);
  } catch (err) {
    console.error('Initial load error', err);
  }
}

document.addEventListener('DOMContentLoaded', initApp);
