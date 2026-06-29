# 🐂 BullRun

A lane-based endless runner set on the railways — **you're a charging bull.** Weave between three tracks, leap over barriers, roll under them, jump onto and ride the roofs of subway trains, scoop up coins, and grab power-ups while the world scrolls faster and faster.

> **Note on originality:** *Subway Surfers* is a trademark of SYBO Games and its art, characters, and branding are copyrighted. BullRun is **not** a copy of that game's assets — it's an original, from-scratch game in the same *genre*. Every visual is drawn procedurally in code (no ripped sprites, no third-party assets) and the star is an original cartoon bull.

## Play it

No build step, no dependencies. Either:

- **Just open it:** double-click `index.html` (it runs straight from `file://`), **or**
- **Serve it** (recommended for mobile testing):
  ```bash
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

On a big screen the game presents itself as a centered portrait "card" with a backdrop; on phones it fills the whole screen. The in-game UI scales to the card, not the monitor.

## Deploy to Vercel

It's a fully static site (no build step, no dependencies), so deploying is instant.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/frieshimself-cpu/bullrun)

**Or from the CLI:**

```bash
npm i -g vercel       # once
vercel                # preview deploy from the project root
vercel --prod         # production deploy
```

**Or from the dashboard:** import the repo at [vercel.com/new](https://vercel.com/new) — there's nothing to configure. Framework preset is **Other**, build command **empty**, and the output is the repo root. `vercel.json` is included (clean URLs + sensible cache/security headers).

## Controls

| Action        | Keyboard            | Touch            |
| ------------- | ------------------- | ---------------- |
| Change lane   | `←` / `→` (or A/D)  | swipe left/right |
| Jump          | `↑` / `Space` (W)   | swipe up / tap   |
| Roll / slide  | `↓` (S)             | swipe down       |
| Pause         | `P`                 | ❚❚ button         |
| Mute          | `M`                 | ♪ button         |

## Features

- **Pseudo-3D railway** — a real perspective-projection renderer (no libraries): three tracks converging to a vanishing point, a gravel bed with scrolling wooden sleepers and steel rails, a passing **city skyline** with lit windows, parallax clouds and a sun. The camera rises with the bull so jumps and roof-rides read clearly.
- **A hand-coded bull** — muscular haunches, curving ivory horns, animated gallop, plus distinct **jump-tuck** and **roll-squash** poses, a swishing tail, dust kick-ups and angry snorts at speed.
- **Obstacles**, procedurally arranged into *always-solvable* patterns:
  - `JUMP` low barriers — leap them
  - `ROLL` overhead bars — slide under them
  - solid blockers — switch tracks
  - **subway trains** — switch away **or jump on top and ride the roof** (with a coin trail up there for the brave)
- **Coins** in arcs and trails, with a satisfying spin + pickup spark.
- **Power-ups:**
  - 🚀 **jetpack** — blast above everything on a stream of coins
  - 🛹 **hoverboard** — survive a crash and keep charging
  - 👟 **super sneakers** — sky-high jumps
  - 🧲 coin magnet · ×2 score multiplier · 🛡 shield
- **Living world** — a full **day → dusk → night → dawn cycle** as you run: shifting sky gradients, a sun that sets into a cratered moon, stars, and city windows that light up after dark.
- **Combos & milestones** — chained coin pickups build a score multiplier (×2, ×3…), distance milestones pay out bonuses, and floating pop-ups call out power-ups, combos and milestones.
- **Juice:** camera shake, hit flash, particle bursts, jet exhaust, speed lines and a vignette at high velocity, ramping difficulty.
- **Progression:** a persistent **coin bank** and **best score** (saved in `localStorage`), shown on the menu. Pause-on-blur, mute, full touch + keyboard support.

## Project layout

```
index.html      # markup + HUD/overlays
css/style.css   # all styling (HUD, menus, buttons)
js/game.js      # the entire game engine (projection, spawning, physics, rendering, audio)
```

Everything is vanilla HTML/CSS/JS. Sound effects are synthesized live with the Web Audio API — there are no audio files either.

Charge! 🐂💨
