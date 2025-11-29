// =========================
// SAFE DOM LOADING WRAPPER
// =========================
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Ready. Initializing NBA Prop Engine…");

    const loadButton = document.getElementById("loadButton");
    const gamesList = document.getElementById("games");
    const teamsList = document.getElementById("teamsList");
    const propsOutput = document.getElementById("propsOutput");

    if (!loadButton || !gamesList || !teamsList || !propsOutput) {
        console.error("❌ ERROR: One or more required HTML elements are missing.");
        return;
    }

    // =========================
    // DATA FILE PATHS
    // =========================
    const SCHEDULE_URL = "schedule.json";
    const ROSTERS_URL = "rosters.json";
    const PLAYER_STATS_URL = "player_stats.json";

    let rosters = {};
    let playerStats = {};
    let todaysGames = [];

    // =========================
    // LOAD JSON HELPER
    // =========================
    async function loadJSON(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Bad response: ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error(`❌ Failed loading ${url}:`, err);
            return null;
        }
    }

    // =========================
    // LOAD SCHEDULE
    ==========================
    async function loadSchedule() {
        console.log("Loading schedule…");

        const schedule = await loadJSON(SCHEDULE_URL);
        if (!schedule) {
            gamesList.innerHTML = `<div class="error">Error loading schedule.</div>`;
            return;
        }

        const today = new Date().toISOString().split("T")[0];
        todaysGames = schedule[today] || [];

        gamesList.innerHTML = "";

        if (!todaysGames.length) {
            gamesList.innerHTML = `<div>No games scheduled for ${today}</div>`;
            return;
        }

        todaysGames.forEach(g => {
            const div = document.createElement("div");
            div.className = "game-item";
            div.textContent = `${g.away_team} @ ${g.home_team} — ${g.time_et}`;
            gamesList.appendChild(div);
        });

        console.log("✔ Loaded today's games:", todaysGames);
        renderTeams();
        renderProps();
    }

    // =========================
    // LOAD ROSTERS
    // =========================
    async function loadRosters() {
        console.log("Loading rosters…");
        rosters = await loadJSON(ROSTERS_URL);
        if (!rosters) rosters = {};
        console.log("✔ Rosters loaded", rosters);
    }

    // =========================
    // LOAD PLAYER STATS
    // =========================
    async function loadPlayerStats() {
        console.log("Loading player stats…");
        playerStats = await loadJSON(PLAYER_STATS_URL);
        if (!playerStats) playerStats = {};
        console.log("✔ Player stats loaded", playerStats);
    }

    // =========================
    // RENDER TEAMS
    // =========================
    function renderTeams() {
        teamsList.innerHTML = "";

        const teams = Object.keys(rosters);
        if (!teams.length) return;

        teams.forEach(team => {
            const div = document.createElement("div");
            div.className = "team-item";
            div.textContent = team;
            teamsList.appendChild(div);
        });
    }

    // =========================
    // SIMPLE PROP SCORING
    // =========================
    function scorePlayer(p) {
        if (!p || !p.pts) return 0;

        let score = 0;

        // SIMPLE RULESET (can expand later)
        if (p.pts >= 20) score += 2;
        if (p.pts >= 25) score += 2;
        if (p.usage >= 25) score += 2;
        if (p.min >= 32) score += 1;

        if (score >= 5) return "green";
        if (score >= 3) return "yellow";
        return "red";
    }

    // =========================
    // RENDER PLAYER PROPS
    // =========================
    function renderProps(filter = "all") {
        propsOutput.innerHTML = "";

        const players = Object.keys(playerStats);
        if (!players.length) return;

        players.forEach(name => {
            const p = playerStats[name];
            const color = scorePlayer(p);

            if (filter !== "all" && filter !== color) return;

            const row = document.createElement("div");
            row.className = `prop-item ${color}`;
            row.innerHTML = `
                <strong>${name}</strong> — 
                PTS: ${p.pts} | REB: ${p.reb} | AST: ${p.ast} 
                <span class="tag ${color}">${color.toUpperCase()}</span>
            `;

            propsOutput.appendChild(row);
        });
    }

    // =========================
    // FILTER BUTTONS
    // =========================
    document.querySelectorAll(".filterButton").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filterButton")
                .forEach(b => b.classList.remove("filterActive"));

            btn.classList.add("filterActive");
            renderProps(btn.dataset.filter);
        });
    });

    // =========================
    // MAIN LOAD BUTTON
    // =========================
    loadButton.addEventListener("click", async () => {
        await loadSchedule();
    });

    // =========================
    // INITIAL LOAD (ROSTERS + STATS)
    // =========================
    (async function init() {
        await loadRosters();
        await loadPlayerStats();
        console.log("✔ Engine initialized.");
    })();
});
