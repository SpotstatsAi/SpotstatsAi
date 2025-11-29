/* ==========================================================
   GLOBAL STATE
========================================================== */

let rostersData = {};
let scheduleData = {};
let playerStats = {};
let lastProps = [];
let currentFilter = "all";

/* ==========================================================
   LOAD ROSTERS + STATS
========================================================== */

async function loadData() {
    try {
        const rostersURL = "rosters.json";
        const scheduleURL = "schedule.json";
        const statsURL   = "player_stats.json";

        const [rosters, schedule] = await Promise.all([
            fetch(rostersURL).then(r => r.json()),
            fetch(scheduleURL).then(r => r.json())
        ]);

        rostersData = rosters;
        scheduleData = schedule;

        try {
            playerStats = await fetch(statsURL).then(r => r.json());
            console.log("[ENGINE] player_stats.json loaded");
        } catch (e) {
            playerStats = {};
            console.warn("[ENGINE] No player_stats.json yet – using placeholder scoring.");
        }

        renderTeams();
        renderGames();  // now replaced with auto-today schedule
    } catch (err) {
        console.error(err);
        alert("Failed to load data.");
    }
}

/* ==========================================================
   TEAMS PANEL
========================================================== */

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

function showTeamPlayers(team) {
    const panel = document.getElementById("propsOutput");
    const players = rostersData[team] || [];

    panel.innerHTML = `<h3>${team} Roster</h3>`;

    players.forEach(name => {
        panel.innerHTML += `<div class="propRow"><span>${name}</span></div>`;
    });

    lastProps = [];
}

/* ==========================================================
   SCHEDULE — *AUTO SELECT TODAY*
========================================================== */

async function loadSchedule() {
    // scheduleData already loaded by loadData()
    const today = new Date().toISOString().split("T")[0];

    const games = scheduleData[today] || [];

    const gamesDiv = document.getElementById("games");
    gamesDiv.innerHTML = "";

    if (!games.length) {
        gamesDiv.innerHTML = `<p>No games scheduled for ${today}</p>`;
        return;
    }

    games.forEach(g => {
        const card = document.createElement("div");
        card.className = "gameCard";

        // your JSON fields:
        // away_team, home_team, time_et
        card.innerHTML = `
            <strong>${g.away_team} @ ${g.home_team}</strong><br>
            <span>${g.time_et}</span>
        `;

        card.onclick = () => showGameProps(g);
        gamesDiv.appendChild(card);
    });
}

/* ==========================================================
   REPLACE OLD renderGames() WITH THIS
========================================================== */

function renderGames() {
    loadSchedule();  // always loads today's games
}

/* ==========================================================
   PROP ENGINE
========================================================== */

function showGameProps(game) {
    const awayTeam = game.away_team;
    const homeTeam = game.home_team;

    const awayPlayers = rostersData[awayTeam] || [];
    const homePlayers = rostersData[homeTeam] || [];

    const allEntries = [];

    awayPlayers.forEach(name => {
        allEntries.push(buildPropEntry(name, awayTeam, "away"));
    });

    homePlayers.forEach(name => {
        allEntries.push(buildPropEntry(name, homeTeam, "home"));
    });

    lastProps = allEntries;
    renderProps();
}

function buildPropEntry(name, team, side) {
    const stats = playerStats[name] || null;
    const score = scorePlayer(name, stats);

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
        side,
        score,
        tier,
        cssClass,
        statsSummary: stats ? summarizeStats(stats) : "No stats – placeholder"
    };
}

function scorePlayer(name, stats) {
    if (!stats) {
        const code = name.charCodeAt(0) + name.charCodeAt(name.length - 1);
        const mod = code % 3;
        if (mod === 0) return 0.8;
        if (mod === 1) return 0.6;
        return 0.45;
    }

    let score = 0.5;

    if (stats.min >= 30) score += 0.1;
    if (stats.usage >= 25) score += 0.15;
    if (stats.hitRate && stats.hitRate >= 0.6) score += 0.1;
    if (stats.backToBack) score -= 0.1;

    return Math.max(0, Math.min(score, 1));
}

function summarizeStats(stats) {
    const parts = [];
    if (stats.min) parts.push(`Min: ${stats.min}`);
    if (stats.usage) parts.push(`USG: ${stats.usage}`);
    if (stats.pts) parts.push(`PTS: ${stats.pts}`);
    return parts.join(" · ");
}

/* ==========================================================
   RENDER PROPS (WITH FILTERING)
========================================================== */

function renderProps() {
    const panel = document.getElementById("propsOutput");
    panel.innerHTML = "";

    const filtered = lastProps.filter(p => {
        if (currentFilter === "all") return true;
        if (currentFilter === "green") return p.tier === "GREEN";
        if (currentFilter === "yellow") return p.tier === "YELLOW";
        if (currentFilter === "red") return p.tier === "RED";
        return true;
    });

    if (!filtered.length) {
        panel.innerHTML = "<p>No props for this filter.</p>";
        return;
    }

    filtered
        .sort((a, b) => b.score - a.score)
        .forEach(p => {
            const row = document.createElement("div");
            row.className = "propRow";

            row.innerHTML = `
                <span>
                    <span class="${p.cssClass}">${p.tier}</span>
                    &nbsp;${p.name} (${p.team})
                </span>
                <span class="propMeta">${p.statsSummary}</span>
            `;

            panel.appendChild(row);
        });
}

/* ==========================================================
   FILTER BUTTONS
========================================================== */

function initFilters() {
    const buttons = document.querySelectorAll(".filterButton");
    buttons.forEach(btn => {
        btn.onclick = () => {
            currentFilter = btn.getAttribute("data-filter");
            buttons.forEach(b => b.classList.remove("filterActive"));
            btn.classList.add("filterActive");
            renderProps();
        };
    });
}

/* ==========================================================
   INIT
========================================================== */

document.getElementById("loadButton").onclick = loadData;
initFilters();
