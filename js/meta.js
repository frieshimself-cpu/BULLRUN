/* ============================================================================
   BullRun — $BULLRUN token wiring: contract address UI, live price ticker,
   and a real cross-device leaderboard.

   Loaded after game.js. The leaderboard talks to /api/scores (a serverless
   function backed by Vercel KV / Upstash) when available, and falls back to a
   local per-device board otherwise. Live price comes straight from DexScreener
   so the in-game ticker lights up the moment the coin is tradeable.
   ========================================================================== */
(function () {
  "use strict";

  // ----------------------------- YOUR TOKEN ---------------------------------
  // The pump.fun mint address. Change this one line to point at a different
  // token; everything else (links, chart, live price) follows from it.
  const TOKEN_CA = "9rgcgoRDGfSG2diaBhgbj5a5K76H99ViGf3FNvapump";
  // --------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------ contract UI -------------------------------
  function initCA() {
    const caText = $("ca-text");
    if (caText) caText.textContent = TOKEN_CA;
    const pump = $("ca-pump"); if (pump) pump.href = "https://pump.fun/coin/" + TOKEN_CA;
    const chart = $("ca-chart"); if (chart) chart.href = "https://dexscreener.com/solana/" + TOKEN_CA;
    const copy = $("ca-copy");
    if (copy) copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(TOKEN_CA);
      } catch (e) {
        const t = document.createElement("textarea");
        t.value = TOKEN_CA; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.focus(); t.select();
        try { document.execCommand("copy"); } catch (e2) {}
        document.body.removeChild(t);
      }
      const old = copy.textContent; copy.textContent = "✓ Copied"; copy.disabled = true;
      setTimeout(() => { copy.textContent = old; copy.disabled = false; }, 1400);
    });
  }

  // ----------------------- live token data (DexScreener) --------------------
  function fmtUsd(n) {
    if (!isFinite(n)) return "—";
    if (n >= 1) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return "$" + Number(n).toPrecision(3);
  }
  function fmtCap(n) {
    if (!isFinite(n) || n <= 0) return "";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }

  async function pollToken() {
    const stat = $("token-stat");
    try {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + TOKEN_CA, { cache: "no-store" });
      const j = await r.json();
      const pairs = (j && j.pairs) || [];
      if (!pairs.length) {
        window.BULLRUN_TOKEN = { live: false };
        if (stat) { stat.textContent = "goes live on deploy"; stat.classList.remove("down"); }
        return;
      }
      pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
      const p = pairs[0];
      const price = Number(p.priceUsd);
      const chg = Number(p.priceChange && p.priceChange.h24);
      const cap = Number(p.marketCap || p.fdv);
      window.BULLRUN_TOKEN = { live: true, priceUsd: price, change24h: isFinite(chg) ? chg : 0, marketCap: cap };
      if (stat) {
        const up = (isFinite(chg) ? chg : 0) >= 0;
        const capStr = fmtCap(cap);
        stat.textContent = fmtUsd(price) + (capStr ? " · " + capStr : "") + "  " + (up ? "▲" : "▼") + Math.abs(chg || 0).toFixed(1) + "%";
        stat.classList.toggle("down", !up);
      }
    } catch (e) {
      if (!window.BULLRUN_TOKEN) window.BULLRUN_TOKEN = { live: false };
    }
  }

  // ------------------------------- leaderboard ------------------------------
  const LB_LOCAL_KEY = "bullrun_lb_local";
  const TAG_KEY = "bullrun_tag";
  let lastMine = null;

  function localBoard() {
    try { return JSON.parse(localStorage.getItem(LB_LOCAL_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveLocal(name, score) {
    const b = localBoard();
    const existing = b.find((e) => e.name === name);
    if (existing) { if (score > existing.score) existing.score = score; }
    else b.push({ name, score });
    b.sort((a, c) => c.score - a.score);
    const top = b.slice(0, 50);
    try { localStorage.setItem(LB_LOCAL_KEY, JSON.stringify(top)); } catch (e) {}
    return top;
  }

  function renderBoard(scores, scopeText) {
    const list = $("lb-list");
    if (!list) return;
    if (!scores || !scores.length) {
      list.innerHTML = '<li class="lb-empty">No scores yet — be the first! 🐂</li>';
    } else {
      list.innerHTML = scores.map((e, i) => {
        const me = lastMine && e.name === lastMine.name && e.score === lastMine.score;
        const rank = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        return '<li class="' + (me ? "me" : "") + '">' +
          '<span class="lb-rank">' + rank + "</span>" +
          '<span class="lb-name">' + escapeHtml(e.name) + "</span>" +
          '<span class="lb-score">' + fmt(e.score) + "</span></li>";
      }).join("");
    }
    const scope = $("lb-scope");
    if (scope) scope.textContent = scopeText || "";
  }

  async function loadBoard() {
    const list = $("lb-list");
    if (list) list.innerHTML = '<li class="lb-empty">Loading…</li>';
    try {
      const r = await fetch("/api/scores", { cache: "no-store" });
      const j = await r.json();
      if (j && j.configured && Array.isArray(j.scores)) {
        renderBoard(j.scores, "🌍 Global leaderboard");
        return;
      }
    } catch (e) {}
    renderBoard(localBoard(), "📱 This device — connect a store for a global board");
  }

  async function submitScore(name, score) {
    name = (name || "").trim().slice(0, 14) || "anon";
    try { localStorage.setItem(TAG_KEY, name); } catch (e) {}
    lastMine = { name, score };
    saveLocal(name, score); // optimistic, also the source of truth if offline
    try {
      const r = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, score }),
      });
      const j = await r.json();
      if (j && j.configured && Array.isArray(j.scores)) {
        const idx = j.scores.findIndex((e) => e.name === name && e.score === score);
        return { ok: true, global: true, scores: j.scores, rank: idx >= 0 ? idx + 1 : null };
      }
    } catch (e) {}
    const local = localBoard();
    const idx = local.findIndex((e) => e.name === name && e.score === score);
    return { ok: true, global: false, scores: local, rank: idx >= 0 ? idx + 1 : null };
  }

  // -------------------------------- overlay ---------------------------------
  function openBoard() { const el = $("leaderboard-screen"); if (el) el.classList.remove("hidden"); loadBoard(); }
  function closeBoard() { const el = $("leaderboard-screen"); if (el) el.classList.add("hidden"); }

  // --------------------------------- wiring ---------------------------------
  function init() {
    initCA();
    pollToken();
    setInterval(pollToken, 30000);

    let pendingScore = null;

    const lbBtn = $("lb-btn"); if (lbBtn) lbBtn.addEventListener("click", openBoard);
    const lbClose = $("lb-close"); if (lbClose) lbClose.addEventListener("click", closeBoard);

    const post = $("lb-post");
    const nameInput = $("lb-name");
    if (post) post.addEventListener("click", async () => {
      if (pendingScore == null) return;
      post.disabled = true;
      const res = await submitScore(nameInput ? nameInput.value : "", pendingScore);
      const resEl = $("lb-result");
      if (resEl) {
        resEl.textContent = res.rank
          ? (res.global ? "Posted! Global rank #" + res.rank + " 🏆" : "Saved — local rank #" + res.rank)
          : "Posted! 🏆";
      }
      pendingScore = null; // prevent double-posting the same run
      openBoard();
    });

    window.addEventListener("bullrun:gameover", (e) => {
      pendingScore = (e.detail && e.detail.score) || 0;
      if (nameInput) {
        let saved = "";
        try { saved = localStorage.getItem(TAG_KEY) || ""; } catch (er) {}
        nameInput.value = saved;
      }
      const resEl = $("lb-result"); if (resEl) resEl.textContent = "";
      if (post) post.disabled = false;
    });

    window.addEventListener("bullrun:menu", closeBoard);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
