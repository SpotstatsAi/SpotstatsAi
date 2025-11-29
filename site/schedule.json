// Load schedule & auto-select today
async function loadSchedule() {
    const scheduleRes = await fetch("schedule.json");
    const scheduleData = await scheduleRes.json();

    // Today's date in YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0];

    // Find today's games OR return empty
    const games = scheduleData[today] || [];

    const list = document.getElementById("schedule-list");
    list.innerHTML = "";

    if (!games.length) {
        list.innerHTML = `<li>No games scheduled for ${today}</li>`;
        return;
    }

    for (const g of games) {
        const li = document.createElement("li");
        li.textContent = `${g.away_team} @ ${g.home_team} — ${g.time_et}`;
        list.appendChild(li);
    }
}

loadSchedule();
