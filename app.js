function formatISO(date) {
  return date.toISOString().split("T")[0];
}

function getDateOffsets(centerDate, daysBack, daysForward) {
  const result = [];
  for (let i = -daysBack; i <= daysForward; i++) {
    const d = new Date(centerDate);
    d.setDate(d.getDate() + i);
    result.push(d);
  }
  return result;
}

function labelForDate(date, today) {
  const iso = formatISO(date);
  const todayIso = formatISO(today);

  if (iso === todayIso) return "Today";

  const diffMs = date.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays === -1) return "Yesterday";
  if (diffDays === 1) return "Tomorrow";

  const opts = { weekday: "short" };
  return date.toLocaleDateString(undefined, opts);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (${res.status})`);
  }
  return res.json();
}

function renderDateTabs(dates, todayIso, selectedIso, onSelect) {
  const container = document.getElementById("date-tabs");
  container.innerHTML = "";

  const today = new Date(todayIso);

  dates.forEach((d) => {
    const iso = formatISO(d);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pp-date-pill";
    if (iso === selectedIso) pill.classList.add("pp-date-active");

    const label = labelForDate(new Date(iso), today);
    pill.textContent = `${label} · ${iso}`;

    pill.addEventListener("click", () => onSelect(iso));

    container.appendChild(pill);
  });
}

function renderGamesList(games) {
  const container = document.getElementById("games-today");
  container.innerHTML = "";

  if (!games.length) {
    container.innerHTML = `<div class="pp-empty">No games scheduled for this date.</div>`;
    return;
  }

  games.forEach((g) => {
    const card = document.createElement("div");
    card.className = "pp-card pp-card-clickable";

    const tipTime = g.time_et || "TBA";
    const status = g.status || "Scheduled";

    card.innerHTML = `
      <div class="pp-game-row">
        <div class="pp-game-main">
          <div class="pp-game-teams">
            ${g.away_team_abbr} @ ${g.home_team_abbr}
          </div>
          <div class="pp-game-extra">
            ${g.away_team_name} @ ${g.home_team_name}
          </div>
        </div>
        <div class="pp-game-side">
          <div class="pp-tag">${status}</div>
          <div class="pp-game-extra" style="text-align:right;margin-top:4px;">
            Tip: ${tipTime}
          </div>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      renderGameDetails(g);
    });

    container.appendChild(card);
  });
}

function renderGameDetails(game) {
  const panel = document.getElementById("game-details");

  panel.innerHTML = `
    <h3 style="margin-top:0;margin-bottom:0.35rem;">
      ${game.away_team_name} @ ${game.home_team_name}
    </h3>
    <p class="pp-game-extra" style="margin-top:0;margin-bottom:0.75rem;">
      Game ID: ${game.game_id} · ${game.game_date} · ${game.time_et || "TBA"} · Status: ${
    game.status || "Scheduled"
  }
    </p>

    <div class="pp-empty">
      Matchup + prop engine hooks will attach here:
      pace, usage, injuries, travel, and green/yellow/red prop flags.
    </div>
  `;
}

async function loadGamesForDate(dateIso) {
  const container = document.getElementById("games-today");
  container.innerHTML = `<div class="pp-empty">Loading games for ${dateIso}…</div>`;

  const url = `/api/games/date/${dateIso}`;
  const games = await fetchJson(url);
  renderGamesList(games);
}

async function init() {
  const today = new Date();
  const todayIso = formatISO(today);

  const dates = getDateOffsets(today, 3, 3);
  let selectedIso = todayIso;

  renderDateTabs(dates, todayIso, selectedIso, async (iso) => {
    selectedIso = iso;
    renderDateTabs(dates, todayIso, selectedIso, () => {});
    await loadGamesForDate(selectedIso);
  });

  await loadGamesForDate(selectedIso);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    const container = document.getElementById("games-today");
    container.innerHTML = `<div class="pp-empty">Error: ${err.message}</div>`;
  });
});
