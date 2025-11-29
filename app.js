// ===============================
// Load JSON helper
// ===============================
async function loadJSON(path) {
    try {
        const res = await fetch(path);
        return await res.json();
    } catch (err) {
        console.error(`Failed loading ${path}`, err);
        return null;
    }
}

// Global storage
let rosters = {};
let stats = {};
let schedule = {};
let todayGames = [];
let activeFilter = "all";

// ===============================
// Load everything on startup
// ===============================
async function init() {
    rosters = await loadJSON("rosters.json");
    stats = await loadJSON("player_stats.json");
    schedule = await loadJSON("schedule.json");

    renderTeams(rosters);
}

document.addEventListener("DOMContentLoaded", init);

// ===============================
// Render Teams
// ===============================
function renderTeams(rosters) {
    const el = document.getElementById("teamsList");
    el.innerHTML = "";

    Object.keys(rosters).forEach(team => {
        const div = document.createElement("div");
        div.className = "team-item";
        div.textContent = team;
        el.appendChild(div);
    });
}

// ===============================
// Load Today's Games
// ===============================
async function loadSchedule() {
    const today = new Date().toISOString().split("T")[0];
    todayGames = schedule[today] || [];

    const list = document.getElementById("games");
    list.innerHTML = "";

    if (!todayGames.length) {
        list.innerHTML = `<div>No games scheduled for ${today}</div>`;
        return;
    }

    todayGames.forEach(g => {
        const div = document.createElement("div");
        div.className = "game-item";
        div.dataset.home = g.home_team;
        div.dataset.away = g.away_team;
        div.textContent = `${g.away_team} @ ${g.home_team} — ${g.time_et}`;
        div.addEventListener("click", () => handleGameSelect(g));
        list.appendChild(div);
    });
}

document.getElementById("loadButton").addEventListener("click", loadSchedule);

// ===============================
// Handle game click
// ===============================
function handleGameSelect(game) {
    const home = game.home_team;
    const away = game.away_team;

    const players = [
        ...rosters[home],
        ...rosters[away]
    ];

    const ranked = players
        .map(name => ({
            name,
            data: stats[name] || {}
        }))
        .sort((a, b) => (b.data.usage || 0) - (a.data.usage || 0));

    renderProps(ranked);
}

// ===============================
// Render Props With Filters
// ===============================
function renderProps(players) {
    const out = document.getElementById("propsOutput");
    out.innerHTML = "";

    players.forEach(p => {
        const usage = p.data.usage || 0;

        let bucket = "red";
        if (usage >= 26) bucket = "green";
        else if (usage >= 20) bucket = "yellow";

        if (activeFilter !== "all" && bucket !== activeFilter) return;

        const div = document.createElement("div");
        div.className = `prop-item ${bucket}`;
        div.innerHTML = `
            <strong>${p.name}</strong>  
            <div>Usage: ${usage.toFixed(1)}</div>
            <div>Points: ${p.data.pts || 0}</div>
            <div>Reb: ${p.data.reb || 0}</div>
            <div>Ast: ${p.data.ast || 0}</div>
        `;
        out.appendChild(div);
    });
}

// ===============================
// Filter Buttons
// ===============================
document.querySelectorAll(".filterButton").forEach(btn => {
    btn.addEventListener("click", () => {
        document
            .querySelectorAll(".filterButton")
            .forEach(b => b.classList.remove("filterActive"));

        btn.classList.add("filterActive");
        activeFilter = btn.dataset.filter;

        // Refresh props after filtering
        const today = new Date().toISOString().split("T")[0];
        const games = schedule[today] || [];
        if (todayGames.length > 0) {
            const first = todayGames[0];
            handleGameSelect(first);
        }
    });
});
