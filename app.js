let rostersData = {};
let scheduleData = {};
let playerStats = {};
let lastProps = [];
let currentFilter = "all";

// -------------------- LOAD ALL DATA --------------------

async function loadAllData() {
    try {
        const [rostersRes, scheduleRes, statsRes] = await Promise.all([
            fetch("rosters.json"),
            fetch("schedule.json"),
            fetch("player_stats.json")
        ]);

        rostersData = await rostersRes.json();
        scheduleData = await scheduleRes.json();
        playerStats = await statsRes.json();

        renderTeams();
        renderScheduleForToday();

    } catch (err) {
        console.error("Error loading data:", err);
    }
}

// -------------------- TEAMS --------------------

function renderTeams() {
    const container = document.getElementById("teamsList");
    if (!container) return;
  
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


// -------------------- SCHEDULE --------------------

function renderScheduleForToday() {
    const gamesDiv = document.getElementById("games");
    if (!gamesDiv) return;

    gamesDiv.innerHTML = "";

    const today = new Date().toISOString().split("T")[0];
    const games = scheduleData[today] || [];

    if (!games.length) {
        gamesDiv.innerHTML = `<div>No games scheduled for ${today}</div>`;
        return;
    }

    games.forEach(game => {
        const card = document.createElement("div");
        card.className = "gameCard";

        card.innerHTML = `
            <strong>${game.away_team} @ ${game.home_team}</strong><br>
            <span>${game.time_et || ""}</span>
        `;

        card.onclick = () => showGameProps(game);
        gamesDiv.appendChild(card);
    });
}


// -------------------- PROPS --------------------

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


// -------------------- SCORING --------------------

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
    if (stats.pace && stats.pace >= 100) score += 0.05;

    if (score > 1) score = 1;
    if (score < 0) score = 0;

    return score;
}

function summarizeStats(stats) {
    const out = [];
    if (stats.min) out.push(`Min: ${stats.min}`);
    if (stats.usage) out.push(`USG: ${stats.usage}`);
    if (stats.pts) out.push(`PTS: ${stats.pts}`);
    return out.join(" • ");
}


// -------------------- FILTERS --------------------

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

function renderProps() {
    const panel = document.getElementById("propsOutput");
    panel.innerHTML = "";

    const filtered = lastProps.filter(p => {
        if (currentFilter === "all") return true;
        return p.tier.toLowerCase() === currentFilter;
    });

    if (!filtered.length) {
        panel.innerHTML = "<p>No props for this filter.</p>";
        return;
    }

    filtered.sort((a, b) => b.score - a.score);

    filtered.forEach(p => {
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


// -------------------- INIT --------------------

document.getElementById("loadButton").onclick = loadAllData;
initFilters();
