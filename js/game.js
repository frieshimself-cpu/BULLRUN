/* =====================================================================
   BullRun — an original endless runner (genre-inspired, all-original art)
   Single-file engine, no dependencies. Runs straight from file://.
   You are a bull charging down three railway tracks: jump, roll, dodge
   trains (or ride their roofs), grab coins, and trigger power-ups.
   ===================================================================== */
(function () {
  "use strict";

  // ----------------------------------------------------------------- setup
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const els = {
    hud: document.getElementById("hud"),
    coins: document.getElementById("coins"),
    score: document.getElementById("score"),
    powerupBar: document.getElementById("powerup-bar"),
    start: document.getElementById("start-screen"),
    pause: document.getElementById("pause-screen"),
    over: document.getElementById("over-screen"),
    finalScore: document.getElementById("final-score"),
    finalCoins: document.getElementById("final-coins"),
    finalBest: document.getElementById("final-best"),
    startBest: document.getElementById("start-best"),
    newBest: document.getElementById("new-best"),
  };

  // Logical resolution (we render at this and CSS-scale to fit).
  let W = 480, H = 800, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = Math.max(360, Math.round(rect.width));
    H = Math.max(480, Math.round(rect.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------- constants
  const LANES = [-1, 0, 1];          // left, center, right
  const LANE_W = 1.05;               // world units between lanes
  const FOCAL = 460;                 // perspective focal length (px)
  const CAM_BACK = 3.1;              // camera distance behind player (world)
  const CAM_HEIGHT = 2.35;           // camera height above ground (world)
  const Z_FAR = 60;                  // draw distance
  const GRAVITY = 58;                // jump gravity (world units / s^2)
  const JUMP_V = 16.5;               // jump launch velocity
  const ROLL_TIME = 0.55;            // seconds spent rolling
  const BASE_SPEED = 16;             // starting forward speed (world units/s)
  const MAX_SPEED = 42;
  const HORIZON_FRAC = 0.34;         // horizon position as fraction of H
  const TRAIN_H = 1.55;              // train car height (you can ride the roof)
  const JET_CRUISE = 3.4;            // jetpack cruise altitude

  // ----------------------------------------------------------- projection
  // World point (worldX lateral, y height above ground, z distance ahead)
  // -> screen pixel + scale factor. Camera looks straight down the track.
  let camY = CAM_HEIGHT;   // camera height, eased upward as the bull rises
  function project(worldX, y, z) {
    const rz = z + CAM_BACK;
    const scale = FOCAL / rz;
    const cx = W * 0.5;
    const horizon = H * HORIZON_FRAC;
    const sx = cx + worldX * scale;
    // ground (y=0) far away sits at horizon; near & high y moves down/up.
    const sy = horizon + (camY - y) * scale;
    return { x: sx, y: sy, s: scale };
  }
  function laneX(laneFloat) { return laneFloat * LANE_W; }

  // --------------------------------------------------------------- audio
  const Sound = (function () {
    let ctxA = null, muted = false, master = null;
    function ensure() {
      if (ctxA) return;
      try {
        ctxA = new (window.AudioContext || window.webkitAudioContext)();
        master = ctxA.createGain();
        master.gain.value = 0.5;
        master.connect(ctxA.destination);
      } catch (e) { ctxA = null; }
    }
    function tone(freq, dur, type, vol, slideTo) {
      if (muted || !ctxA) return;
      const t = ctxA.currentTime;
      const o = ctxA.createOscillator();
      const g = ctxA.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol) {
      if (muted || !ctxA) return;
      const t = ctxA.currentTime;
      const n = Math.floor(ctxA.sampleRate * dur);
      const buf = ctxA.createBuffer(1, n, ctxA.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctxA.createBufferSource();
      const g = ctxA.createGain();
      g.gain.value = vol || 0.3;
      src.buffer = buf; src.connect(g); g.connect(master); src.start(t);
    }
    return {
      resume() { ensure(); if (ctxA && ctxA.state === "suspended") ctxA.resume(); },
      coin() { tone(880, 0.08, "square", 0.25, 1320); },
      jump() { tone(300, 0.18, "sine", 0.3, 700); },
      roll() { noise(0.18, 0.18); },
      hit() { tone(180, 0.35, "sawtooth", 0.4, 60); noise(0.3, 0.3); },
      power() { tone(520, 0.12, "triangle", 0.3, 1040); tone(780, 0.18, "triangle", 0.25, 1560); },
      lane() { tone(440, 0.05, "sine", 0.12); },
      setMuted(m) { muted = m; },
      get muted() { return muted; },
    };
  })();

  // --------------------------------------------------------------- state
  const State = { MENU: 0, PLAY: 1, PAUSE: 2, OVER: 3 };
  let state = State.MENU;

  const game = makeFreshGame();
  function makeFreshGame() {
    return {
      speed: BASE_SPEED,
      dist: 0,                 // world distance travelled
      score: 0,
      coins: 0,
      // player
      lane: 0,                 // target lane index-ish (-1,0,1)
      laneVisual: 0,           // smoothed lateral position
      y: 0, vy: 0,             // vertical
      jumping: false,
      rolling: false,
      rollT: 0,
      runPhase: 0,             // leg animation phase
      // world objects
      obstacles: [],
      coinObjs: [],
      powerups: [],
      particles: [],
      // spawning
      nextSpawnZ: 18,
      // power-up timers
      magnetT: 0,
      multiplierT: 0,
      shieldT: 0,
      hoverT: 0,               // hoverboard: survive one crash while active
      jetT: 0,                 // jetpack: fly above everything, hoover coins
      sneakT: 0,               // super sneakers: much higher jumps
      // train-roof riding
      groundY: 0,              // current floor height under the bull
      onTrain: false,
      // fx
      shake: 0,
      flash: 0,
      hurtFlash: 0,
      dead: false,
    };
  }

  let best = 0;
  try { best = parseInt(localStorage.getItem("bullrun_best") || "0", 10) || 0; } catch (e) {}

  // ------------------------------------------------------- spawn patterns
  // Each pattern is a function returning lists of obstacles/coins/powerups
  // placed at a base Z. All patterns are guaranteed solvable.
  const OB = { LOW: "low", HIGH: "high", FULL: "full", TRAIN: "train" };

  function spawnChunk(baseZ) {
    const r = Math.random();
    const pickLane = () => LANES[(Math.random() * 3) | 0];
    const out = { obstacles: [], coins: [], powerups: [] };

    const TRAIN_TINTS = ["#c0392b", "#2e86c1", "#d4a017", "#27936a", "#7d3cc0", "#e07b39"];
    const pickTint = () => TRAIN_TINTS[(Math.random() * TRAIN_TINTS.length) | 0];

    function coinLine(lane, z0, count, gap, yArc) {
      for (let i = 0; i < count; i++) {
        const y = yArc ? Math.max(0, Math.sin((i / (count - 1)) * Math.PI) * yArc) : 0.0;
        out.coins.push({ lane, z: z0 + i * gap, y: 0.55 + y, got: false });
      }
    }

    if (r < 0.18) {
      // single low barrier (jump it) + coins overhead arc
      const l = pickLane();
      out.obstacles.push({ type: OB.LOW, lane: l, z: baseZ, len: 1.1 });
      coinLine(l, baseZ - 2.5, 5, 1.0, 1.7);
    } else if (r < 0.34) {
      // overhead bar (roll under) with coins leading in low
      const l = pickLane();
      out.obstacles.push({ type: OB.HIGH, lane: l, z: baseZ, len: 1.1 });
      coinLine(l, baseZ - 5, 4, 1.0, 0);
    } else if (r < 0.5) {
      // two full blockers leaving one open lane + coin trail in open lane
      const open = pickLane();
      LANES.forEach((l) => { if (l !== open) out.obstacles.push({ type: OB.FULL, lane: l, z: baseZ, len: 1.3 }); });
      coinLine(open, baseZ - 4, 8, 1.0, 0);
    } else if (r < 0.6) {
      // a train parked in one lane — switch away, OR jump on and ride the roof
      const l = pickLane();
      const len = 7 + Math.random() * 5;
      out.obstacles.push({ type: OB.TRAIN, lane: l, z: baseZ, len, tint: pickTint() });
      const other = LANES.filter((x) => x !== l);
      coinLine(other[(Math.random() * other.length) | 0], baseZ, Math.round(len), 1.0, 0);
      // a tempting coin trail ALONG the roof for the brave who ride it
      for (let i = 1; i < Math.round(len) - 1; i++) {
        out.coins.push({ lane: l, z: baseZ + i, y: TRAIN_H + 0.55, got: false });
      }
    } else if (r < 0.72) {
      // two trains, one open lane between them
      const open = pickLane();
      LANES.forEach((l) => { if (l !== open) out.obstacles.push({ type: OB.TRAIN, lane: l, z: baseZ, len: 8, tint: pickTint() }); });
      coinLine(open, baseZ, 8, 1.0, 0);
    } else if (r < 0.84) {
      // staggered barriers across lanes — weave (jump / roll / switch)
      const order = LANES.slice().sort(() => Math.random() - 0.5);
      order.forEach((l, i) => out.obstacles.push({ type: i % 2 ? OB.HIGH : OB.LOW, lane: l, z: baseZ + i * 4, len: 1.1 }));
      coinLine(0, baseZ - 3, 6, 1.2, 1.2);
    } else if (r < 0.92) {
      // coin field across all lanes, no obstacles (breather)
      LANES.forEach((l) => coinLine(l, baseZ, 6, 1.1, 0));
    } else {
      // power-up drop floating in a lane + a low barrier just after
      const l = pickLane();
      out.obstacles.push({ type: OB.LOW, lane: l, z: baseZ + 4, len: 1.1 });
      const kinds = ["hoverboard", "jetpack", "magnet", "multiplier", "sneakers"];
      out.powerups.push({ kind: kinds[(Math.random() * kinds.length) | 0], lane: l, z: baseZ, y: 1.1, got: false, spin: 0 });
    }
    return out;
  }

  // --------------------------------------------------------------- input
  let touchStart = null;
  const SWIPE_MIN = 26;

  function move(dir) {
    if (state !== State.PLAY) return;
    const ni = clamp(laneIndex(game.lane) + dir, 0, 2);
    const nl = LANES[ni];
    if (nl !== game.lane) { game.lane = nl; Sound.lane(); }
  }
  function laneIndex(l) { return LANES.indexOf(l); }

  function doJump() {
    if (state !== State.PLAY) return;
    if (game.jetT > 0) return; // already airborne on the jetpack
    // can jump when on the ground OR standing on a train roof
    if (!game.jumping && !game.rolling) {
      game.jumping = true;
      game.vy = JUMP_V * (game.sneakT > 0 ? 1.45 : 1);
      game.onTrain = false;
      Sound.jump();
    }
  }
  function doRoll() {
    if (state !== State.PLAY) return;
    if (!game.rolling && !game.jumping) {
      game.rolling = true; game.rollT = ROLL_TIME; Sound.roll();
      spawnDust(10);
    } else if (game.jumping) {
      // fast-fall / slam
      game.vy = Math.min(game.vy, -10);
    }
  }

  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowLeft": case "a": case "A": move(-1); e.preventDefault(); break;
      case "ArrowRight": case "d": case "D": move(1); e.preventDefault(); break;
      case "ArrowUp": case "w": case "W": case " ": doJump(); e.preventDefault(); break;
      case "ArrowDown": case "s": case "S": doRoll(); e.preventDefault(); break;
      case "p": case "P": togglePause(); break;
      case "m": case "M": toggleMute(); break;
      case "Enter":
        if (state === State.MENU) startGame();
        else if (state === State.OVER) startGame();
        break;
    }
  });

  canvas.addEventListener("touchstart", (e) => {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < SWIPE_MIN && ady < SWIPE_MIN) {
      // tap = jump
      doJump();
    } else if (adx > ady) {
      move(dx > 0 ? 1 : -1);
    } else {
      if (dy < 0) doJump(); else doRoll();
    }
    touchStart = null;
  }, { passive: true });

  // buttons
  document.getElementById("play-btn").onclick = startGame;
  document.getElementById("again-btn").onclick = startGame;
  document.getElementById("menu-btn").onclick = toMenu;
  document.getElementById("resume-btn").onclick = togglePause;
  document.getElementById("quit-btn").onclick = toMenu;
  document.getElementById("pause-btn").onclick = togglePause;
  document.getElementById("mute-btn").onclick = toggleMute;

  window.addEventListener("blur", () => { if (state === State.PLAY) togglePause(); });

  // --------------------------------------------------------- game control
  function startGame() {
    Sound.resume();
    Object.assign(game, makeFreshGame());
    state = State.PLAY;
    show(els.start, false); show(els.over, false); show(els.pause, false);
    show(els.hud, true);
    lastT = performance.now();
  }
  function toMenu() {
    state = State.MENU;
    show(els.over, false); show(els.pause, false); show(els.hud, false);
    show(els.start, true);
    els.startBest.textContent = fmt(best);
  }
  function togglePause() {
    if (state === State.PLAY) { state = State.PAUSE; show(els.pause, true); }
    else if (state === State.PAUSE) { state = State.PLAY; show(els.pause, false); lastT = performance.now(); }
  }
  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    document.getElementById("mute-btn").textContent = Sound.muted ? "🔇" : "♪";
  }
  function gameOver() {
    state = State.OVER;
    game.dead = true;
    Sound.hit();
    const sc = Math.floor(game.score);
    let isBest = false;
    if (sc > best) { best = sc; isBest = true; try { localStorage.setItem("bullrun_best", String(best)); } catch (e) {} }
    els.finalScore.textContent = fmt(sc);
    els.finalCoins.textContent = fmt(game.coins);
    els.finalBest.textContent = fmt(best);
    show(els.newBest, isBest);
    setTimeout(() => { show(els.over, true); }, 650);
  }

  // ------------------------------------------------------------- particles
  function spawnDust(n) {
    const px = laneX(game.laneVisual);
    for (let i = 0; i < n; i++) {
      game.particles.push({
        x: px + rand(-0.3, 0.3), y: rand(0, 0.2), z: rand(0.1, 0.5),
        vx: rand(-1.5, 1.5), vy: rand(1, 3), vz: rand(0.5, 2),
        life: rand(0.25, 0.5), max: 0.5, c: "rgba(190,165,125,",
        r: rand(3, 6),
      });
    }
  }
  function spawnJet() {
    const px = laneX(game.laneVisual);
    for (let i = 0; i < 2; i++) {
      game.particles.push({
        x: px + rand(-0.25, 0.25), y: game.y - rand(0.2, 0.6), z: rand(-0.1, 0.3),
        vx: rand(-1, 1), vy: rand(-6, -3), vz: rand(-1, 1),
        life: rand(0.2, 0.4), max: 0.4,
        c: i % 2 ? "rgba(255,170,40," : "rgba(255,90,40,", r: rand(5, 9),
      });
    }
  }
  function spawnSpark(worldX, y, z, color) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 9);
      game.particles.push({
        x: worldX, y: y, z: z,
        vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a) * sp) + 2, vz: rand(-2, 4),
        life: rand(0.25, 0.55), max: 0.55, c: color || "rgba(255,210,63,", r: rand(4, 9),
      });
    }
  }
  function spawnBurst(worldX, y, z) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(4, 14);
      game.particles.push({
        x: worldX, y: y, z: z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 4, vz: rand(-6, 6),
        life: rand(0.4, 0.9), max: 0.9, c: i % 2 ? "rgba(255,91,58," : "rgba(255,255,255,", r: rand(5, 12),
      });
    }
  }

  // --------------------------------------------------------------- update
  let lastT = performance.now();

  function update(dt) {
    if (state !== State.PLAY) return;
    const g = game;

    // difficulty ramp
    g.speed = Math.min(MAX_SPEED, BASE_SPEED + g.dist * 0.006);
    const ds = g.speed * dt;
    g.dist += ds;
    g.score += ds * 0.9 * (g.multiplierT > 0 ? 2 : 1);

    // run leg cycle, faster with speed
    g.runPhase += dt * (g.speed * 0.9);

    // lateral smoothing
    const targetX = laneX(g.lane);
    g.laneVisual += (targetX / LANE_W - g.laneVisual) * Math.min(1, dt * 14);

    // ---- floor height: ride the roof when standing over a train ----
    const pxNow = laneX(g.laneVisual);
    let support = 0;
    for (const o of g.obstacles) {
      if (o.type !== OB.TRAIN) continue;
      if (Math.abs(laneX(o.lane) - pxNow) > 0.7) continue;
      if (o.z < 0.45 && o.z + (o.len || 1) > -0.45) {
        // only ride if we're at/above roof height (else it's a frontal crash)
        if (g.y >= TRAIN_H - 0.3 || g.onTrain) support = Math.max(support, TRAIN_H);
      }
    }
    g.groundY = support;

    // ---- vertical motion ----
    if (g.jetT > 0) {
      // jetpack: cruise high above everything
      g.jumping = false; g.onTrain = false; g.vy = 0;
      g.y += (JET_CRUISE - g.y) * Math.min(1, dt * 3.2);
      if (Math.random() < 0.8) spawnJet();
    } else if (g.jumping) {
      g.vy -= GRAVITY * dt;
      g.y += g.vy * dt;
      if (g.vy <= 0 && g.y <= g.groundY) {            // land (ground or train roof)
        g.y = g.groundY; g.vy = 0; g.jumping = false;
        g.onTrain = g.groundY > 0;
        spawnDust(g.onTrain ? 4 : 8);
      }
    } else {
      // grounded or riding a roof
      if (g.y > g.groundY + 0.01) { g.jumping = true; g.vy = 0; g.onTrain = false; } // roof ended -> fall
      else { g.y = g.groundY; g.onTrain = g.groundY > 0; }
    }

    // rolling timer
    if (g.rolling) { g.rollT -= dt; if (g.rollT <= 0) g.rolling = false; }

    // power-up timers
    if (g.magnetT > 0) g.magnetT -= dt;
    if (g.multiplierT > 0) g.multiplierT -= dt;
    if (g.shieldT > 0) g.shieldT -= dt;
    if (g.hoverT > 0) g.hoverT -= dt;
    if (g.jetT > 0) g.jetT -= dt;
    if (g.sneakT > 0) g.sneakT -= dt;

    // move world toward player (objects' z decreases)
    function advance(arr) { for (const o of arr) o.z -= ds; }
    advance(g.obstacles); advance(g.coinObjs); advance(g.powerups);

    // spawn ahead
    g.nextSpawnZ -= ds;
    if (g.nextSpawnZ <= 0) {
      const chunk = spawnChunk(Z_FAR);
      g.obstacles.push(...chunk.obstacles);
      g.coinObjs.push(...chunk.coins);
      g.powerups.push(...chunk.powerups);
      // spacing shrinks slightly as speed grows -> denser later
      const spacing = Math.max(9, 16 - g.dist * 0.004);
      g.nextSpawnZ = spacing + Math.random() * 5;
    }

    // cull passed objects
    g.obstacles = g.obstacles.filter((o) => o.z + (o.len || 1) > -4);
    g.coinObjs = g.coinObjs.filter((o) => o.z > -3 && !o.got);
    g.powerups = g.powerups.filter((o) => o.z > -3 && !o.got);

    const playerWorldX = laneX(g.laneVisual);

    // ---- coin collection (magnet + jetpack hoover both vacuum coins) ----
    const vacuum = g.magnetT > 0 || g.jetT > 0;
    for (const c of g.coinObjs) {
      if (c.got) continue;
      if (vacuum && c.z < 12 && c.z > -1) {
        // pull toward the bull's lane and current height
        c.lane += ((g.laneVisual) - c.lane) * Math.min(1, dt * 6);
        c.y += ((g.y + 0.55) - c.y) * Math.min(1, dt * 6);
      }
      const cWorldX = laneX(c.lane);
      const near = c.z < 0.7 && c.z > -0.7;
      const sameLane = Math.abs(cWorldX - playerWorldX) < 0.7;
      // collect if vacuumed in, or you're in lane at the right height
      const heightOK = Math.abs((g.y + 0.55) - c.y) < 1.1 || vacuum;
      if (near && sameLane && heightOK) {
        c.got = true;
        g.coins += 1;
        g.score += 10 * (g.multiplierT > 0 ? 2 : 1);
        Sound.coin();
        spawnSpark(cWorldX, c.y, 0, "rgba(255,210,63,");
      }
    }

    // ---- power-up pickup ----
    for (const p of g.powerups) {
      if (p.got) continue;
      p.spin += dt * 4;
      const pWorldX = laneX(p.lane);
      if (p.z < 0.7 && p.z > -0.7 && Math.abs(pWorldX - playerWorldX) < 0.8 && Math.abs((g.y + 0.6) - p.y) < 1.4) {
        p.got = true;
        applyPowerup(p.kind);
        Sound.power();
        spawnSpark(pWorldX, p.y, 0, "rgba(120,220,255,");
      }
    }

    // ---- obstacle collision ----
    for (const o of g.obstacles) {
      const oWorldX = laneX(o.lane);
      const inZ = o.z < 0.55 && o.z + (o.len || 1) > -0.55;
      if (!inZ) continue;
      const sameLane = Math.abs(oWorldX - playerWorldX) < 0.75;
      if (!sameLane) continue;
      if (o.passed) continue;

      let safe = false;
      if (g.jetT > 0) safe = true;                            // jetpack flies over all
      else if (o.type === OB.LOW) safe = g.y > 0.95 || g.onTrain;       // jump over it
      else if (o.type === OB.HIGH) safe = g.rolling;          // roll under it
      else if (o.type === OB.TRAIN) safe = g.onTrain || g.y >= TRAIN_H - 0.3; // ride the roof
      // FULL: a solid wall — must switch lanes (no way to clear it on foot)

      if (!safe) {
        if (g.hoverT > 0 || g.shieldT > 0) {
          // a save: hoverboard burns first, then a shield
          if (g.hoverT > 0) g.hoverT = 0; else g.shieldT = 0;
          o.passed = true;
          spawnBurst(oWorldX, 1, 0);
          g.shake = 0.45; g.flash = 0.55;
          Sound.power();
        } else {
          o.passed = true;
          g.shake = 0.8; g.hurtFlash = 1;
          spawnBurst(playerWorldX, 1, 0);
          gameOver();
          return;
        }
      } else {
        o.passed = true; // cleared
      }
    }

    // ---- particles ----
    for (const pt of g.particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt - ds * 0.0;
      pt.vy -= 18 * dt;
      pt.life -= dt;
      if (pt.y < 0) { pt.y = 0; pt.vy *= -0.3; pt.vx *= 0.6; }
    }
    g.particles = g.particles.filter((p) => p.life > 0);

    // running dust
    if (!g.jumping && Math.random() < 0.4) spawnDust(1);

    // fx decay
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 2.2);
    if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2);
    if (g.hurtFlash > 0) g.hurtFlash = Math.max(0, g.hurtFlash - dt * 1.5);

    // HUD
    els.coins.textContent = fmt(g.coins);
    els.score.textContent = fmt(Math.floor(g.score));
    updatePowerupBar();
  }

  function applyPowerup(kind) {
    if (kind === "magnet") game.magnetT = 9;
    else if (kind === "multiplier") game.multiplierT = 9;
    else if (kind === "shield") game.shieldT = 10;
    else if (kind === "hoverboard") game.hoverT = 14;
    else if (kind === "jetpack") game.jetT = 5;
    else if (kind === "sneakers") game.sneakT = 12;
  }

  function updatePowerupBar() {
    const bar = els.powerupBar;
    const chips = [];
    if (game.jetT > 0) chips.push(["#ff7a3a", "🚀", Math.ceil(game.jetT)]);
    if (game.hoverT > 0) chips.push(["#c08bff", "🛹", Math.ceil(game.hoverT)]);
    if (game.sneakT > 0) chips.push(["#9affd0", "👟", Math.ceil(game.sneakT)]);
    if (game.magnetT > 0) chips.push(["#5cc8ff", "🧲", Math.ceil(game.magnetT)]);
    if (game.multiplierT > 0) chips.push(["#ffd23f", "×2", Math.ceil(game.multiplierT)]);
    if (game.shieldT > 0) chips.push(["#8affc1", "🛡", Math.ceil(game.shieldT)]);
    bar.innerHTML = chips.map(([c, i, t]) =>
      `<span class="pu-chip" style="color:${c}">${i} ${t}s</span>`).join("");
  }

  // --------------------------------------------------------------- render
  function render() {
    const g = game;
    // camera rises partway with the bull so jumps & train-roof rides read clearly
    camY = CAM_HEIGHT + g.y * 0.6;
    ctx.save();

    // camera shake
    if (g.shake > 0) {
      ctx.translate(rand(-1, 1) * g.shake * 8, rand(-1, 1) * g.shake * 8);
    }

    drawSky();
    drawGround();
    drawScenery();

    // collect all drawables, sort far -> near
    const draws = [];
    // clamp passed-but-still-visible obstacles (e.g. a train being ridden) to
    // z>=0 so the bull, drawn last on ties, sits on top of them
    for (const o of g.obstacles) draws.push({ z: Math.max(o.z, 0), kind: "ob", o });
    for (const c of g.coinObjs) if (!c.got) draws.push({ z: c.z, kind: "coin", o: c });
    for (const p of g.powerups) if (!p.got) draws.push({ z: p.z, kind: "pu", o: p });
    draws.push({ z: 0, kind: "player" });
    draws.sort((a, b) => b.z - a.z);

    for (const d of draws) {
      if (d.kind === "ob") drawObstacle(d.o);
      else if (d.kind === "coin") drawCoin(d.o);
      else if (d.kind === "pu") drawPowerup(d.o);
      else if (d.kind === "player") drawBull();
    }

    drawParticles();
    ctx.restore();

    // full-screen flashes
    if (g.flash > 0) { ctx.fillStyle = `rgba(120,220,255,${g.flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
    if (g.hurtFlash > 0) { ctx.fillStyle = `rgba(255,40,40,${g.hurtFlash * 0.45})`; ctx.fillRect(0, 0, W, H); }
  }

  // sky gradient + sun + parallax clouds
  let cloudOffset = 0;
  function drawSky() {
    const horizon = H * HORIZON_FRAC;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 40);
    sky.addColorStop(0, "#4a90e2");
    sky.addColorStop(0.6, "#87c7ff");
    sky.addColorStop(1, "#cdeaff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 40);

    // sun
    ctx.save();
    ctx.fillStyle = "rgba(255,245,200,0.95)";
    ctx.beginPath(); ctx.arc(W * 0.74, horizon * 0.5, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,245,200,0.18)";
    ctx.beginPath(); ctx.arc(W * 0.74, horizon * 0.5, 70, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // clouds
    cloudOffset = (game.dist * 0.6) % (W + 300);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 180 + 60) - cloudOffset * (0.3 + i * 0.05)) % (W + 200);
      const x = cx < -150 ? cx + W + 200 : cx;
      const y = horizon * (0.25 + (i % 2) * 0.2);
      cloud(x, y, 28 + (i % 3) * 8);
    }
  }
  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r, y + 4, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - r, y + 5, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.4, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // the running surface: a gravel railway bed with sleepers + steel rails
  const BED_HALF = LANE_W * 1.55;
  function drawGround() {
    const horizon = H * HORIZON_FRAC;

    // embankment / dirt either side of the tracks
    const bg = ctx.createLinearGradient(0, horizon, 0, H);
    bg.addColorStop(0, "#6f7f57");
    bg.addColorStop(1, "#4a4034");
    ctx.fillStyle = bg;
    ctx.fillRect(0, horizon, W, H - horizon);

    // gravel ballast bed (trapezoid)
    const lf = project(-BED_HALF, 0, Z_FAR), rf = project(BED_HALF, 0, Z_FAR);
    const ln = project(-BED_HALF, 0, 0), rn = project(BED_HALF, 0, 0);
    const bed = ctx.createLinearGradient(0, horizon, 0, H);
    bed.addColorStop(0, "#8d8578");
    bed.addColorStop(1, "#5c554b");
    ctx.fillStyle = bed;
    ctx.beginPath();
    ctx.moveTo(lf.x, lf.y); ctx.lineTo(rf.x, rf.y); ctx.lineTo(rn.x, rn.y); ctx.lineTo(ln.x, ln.y);
    ctx.closePath(); ctx.fill();

    // wooden sleepers (ties), scrolling toward the camera
    const tiePhase = game.dist % 1.4;
    ctx.fillStyle = "#46321f";
    for (let z = Z_FAR; z > -1.4; z -= 1.4) {
      const zz = z - tiePhase;
      if (zz < -1.4) continue;
      const a = project(-BED_HALF * 0.95, 0.02, zz);
      const b = project(BED_HALF * 0.95, 0.02, zz);
      const c = project(BED_HALF * 0.95, 0.02, zz - 0.45);
      const d = project(-BED_HALF * 0.95, 0.02, zz - 0.45);
      if (a.s <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath(); ctx.fill();
    }

    // steel rails: a pair for every lane/track
    const gauge = 0.34, railHalf = 0.05;
    for (const cl of LANES) {
      for (const off of [-gauge, gauge]) {
        const wx = laneX(cl) + off;
        const f1 = project(wx - railHalf, 0.06, Z_FAR), f2 = project(wx + railHalf, 0.06, Z_FAR);
        const n1 = project(wx - railHalf, 0.06, 0), n2 = project(wx + railHalf, 0.06, 0);
        ctx.fillStyle = "#cfd4da";
        ctx.beginPath();
        ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n1.x, n1.y);
        ctx.closePath(); ctx.fill();
        // shine
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.lineTo(n1.x, n1.y); ctx.stroke();
      }
    }
  }

  // hashless deterministic pseudo-random for stable scenery
  function h1(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

  // trackside scenery: a passing city skyline for speed + atmosphere
  function drawScenery() {
    const STEP = 5;
    const phase = game.dist % STEP;
    const BCOL = ["#7d8aa5", "#9aa0b0", "#8a7f9a", "#6f7d8c", "#a59a8c", "#8c93a8"];
    // draw far buildings first (already far->near because z decreases)
    for (let z = Z_FAR; z > 0; z -= STEP) {
      const zz = z - phase;
      if (zz <= 0.4) continue;
      for (const side of [-1, 1]) {
        const idx = Math.round(z / STEP) * 2 + (side > 0 ? 1 : 0);
        const hgt = 2.6 + h1(idx) * 4.5;
        const wHalf = 0.55 + h1(idx + 7) * 0.35;
        const bx = side * (BED_HALF + 0.8 + h1(idx + 3) * 1.4 + wHalf);
        const col = BCOL[Math.floor(h1(idx + 1) * BCOL.length) % BCOL.length];
        drawBox(bx, 0, hgt, wHalf, zz, zz + 1.4, col, shade(col, 0.16));
        // window grid (deterministic lit/unlit so it doesn't flicker)
        for (let wy = 0.5, row = 0; wy < hgt - 0.3; wy += 0.6, row++) {
          for (let c = -1; c <= 1; c++) {
            const lit = h1(idx * 31 + row * 7 + c * 3) > 0.45;
            const wp = project(bx + c * wHalf * 0.55, wy, zz);
            if (wp.s <= 0) continue;
            const ws = Math.max(1, (wp.s / FOCAL) * 8);
            ctx.fillStyle = lit ? "rgba(255,235,150,0.85)" : "rgba(40,46,60,0.6)";
            ctx.fillRect(wp.x - ws / 2, wp.y - ws / 2, ws, ws * 1.3);
          }
        }
      }
    }
  }

  // ----- obstacle drawing as shaded 3D boxes -----
  function drawObstacle(o) {
    const x = laneX(o.lane);
    const half = 0.62;
    let h, color, topColor;
    if (o.type === OB.LOW) { h = 0.85; color = "#c64f2e"; topColor = "#e8694a"; }
    else if (o.type === OB.HIGH) { h = 2.4; color = "#5a4a8a"; topColor = "#7a66b0"; /* bar overhead, gap below */ }
    else if (o.type === OB.TRAIN) { h = TRAIN_H; color = o.tint || "#c0392b"; topColor = shade(color, 0.18); }
    else { h = 1.6; color = "#34495e"; topColor = "#4a6178"; } // FULL

    const len = o.len || 1.1;
    const NEAR_Z = 0.06;
    const zBack = o.z + len;
    if (zBack <= NEAR_Z) return;               // fully behind the camera — don't draw
    const noseBehind = o.z < NEAR_Z;           // front edge already past the camera
    const zFront = Math.max(o.z, NEAR_Z);      // clamp front to the near plane

    if (o.type === OB.HIGH) {
      // overhead bar: two posts + a bar up high, with a clear gap to roll under
      drawBox(x - half, 0, h, 0.12, zFront, zFront + 0.2, "#3a2f5a", "#4a3f6a");
      drawBox(x + half, 0, h, 0.12, zFront, zFront + 0.2, "#3a2f5a", "#4a3f6a");
      drawBox(x, h - 0.55, 0.55, half, zFront, zBack, color, topColor);
      drawSignText(x, h - 0.28, zFront, "ROLL");
      return;
    }

    drawBox(x, 0, h, half, zFront, zBack, color, topColor, noseBehind);

    if (o.type === OB.TRAIN) {
      // windows on whichever side faces the camera (none for a centered car)
      const winX = x > 0.15 ? x - half : (x < -0.15 ? x + half : null);
      if (winX !== null) {
        const nWin = Math.max(2, Math.round(len) - 1);
        for (let i = 0; i < nWin; i++) {
          const zc = zFront + 0.7 + i * ((len - 1) / nWin);
          if (zc <= NEAR_Z || zc > zBack) continue;
          const a = project(winX, h * 0.74, zc);
          const b = project(winX, h * 0.46, zc + (len - 1) / nWin * 0.62);
          if (a.s <= 0) continue;
          const ww = Math.max(1.5, (a.s / FOCAL) * 16);
          const wh = Math.max(2, Math.abs(b.y - a.y));
          ctx.fillStyle = "rgba(190,225,255,0.85)";
          ctx.fillRect(a.x - ww * 0.5, a.y, ww, wh);
          ctx.strokeStyle = "rgba(20,30,45,0.5)"; ctx.lineWidth = 1;
          ctx.strokeRect(a.x - ww * 0.5, a.y, ww, wh);
        }
      }
      // roof panel lines across the car so the roof reads as a surface
      ctx.strokeStyle = shade(color, -0.28);
      ctx.lineWidth = Math.max(1, (project(x, h, zFront).s / FOCAL) * 5);
      for (let zc = Math.max(zFront, 0.3); zc < zBack; zc += 1.3) {
        const pl = project(x - half * 0.95, h, zc);
        const pr = project(x + half * 0.95, h, zc);
        ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
      }
      // front headlight, only while the nose is still visible
      if (!noseBehind) {
        const hl = project(x, h * 0.3, zFront);
        ctx.fillStyle = "rgba(255,240,180,0.95)";
        ctx.beginPath(); ctx.arc(hl.x, hl.y, Math.max(2, (hl.s / FOCAL) * 9), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (o.type === OB.LOW) drawSignText(x, h + 0.25, zFront, "JUMP");
  }

  function drawSignText(x, y, z, text) {
    const p = project(x, y, z);
    const size = Math.max(8, (p.s / FOCAL) * 46);
    if (size < 9) return;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `bold ${size}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = size * 0.12;
    ctx.strokeText(text, p.x, p.y);
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
  }

  function quad(a, b, c, d) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }

  // a shaded box from (x, yBase) up by height, half-width hw, between z's.
  // Only the ONE side face that actually faces the camera (at world x=0) is
  // drawn, so centered boxes don't sprout a lopsided wedge.
  function drawBox(x, yBase, height, hw, zFront, zBack, faceColor, topColor, skipFront) {
    const fbl = project(x - hw, yBase, zFront);
    const fbr = project(x + hw, yBase, zFront);
    const ftl = project(x - hw, yBase + height, zFront);
    const ftr = project(x + hw, yBase + height, zFront);
    const bbl = project(x - hw, yBase, zBack);
    const bbr = project(x + hw, yBase, zBack);
    const btl = project(x - hw, yBase + height, zBack);
    const btr = project(x + hw, yBase + height, zBack);

    // top face
    ctx.fillStyle = topColor;
    quad(ftl, ftr, btr, btl);

    // the side face that faces the camera
    if (x - hw > 0.05) {            // box sits right of center -> see its LEFT face
      ctx.fillStyle = shade(faceColor, -0.16);
      quad(ftl, fbl, bbl, btl);
    } else if (x + hw < -0.05) {    // box sits left of center -> see its RIGHT face
      ctx.fillStyle = shade(faceColor, -0.16);
      quad(ftr, fbr, bbr, btr);
    }

    // front face (skipped when the box's nose is behind the camera)
    if (!skipFront) {
      ctx.fillStyle = faceColor;
      quad(ftl, ftr, fbr, fbl);
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ----- coin -----
  function drawCoin(c) {
    const x = laneX(c.lane);
    const p = project(x, c.y, c.z);
    if (p.s <= 0) return;
    const r = Math.max(2, (p.s / FOCAL) * 16);
    const spin = Math.abs(Math.cos(game.dist * 2 + c.z));
    ctx.save();
    ctx.translate(p.x, p.y);
    // glow
    ctx.fillStyle = "rgba(255,210,63,0.25)";
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
    // coin body (squash horizontally to fake spin)
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    grad.addColorStop(0, "#fff6c4");
    grad.addColorStop(0.5, "#ffd23f");
    grad.addColorStop(1, "#f0a500");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(1, r * (0.3 + spin * 0.7)), r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b9760a"; ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.stroke();
    // ₿-ish bull mark
    if (r > 7) {
      ctx.fillStyle = "#b9760a";
      ctx.font = `bold ${r}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⚡", 0, 1);
    }
    ctx.restore();
  }

  // ----- power-up orb -----
  function drawPowerup(p) {
    const x = laneX(p.lane);
    const pr = project(x, p.y, p.z);
    if (pr.s <= 0) return;
    const r = Math.max(3, (pr.s / FOCAL) * 22);
    let color, icon;
    if (p.kind === "magnet") { color = "#5cc8ff"; icon = "🧲"; }
    else if (p.kind === "multiplier") { color = "#ffd23f"; icon = "×2"; }
    else if (p.kind === "hoverboard") { color = "#c08bff"; icon = "🛹"; }
    else if (p.kind === "jetpack") { color = "#ff7a3a"; icon = "🚀"; }
    else if (p.kind === "sneakers") { color = "#9affd0"; icon = "👟"; }
    else { color = "#8affc1"; icon = "🛡"; }
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(Math.sin(p.spin) * 0.2);
    ctx.fillStyle = color + "44";
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2); ctx.fill();
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 2; ctx.stroke();
    if (r > 9) {
      ctx.fillStyle = "#163"; ctx.font = `bold ${r}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(icon, 0, 1);
    }
    ctx.restore();
  }

  // ----- particles -----
  function drawParticles() {
    for (const pt of game.particles) {
      if (pt.z < -CAM_BACK + 0.1) continue;
      const p = project(pt.x, pt.y, pt.z);
      if (p.s <= 0) continue;
      const r = Math.max(1, pt.r * (p.s / FOCAL) * 3.2);
      const a = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.c + (a * 0.9).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ============================================================ THE BULL
  // Drawn from behind (we chase it). Stylized cartoon bull with horns,
  // muscular haunches, animated gallop, jump-tuck and roll-squash poses.
  function drawBull() {
    const g = game;
    const x = laneX(g.laneVisual);
    const base = project(x, g.y, 0);
    const s = base.s / FOCAL * 60;  // pixel scale unit
    const cx = base.x;
    let cy = base.y;

    // pose params
    const run = g.runPhase;
    const gallop = Math.sin(run);
    const gallop2 = Math.sin(run + Math.PI);
    let squash = 1, stretch = 1, lean = 0;
    let bodyY = 0;
    if (g.rolling) {
      const k = 1 - g.rollT / ROLL_TIME;       // 0..1 progress
      squash = 0.5; stretch = 1.4;
      bodyY = s * 1.0;
      lean = Math.sin(k * Math.PI) * 0.5;
    } else if (g.jumping) {
      stretch = 1.05;
      lean = clamp(-g.vy * 0.02, -0.3, 0.3);
    }
    // subtle bob while running
    if (!g.jumping && !g.rolling) bodyY = Math.abs(gallop) * s * 0.18;

    ctx.save();
    ctx.translate(cx, cy + bodyY);
    ctx.rotate(lean * 0.2);

    // ---- ground shadow ----
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (g.shake > 0) ctx.translate(rand(-1, 1) * g.shake * 8, rand(-1, 1) * g.shake * 8);
    const sh = project(x, 0, 0);
    const shR = (sh.s / FOCAL * 60) * 2.4;
    const shAlpha = clamp(1 - g.y * 0.4, 0.15, 0.5);
    ctx.fillStyle = `rgba(0,0,0,${shAlpha})`;
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y + s * 0.2, shR, shR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // re-apply translate for body
    ctx.save();
    ctx.scale(stretch, squash);

    const bodyW = 2.0 * s;
    const bodyH = 2.3 * s;
    const hideColor = "#5b3a29";       // bull hide brown
    const hideDark = "#43291c";
    const hideLight = "#6e4a35";

    // ---- shield / hoverboard auras ----
    if (g.shieldT > 0 || g.hoverT > 0) {
      const ac = g.shieldT > 0 ? "138,255,193" : "192,139,255";
      ctx.save();
      ctx.fillStyle = `rgba(${ac},${0.16 + 0.1 * Math.sin(run * 2)})`;
      ctx.beginPath(); ctx.ellipse(0, -bodyH * 0.5, bodyW * 1.5, bodyH * 1.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${ac},0.8)`; ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // ---- hoverboard under the hooves ----
    if (g.hoverT > 0) {
      const by = s * 1.18;
      ctx.save();
      ctx.fillStyle = "rgba(192,139,255,0.35)";
      ctx.beginPath(); ctx.ellipse(0, by + s * 0.16, bodyW * 0.95, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      const bg = ctx.createLinearGradient(-bodyW, 0, bodyW, 0);
      bg.addColorStop(0, "#6a2fb0"); bg.addColorStop(0.5, "#c08bff"); bg.addColorStop(1, "#6a2fb0");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(0, by, bodyW * 0.85, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      // thruster glow
      ctx.fillStyle = "rgba(120,200,255,0.6)";
      for (const tx of [-0.6, 0.6]) {
        ctx.beginPath(); ctx.ellipse(tx * bodyW, by + s * 0.32, s * 0.18, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ---- back legs (animated gallop) ----
    function leg(side, swing) {
      const hipX = side * bodyW * 0.34;
      const hipY = -bodyH * 0.18;
      const kneeX = hipX + side * s * 0.1;
      const kneeY = hipY + s * (0.7 + swing * 0.15);
      const footX = hipX + side * s * (0.15) + swing * s * 0.5;
      const footY = hipY + s * (1.45 + Math.max(0, swing) * 0.2);
      ctx.strokeStyle = hideColor;
      ctx.lineWidth = s * 0.42;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
      ctx.stroke();
      // hoof
      ctx.fillStyle = "#241712";
      ctx.beginPath(); ctx.ellipse(footX, footY, s * 0.26, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    }
    const swingL = g.jumping ? -0.4 : gallop;
    const swingR = g.jumping ? -0.4 : gallop2;
    leg(-1, swingL);
    leg(1, swingR);

    // ---- tail ----
    ctx.save();
    ctx.strokeStyle = hideDark; ctx.lineWidth = s * 0.16; ctx.lineCap = "round";
    const tailSwing = Math.sin(run * 0.8) * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH * 0.55);
    ctx.quadraticCurveTo(tailSwing * s, -bodyH * 0.2, tailSwing * s * 1.4, s * 0.3);
    ctx.stroke();
    ctx.fillStyle = "#2a1a12";
    ctx.beginPath(); ctx.arc(tailSwing * s * 1.4, s * 0.35, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ---- body (haunches/back, seen from behind) ----
    const bodyGrad = ctx.createLinearGradient(-bodyW, -bodyH, bodyW, 0);
    bodyGrad.addColorStop(0, hideDark);
    bodyGrad.addColorStop(0.5, hideColor);
    bodyGrad.addColorStop(1, hideLight);
    ctx.fillStyle = bodyGrad;
    roundedBody(0, -bodyH * 0.45, bodyW, bodyH, s);

    // spine highlight
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = s * 0.12;
    ctx.beginPath(); ctx.moveTo(0, -bodyH * 0.9); ctx.lineTo(0, -bodyH * 0.1); ctx.stroke();

    // haunch muscle dimples
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.beginPath(); ctx.ellipse(-bodyW * 0.45, -bodyH * 0.35, s * 0.5, s * 0.7, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bodyW * 0.45, -bodyH * 0.35, s * 0.5, s * 0.7, -0.2, 0, Math.PI * 2); ctx.fill();

    // ---- jetpack strapped to the back ----
    if (g.jetT > 0) {
      ctx.save();
      // two tanks
      for (const tx of [-0.5, 0.5]) {
        ctx.fillStyle = "#d9dde2";
        roundRect(tx * bodyW * 0.9 - s * 0.22, -bodyH * 0.78, s * 0.44, bodyH * 0.6, s * 0.2);
        ctx.fill();
        ctx.fillStyle = "#ff5b3a";
        ctx.fillRect(tx * bodyW * 0.9 - s * 0.22, -bodyH * 0.5, s * 0.44, s * 0.18);
        // nozzle flame (flicker via run phase)
        const fl = s * (0.5 + 0.25 * Math.abs(Math.sin(run * 6 + tx)));
        const ng = ctx.createLinearGradient(0, -bodyH * 0.18, 0, -bodyH * 0.18 + fl);
        ng.addColorStop(0, "rgba(255,230,120,0.95)");
        ng.addColorStop(1, "rgba(255,80,30,0)");
        ctx.fillStyle = ng;
        ctx.beginPath();
        ctx.moveTo(tx * bodyW * 0.9 - s * 0.16, -bodyH * 0.18);
        ctx.lineTo(tx * bodyW * 0.9 + s * 0.16, -bodyH * 0.18);
        ctx.lineTo(tx * bodyW * 0.9, -bodyH * 0.18 + fl);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // ---- head + horns (peeking up over the shoulders) ----
    ctx.save();
    ctx.translate(0, -bodyH * 0.95);
    const headBob = Math.sin(run) * s * 0.08;
    ctx.translate(0, headBob);

    // neck
    ctx.fillStyle = hideColor;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.4, bodyW * 0.42, s * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // head
    const headW = bodyW * 0.62, headH = s * 1.1;
    const headGrad = ctx.createLinearGradient(0, -headH, 0, headH);
    headGrad.addColorStop(0, hideLight);
    headGrad.addColorStop(1, hideColor);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.1, headW, headH, 0, 0, Math.PI * 2);
    ctx.fill();

    // ears
    ctx.fillStyle = hideDark;
    ctx.beginPath(); ctx.ellipse(-headW * 0.95, -s * 0.2, s * 0.34, s * 0.22, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(headW * 0.95, -s * 0.2, s * 0.34, s * 0.22, -0.5, 0, Math.PI * 2); ctx.fill();

    // horns — big curving ivory horns
    ctx.strokeStyle = "#efe6cf"; ctx.lineWidth = s * 0.28; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-headW * 0.7, -headH * 0.5);
    ctx.quadraticCurveTo(-headW * 1.7, -headH * 1.1, -headW * 1.5, -headH * 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headW * 0.7, -headH * 0.5);
    ctx.quadraticCurveTo(headW * 1.7, -headH * 1.1, headW * 1.5, -headH * 1.7);
    ctx.stroke();
    // horn tips
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath(); ctx.arc(-headW * 1.5, -headH * 1.7, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(headW * 1.5, -headH * 1.7, s * 0.16, 0, Math.PI * 2); ctx.fill();

    // angry eyes (from behind, slightly visible on the sides)
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(-headW * 0.5, -s * 0.25, s * 0.16, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(headW * 0.5, -s * 0.25, s * 0.16, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(-headW * 0.5, -s * 0.22, s * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(headW * 0.5, -s * 0.22, s * 0.08, 0, Math.PI * 2); ctx.fill();

    ctx.restore(); // head

    ctx.restore(); // body scale

    // snort puffs when running fast
    if (!g.rolling && g.speed > 26 && Math.random() < 0.08) {
      spawnSpark(x + rand(-0.3, 0.3), g.y + 1.6, 0.6, "rgba(255,255,255,");
    }

    ctx.restore(); // translate/rotate
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function roundedBody(x, y, w, h, s) {
    const r = s * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - w + r, y - h);
    ctx.lineTo(x + w - r, y - h);
    ctx.quadraticCurveTo(x + w, y - h, x + w, y - h + r);
    ctx.lineTo(x + w, y - r);
    ctx.quadraticCurveTo(x + w, y, x + w - r, y);
    ctx.lineTo(x - w + r, y);
    ctx.quadraticCurveTo(x - w, y, x - w, y - r);
    ctx.lineTo(x - w, y - h + r);
    ctx.quadraticCurveTo(x - w, y - h, x - w + r, y - h);
    ctx.closePath();
    ctx.fill();
  }

  // --------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function show(el, on) { el.classList.toggle("hidden", !on); }
  function shade(hex, amt) {
    // hex like #rrggbb or rgb color words won't work; expect hex
    if (hex[0] !== "#") return hex;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // ----------------------------------------------------------- main loop
  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------- boot
  resize();
  toMenu();
  els.startBest.textContent = fmt(best);
  requestAnimationFrame(frame);
})();
