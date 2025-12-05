// functions/api/bdl/games.js
// Minimal test handler to verify routing.

export async function onRequest() {
  const body = {
    ok: true,
    route: "/api/bdl/games",
    note: "minimal test handler",
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
