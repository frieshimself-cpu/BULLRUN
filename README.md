# 🐂 Bull Run

An endless runner in the spirit of lane-based "subway runner" games — **but you're a charging bull.** Dodge between three lanes, leap over barriers, roll under bars, scoop up coins, and grab power-ups while the world scrolls faster and faster.

> **Note on originality:** *Subway Surfers* is a trademark of SYBO Games and its art/characters/branding are copyrighted. This is **not** a copy of that game's assets. Bull Run is an original, from-scratch take on the same *genre* — every visual is drawn procedurally in code (no ripped sprites, no third-party assets) and the star is an original cartoon bull.

## Play it

No build step, no dependencies. Either:

- **Just open it:** double-click `index.html` (it runs straight from `file://`), **or**
- **Serve it** (recommended for mobile testing):
  ```bash
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

## Controls

| Action        | Keyboard            | Touch            |
| ------------- | ------------------- | ---------------- |
| Change lane   | `←` / `→` (or A/D)  | swipe left/right |
| Jump          | `↑` / `Space` (W)   | swipe up / tap   |
| Roll / slide  | `↓` (S)             | swipe down       |
| Pause         | `P`                 | ❚❚ button         |
| Mute          | `M`                 | ♪ button         |

## Features

- **Pseudo-3D perspective track** — a real perspective-projection renderer (no libraries), with three lanes converging to a vanishing point, scrolling lane markers, roadside posts, parallax clouds and a sun.
- **A hand-coded bull** — muscular haunches, curving ivory horns, animated gallop cycle, plus distinct **jump-tuck** and **roll-squash** poses, a swishing tail, dust kick-ups and angry snorts at speed.
- **Four obstacle types**, all procedurally arranged into *always-solvable* patterns:
  - `JUMP` low barriers — leap them
  - `ROLL` overhead bars — slide under them
  - full blockers — switch lanes
  - long trains — get out of the lane
- **Coins** in arcs and trails, with a satisfying spin + pickup spark.
- **Power-ups:** 🧲 coin magnet, ×2 score multiplier, 🛡 shield (survives one hit).
- **Juice:** camera shake, hit flash, particle bursts, increasing speed/difficulty.
- **Persistent best score** (saved in `localStorage`), pause-on-blur, mute, and full touch + keyboard support.

## Project layout

```
index.html      # markup + HUD/overlays
css/style.css   # all styling (HUD, menus, buttons)
js/game.js      # the entire game engine (projection, spawning, physics, rendering, audio)
```

Everything is vanilla HTML/CSS/JS. Sound effects are synthesized live with the Web Audio API — there are no audio files either.

Charge! 🐂💨
