// Real cross-device leaderboard for BullRun.
//
// Backed by a Redis-compatible REST store (Vercel KV or Upstash Redis). It
// reads the standard env vars injected by either integration:
//   KV_REST_API_URL / KV_REST_API_TOKEN          (Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash)
//
// If neither is configured the endpoint still responds 200 with
// { configured:false, scores:[] } so the front-end falls back to a local
// (per-device) leaderboard and nothing breaks.

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const KEY = "bullrun:leaderboard:v1";
const MAX_KEEP = 200; // keep only the top N entries in the set
const TOP_N = 25;     // how many to return

async function redis(command) {
  const r = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("store responded " + r.status);
  const j = await r.json();
  return j.result;
}

function cleanName(raw) {
  return (
    String(raw == null ? "" : raw)
      .replace(/[^\w \-$.!]/g, "")
      .trim()
      .slice(0, 14) || "anon"
  );
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!REST_URL || !REST_TOKEN) {
    res.status(200).json({ configured: false, scores: [] });
    return;
  }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
      }
      body = body || {};
      const name = cleanName(body.name);
      const score = Math.max(0, Math.min(1e9, Math.floor(Number(body.score) || 0)));
      if (score > 0) {
        // keep each tag's best score, then trim the set to the top MAX_KEEP
        await redis(["ZADD", KEY, "GT", "CH", score, name]);
        await redis(["ZREMRANGEBYRANK", KEY, 0, -(MAX_KEEP + 1)]);
      }
    } else if (req.method !== "GET") {
      res.status(405).json({ error: "method not allowed" });
      return;
    }

    const flat = (await redis(["ZREVRANGE", KEY, 0, TOP_N - 1, "WITHSCORES"])) || [];
    const scores = [];
    for (let i = 0; i < flat.length; i += 2) {
      scores.push({ name: flat[i], score: Number(flat[i + 1]) });
    }
    res.status(200).json({ configured: true, scores });
  } catch (e) {
    res.status(200).json({ configured: false, error: String((e && e.message) || e), scores: [] });
  }
};
