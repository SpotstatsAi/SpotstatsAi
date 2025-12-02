export async function onRequest(context) {
  try {
    const today = new Date().toISOString().split("T")[0];

    const scheduleUrl = "https://propsparlor.com/schedule.json";
    const scheduleRes = await fetch(scheduleUrl, {
      cf: { cacheEverything: true, cacheTtl: 3600 }
    });

    const schedule = await scheduleRes.json();
    const gamesToday = schedule.filter(g => g.game_date === today);

    return new Response(JSON.stringify(gamesToday), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    });
  }
}
