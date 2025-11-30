/* ============================================================
   GLOBAL STATE
============================================================ */
let rostersData = {};
let scheduleData = {};
let playerStats = {};
let lastProps = [];
let currentFilter = "all";
let viewMode = "expanded"; // expanded | compact

document.body.classList.add("expandedMode");

/* ============================================================
   VIEW MODE TOGGLE (Compact / Expanded)
============================================================ */
document.querySelectorAll(".toggleButton").forEach(btn => {
  btn.addEventListener("click", () => {
    viewMode = btn.dataset.mode;

    // Update button appearance
    document.querySelectorAll(".toggleButton")
      .forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // Apply correct body class
    if (viewMode === "compact") {
      document.body.classList.remove("expandedMode");
      document.body.classList.add("compactMode");
    } else {
      document.body.classList.remove("compactMode");
      document.body.classList.add("expandedMode");
    }

    renderProps(); // re-render with new layout
  });
});


/* ============================================================
   LOAD DATA
============================================================ */
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

document.getElementById("loadButton").onclick = loadData;


/* ============================================================
   RENDER TEAMS
============================================================ */
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


/* ============================================================
   RENDER TODAY’S GAMES
============================================================ */
function renderGames() {
  const gamesDiv = document.getElementById("games");
  gamesDiv.innerHTML = "";

  const today = new Date().toISOString().split("T")[0];
  const games = scheduleData[today] || [];

  if (!games.length) {
    gamesDiv.innerHTML = "<p>No games today</p>";
    return;
  }

  games.forEach(game => {
    const card = document.createElement("div");
    card.className = "gameCard";
    card.innerHTML = `
      <strong>${game.away_team} @ ${game.home_team}</strong>
      <div>${game.time_et}</div>
    `;
    card.onclick = () => showGameProps(game);
    gamesDiv.appendChild(card);
  });
}


/* ============================================================
   TEAM CLICK → SHOW ROSTER
============================================================ */
function showTeamPlayers(team) {
  const panel = document.getElementById("propsOutput");
  panel.innerHTML = `<h3>${team} Roster</h3>`;

  (rostersData[team] || []).forEach(name => {
    const div = document.createElement("div");
    div.textContent = name;
    div.className = "propCard smallCard";
    panel.appendChild(div);
  });

  lastProps = [];
}


/* ============================================================
   GAME CLICK → BUILD PLAYER PROPS
============================================================ */
function showGameProps(game) {
  const awayPlayers = rostersData[game.away_team] || [];
  const homePlayers = rostersData[game.home_team] || [];

  const entries = [];
  awayPlayers.forEach(n => entries.push(buildProp(n)));
  homePlayers.forEach(n => entries.push(buildProp(n)));

  lastProps = entries;
  renderProps();
}


/* ============================================================
   BUILD A SINGLE PLAYER PROP OBJECT
============================================================ */
function buildProp(name) {
  const stats = playerStats[name] || {};
  const score = scorePlayer(stats);

  let tier = "RED";
  if (score >= 0.75) tier = "GREEN";
  else if (score >= 0.55) tier = "YELLOW";

  return { name, stats, tier, score };
}


/* ============================================================
   SCORING ALGORITHM
============================================================ */
function scorePlayer(s) {
  if (!s || !s.pts) return 0.45;

  let sc = 0.5;

  if (s.usage > 22) sc += 0.1;
  if (s.min > 28) sc += 0.1;
  if (s.def_rank && s.def_rank <= 10) sc += 0.1;
  if (s.def_rank && s.def_rank >= 20) sc -= 0.1;

  return Math.max(0, Math.min(1, sc));
}


/* ============================================================
   RENDER PLAYER PROP CARDS
============================================================ */
function renderProps() {
  const panel = document.getElementById("propsOutput");
  const template = document.getElementById("propRowTemplate");

  panel.innerHTML = "";

  if (!template) return;

  const filtered = lastProps.filter(p => {
    if (currentFilter === "all") return true;
    return p.tier === currentFilter.toUpperCase();
  });

  filtered.sort((a, b) => b.score - a.score);

  filtered.forEach(p => {
    const clone = document.importNode(template.content, true);
    const s = p.stats || {};

    /* ------------ HEADER ------------ */
    clone.querySelector(".propName").textContent = p.name;
    clone.querySelector(".propTeam").textContent = s.team || "";

    /* ------------ OPPONENT INFO ------------ */
    clone.querySelector(".oppLine").textContent =
      s.opponent ? `${s.team} vs ${s.opponent}` : "No game today";

    clone.querySelector(".oppRank").textContent =
      s.def_rank ? `Defense Rank: ${s.def_rank}` : "";

    /* ------------ SEASON AVERAGES ------------ */
    const pts = s.pts ?? 0;
    const reb = s.reb ?? 0;
    const ast = s.ast ?? 0;

    clone.querySelectorAll(".avgPts").forEach(el => el.textContent = `PTS: ${pts.toFixed(1)}`);
    clone.querySelectorAll(".avgReb").forEach(el => el.textContent = `REB: ${reb.toFixed(1)}`);
    clone.querySelectorAll(".avgAst").forEach(el => el.textContent = `AST: ${ast.toFixed(1)}`);

    /* ------------ ADVANCED ------------ */
    clone.querySelector(".usageLine").textContent =
      `Usage: ${s.usage?.toFixed(1) || 0}%`;

    clone.querySelector(".paceLine").textContent =
      `Pace: ${s.pace ?? "N/A"}`;

    /* ------------ RECORDS ------------ */
    clone.querySelector(".teamRecord").textContent =
      s.team_record || "N/A";

    clone.querySelector(".oppRecord").textContent =
      s.opp_record || "N/A";

    clone.querySelector(".oppStreak").textContent =
      s.opp_streak ? `Streak: ${s.opp_streak}` : "Streak: N/A";

    /* ------------ TREND BARS ------------ */
    const ptsPct = Math.min(100, (pts / 40) * 100);
    const rebPct = Math.min(100, (reb / 15) * 100);
    const astPct = Math.min(100, (ast / 12) * 100);

    clone.querySelector(".trendPtsFill").style.width = ptsPct + "%";
    clone.querySelector(".trendRebFill").style.width = rebPct + "%";
    clone.querySelector(".trendAstFill").style.width = astPct + "%";

    /* ------------ TIER TAG ------------ */
    const tag = clone.querySelector(".tierTag");
    tag.textContent = p.tier;
    tag.classList.add(`tier-${p.tier.toLowerCase()}`);

    panel.appendChild(clone);
  });
}


/* ============================================================
   FILTER LOGIC
============================================================ */
document.querySelectorAll(".filterButton").forEach(btn => {
  btn.onclick = () => {
    currentFilter = btn.dataset.filter;

    document
      .querySelectorAll(".filterButton")
      .forEach(b => b.classList.remove("filterActive"));

    btn.classList.add("filterActive");
    renderProps();
  };
});
