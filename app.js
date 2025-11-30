let rostersData = {};
let scheduleData = {};
let playerStats = {};
let lastProps = [];
let currentFilter = "all";

async function loadData() {
  try {
    const [rosters, schedule, stats] = await Promise.all([
      fetch("rosters.json").then(r => r.json()),
      fetch("schedule.json").then(r => r.json()),
      fetch("player_stats.json").then(r => r.json())
    ]);

    rostersData = rosters;
    scheduleData = schedule;
    playerStats = stats;

    renderTeams();
    renderGames();
  } catch (err) {
    console.error(err);
    alert("Failed loading engine data.");
  }
}

function renderTeams() {
  const list = document.getElementById("teamsList");
  list.innerHTML = "";
  Object.keys(rostersData).forEach(team => {
    const div = document.createElement("div");
    div.className = "teamEntry";
    div.textContent = team;
    div.onclick = () => showTeamPlayers(team);
    list.appendChild(div);
  });
}

function renderGames() {
  const today = new Date().toISOString().split("T")[0];
  const games = scheduleData[today] || [];

  const list = document.getElementById("games");
  list.innerHTML = "";

  games.forEach(g => {
    const card = document.createElement("div");
    card.className = "gameCard";
    card.innerHTML = `<strong>${g.away_team} @ ${g.home_team}</strong><div>${g.time_et}</div>`;
    card.onclick = () => showGameProps(g);
    list.appendChild(card);
  });
}

function showTeamPlayers(team) {
  const panel = document.getElementById("propsOutput");
  panel.innerHTML = `<h3>${team} Roster</h3>`;
  (rostersData[team] || []).forEach(n => {
    const d = document.createElement("div");
    d.textContent = n;
    panel.appendChild(d);
  });
}

function showGameProps(game) {
  const players = [
    ...rostersData[game.away_team],
    ...rostersData[game.home_team]
  ];
  lastProps = players.map(p => buildProp(p));
  renderProps();
}

function buildProp(name) {
  const s = playerStats[name] || {};
  const score = scorePlayer(s);
  let tier = "RED";
  if (score >= 0.75) tier = "GREEN";
  else if (score >= 0.55) tier = "YELLOW";
  return { name, stats: s, tier, score };
}

function scorePlayer(s) {
  if (!s || !s.pts) return 0.45;
  let sc = 0.5;
  if (s.usage > 22) sc += 0.1;
  if (s.min > 28) sc += 0.1;
  if (s.def_rank <= 10) sc += 0.1;
  if (s.def_rank >= 20) sc -= 0.1;
  return Math.max(0, Math.min(1, sc));
}

function renderProps() {
  const panel = document.getElementById("propsOutput");
  panel.innerHTML = "";
  const template = document.getElementById("propRowTemplate");

  const filtered = lastProps.filter(p =>
    currentFilter === "all" || p.tier === currentFilter.toUpperCase()
  );

  filtered.sort((a, b) => b.score - a.score);

  filtered.forEach(p => {
    const clone = document.importNode(template.content, true);
    const s = p.stats || {};

    clone.querySelector(".propName").textContent = p.name;
    clone.querySelector(".propTeam").textContent = s.team;

    clone.querySelector(".oppLine").textContent =
      s.opponent ? `${s.team} vs ${s.opponent}` : "No game today";

    clone.querySelector(".oppRank").textContent =
      s.def_rank ? `Defense Rank: ${s.def_rank}` : "";

    clone.querySelector(".avgPts").textContent = `PTS: ${s.pts?.toFixed(1)}`;
    clone.querySelector(".avgReb").textContent = `REB: ${s.reb?.toFixed(1)}`;
    clone.querySelector(".avgAst").textContent = `AST: ${s.ast?.toFixed(1)}`;

    clone.querySelector(".usageLine").textContent =
      `USG: ${s.usage?.toFixed(1)}%`;

    clone.querySelector(".paceLine").textContent =
      `Pace: ${s.pace ?? "N/A"}`;

    clone.querySelector(".teamRecord").textContent =
      s.team_record || "N/A";

    clone.querySelector(".oppRecord").textContent =
      s.opp_record || "N/A";

    clone.querySelector(".oppStreak").textContent =
      s.opp_streak ? `Streak: ${s.opp_streak}` : "Streak: N/A";

    // Trend bars
    clone.querySelector(".trendPtsFill").style.width =
      Math.min(100, (s.pts / 40) * 100) + "%";
    clone.querySelector(".trendRebFill").style.width =
      Math.min(100, (s.reb / 15) * 100) + "%";
    clone.querySelector(".trendAstFill").style.width =
      Math.min(100, (s.ast / 12) * 100) + "%";

    // Tier color
    const tag = clone.querySelector(".tierTag");
    tag.textContent = p.tier;
    tag.classList.add("tier-" + p.tier.toLowerCase());

    panel.appendChild(clone);
  });
}

document.querySelectorAll(".filterButton").forEach(btn => {
  btn.onclick = () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll(".filterButton").forEach(b => b.classList.remove("filterActive"));
    btn.classList.add("filterActive");
    renderProps();
  };
});

document.getElementById("loadButton").onclick = loadData;
