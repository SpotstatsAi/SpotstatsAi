async function loadGames() {
  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(`/api/games/date/${today}`);
  const games = await res.json();

  const container = document.getElementById("games-container");
  container.innerHTML = "";

  if (!games.length) {
    container.innerHTML = `<div style="color:#94a3b8;">No games today.</div>`;
    return;
  }

  games.forEach(game => {
    const homeStyle = TEAM_STYLE_MAP[game.home_team_abbr];
    const awayStyle = TEAM_STYLE_MAP[game.away_team_abbr];

    const card = document.createElement("div");
    card.classList.add("game-card");

    // Team color accent
    card.style.borderLeftColor = homeStyle?.color || "#3b82f6";

    // Game status badge
    let badgeClass = "status-upcoming";
    if (game.status === "Final") badgeClass = "status-final";
    if (game.status?.toLowerCase().includes("live")) badgeClass = "status-live";

    // Matchup edge (placeholder example)
    const edgePercent = Math.floor(Math.random() * 100);

    card.innerHTML = `
      <div class="game-header">
        <div class="team-block">
          <div class="team-logo" style="background-image:url('${awayStyle.logo}')"></div>
          <div class="team-abbr">${game.away_team_abbr}</div>
        </div>

        <div class="status-badge ${badgeClass}">${game.status}</div>

        <div class="team-block">
          <div class="team-abbr">${game.home_team_abbr}</div>
          <div class="team-logo" style="background-image:url('${homeStyle.logo}')"></div>
        </div>
      </div>

      <div class="game-info">${game.time_et || "TBD"}</div>

      <div class="edge-bar">
        <div class="edge-fill" style="width:${edgePercent}%;"></div>
      </div>

      <div class="expand-btn">Details</div>

      <div class="expand-panel">
        <div class="injury-section">
          <div class="section-title">Injuries</div>
          <div class="injury-content">Loading...</div>
        </div>

        <div class="props-section">
          <div class="section-title">Prop Preview</div>
          <div class="props-slider"><div class="props-fill" style="width:${edgePercent}%;"></div></div>
        </div>
      </div>
    `;

    // Expand logic
    card.querySelector(".expand-btn").addEventListener("click", () => {
      const panel = card.querySelector(".expand-panel");
      panel.style.display = panel.style.display === "none" || panel.style.display === ""
        ? "block"
        : "none";
    });

    container.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", loadGames);
