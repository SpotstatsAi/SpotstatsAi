// Load schedule & auto-select today
async function loadSchedule() {
    try {
        const scheduleRes = await fetch("schedule.json");
        const scheduleData = await scheduleRes.json();

        // Today’s date in YYYY-MM-DD
        const today = new Date().toISOString().split("T")[0];

        // Find today's games OR return empty
        const games = scheduleData[today] || [];

        const list = document.getElementById("games");
        list.innerHTML = "";

        if (!games.length) {
            list.innerHTML = `<div>No games scheduled for ${today}</div>`;
            return;
        }

        for (const g of games) {
            const div = document.createElement("div");
            div.className = "game-item";
            div.textContent = `${g.away_team} @ ${g.home_team} — ${g.time_et}`;
            list.appendChild(div);
        }
    } catch (err) {
        console.error("Error loading schedule:", err);
    }
}

// Button listener
document.getElementById("loadButton").addEventListener("click", loadSchedule);
