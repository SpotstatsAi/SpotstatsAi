let rostersData = {};
let scheduleData = {};
let playerStats = {};
let lastProps = [];
let currentFilter = "all";

async function loadData() {
  try {
    const rostersURL = "https://spotstatsai.github.io/SpotstatsAi/rosters.json";
    const scheduleURL = "https://spotstatsai.github.io/SpotstatsAi/schedule.json";
    const statsURL   = "https://spotstatsai.github.io/SpotstatsAi/player_stats.json";

    const [rosters, schedule] = await Promise.all([
      fetch(rostersURL).then(r => r.json()),
      fetch(scheduleURL).then(r => r.json())
    ]);

    rostersData = rosters;
    scheduleData = schedule;

    try {
      playerStats = await fetch(statsURL).then(r => r.json());
    } catch {
      playerStats = {};
    }

    renderTeams();
    renderGames();
  } catch (err) {
    console.error(err);
    alert("Failed loading Spotstats Bible.");
  }
}

function renderTeams() {
  const container = document.getElementById("teamsList");
  container.innerHTML = "";

  Object.keys(rostersData).forEach(team => {
    const div = document.createElement("div");
    div.className = "teamEntry";
    div.textContent = team;
    div.onclick = () => showTeamPlayers(team);
    container.appendChild(div);
  });
}

function renderGames() {
  const gamesDiv = document.getElementById("games");
  gamesDiv.innerHTML = "";

  const games = (scheduleData && scheduleData.today) || [];

  if (!games.length) {
    gamesDiv.innerHTML = "<p>No games in schedule.today</p>";
    return;
  }

  games.forEach(game => {
    const card = document.createElement("div");
    card.className = "gameCard";

    card.innerHTML = `
      <strong>${game.away} @ ${game.home}</strong><br>
      <span>${game.time || ""}</span>
    `;

    card.onclick = () => showGameProps(game);
    gamesDiv.appendChild(card);
  });
}

function showTeamPlayers(team) {
  const panel = document.getElementById("propsOutput");
  const players = rostersData[team] || [];

  panel.innerHTML = `<h3>${team} Roster</h3>`;

  players.forEach(name => {
    panel.innerHTML += `<div class="propRow"><span>${name}</span></div>`;
  });

  lastProps = [];
}

function showGameProps(game) {
  const away = game.away;
  const home = game.home;

  const awayPlayers = rostersData[away] || [];
  const homePlayers = rostersData[home] || [];

  const entries = [];

  awayPlayers.forEach(name => {
    entries.push(buildPropEntry(name, away));
  });

  homePlayers.forEach(name => {
    entries.push(buildPropEntry(name, home));
  });

  lastProps = entries;
  renderProps();
}

function buildPropEntry(name, team) {
  const stats = playerStats[name] || null;
  const score = computeScore(name, stats);

  let tier, cssClass;
  if (score >= 0.75) {
    tier = "GREEN";
    cssClass = "propGreen";
  } else if (score >= 0.55) {
    tier = "YELLOW";
    cssClass = "propYellow";
  } else {
    tier = "RED";
    cssClass = "propRed";
  }

  return {
    name,
    team,
    score,
    tier,
    cssClass,
    statsSummary: stats ? summarizeStats(stats) : "No stats found"
  };
}

function computeScore(name, stats) {
  if (!stats) {
    const base = name.charCodeAt(0) + name.charCodeAt(name.length - 1);
    return [0.8, 0.6, 0.45][base % 3];
  }

  let score = 0.5;
  if (stats.min >= 30) score += 0.1;
  if (stats.usage >= 25) score += 0.15;
  if (stats.games >= 20) score += 0.05;
  if (stats.fg3a >= 5) score += 0.05;
  if (stats.pts >= 20) score += 0.05;

  return Math.min(1, Math.max(0, score));
}

function summarizeStats(stats) {
  return [
    `Min: ${stats.min}`,
    `USG: ${stats.usage}`,
    `Pts: ${stats.pts}`,
  ].join(" · ");
}

function renderProps() {
  const panel = document.getElementById("propsOutput");
  panel.innerHTML = "";

  const filtered = lastProps.filter(p => {
    if (currentFilter === "all") return true;
    return p.tier.toLowerCase() === currentFilter;
  });

  if (!filtered.length) {
    panel.innerHTML = "<p>No results.</p>";
    return;
  }

  filtered
    .sort((a, b) => b.score - a.score)
    .forEach(p => {
      const row = document.createElement("div");
      row.className = "propRow";

      row.innerHTML = `
        <span><span class="${p.cssClass}">${p.tier}</span> &nbsp; ${p.name} (${p.team})</span>
        <span class="propMeta">${p.statsSummary}</span>
      `;

      panel.appendChild(row);
    });
}

document.getElementById("loadButton").onclick = loadData;

document.querySelectorAll(".filterButton").forEach(btn => {
  btn.onclick = () => {
    document
      .querySelectorAll(".filterButton")
      .forEach(b => b.classList.remove("filterActive"));

    btn.classList.add("filterActive");
    currentFilter = btn.getAttribute("data-filter");
    renderProps();
  };
});
