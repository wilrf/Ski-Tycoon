# Summit Tycoon

A ski resort tycoon game for the browser, on desktop and phone. Build lifts, draw runs down a procedurally generated mountain, and watch skiers decide where to go.

**Play:** https://wilrf.github.io/Ski-Tycoon/

Build lifts, paint runs down the mountain, and grow a resort that skiers come back to.

## How to play

- **Open the mountain:** pick Tow, Chair or Gondola, tap a bottom station in the flat base area, then a top station. While placing, the map shows how far you can afford to reach.
- **Runs:** pick Run and drag down the mountain from a lift's top station or from another run. A slope guide tints the ground green, blue, black or red by how steep it is. The end snaps to a lift's bottom station, the base or another run, and the run opens when you let go. Tapping points still works for fine control. Runs can branch off and merge into other runs.
- **Skiers:** emoji pop up when something changes how a skier feels. Tap a skier for their name, visit count and the reasons behind their mood. Fun depends on who's skiing: experts get bored on greens and beginners are scared on blacks.
- **Resort panel (★ Resort or P):** rating, reputation, ticket price (higher means fewer, grumpier skiers), income, the weather forecast, land for sale, active requests, and what skiers are saying today.
- **Progression:** happy skiers come back, and beginners who practise at their level move up a level over a few visits. Every 5 days the *Powder Line* magazine rates the resort 1–5 stars from happiness, variety, size and vertical, and quotes real skiers. New stars pay a bonus and unlock the gondola, lift upgrades (rope tow → T-bar, double → quad → high-speed quad → six-pack bubble, 8 → 10-seat gondola), mountain huts, and land further up the mountain.
- **Requests:** two at a time, such as a ski club wanting three blues off one lift or a lunch rush. Meet one before its deadline for cash and reputation; miss it and reputation drops.
- **Weather:** a forecast for tomorrow is shown each evening. Powder days bring experts and make steep runs better; storms stop exposed lifts high on the mountain (covered lifts keep running); spring slush dulls everything.
- **Food:** a base lodge or a mountain hut at a lift top feeds skiers at lunchtime or when they tire, for money and energy.
- **Speed:** a ski day takes about 4 minutes at 1×, with 3× and 6×. At 3× and 6× only a sample of skiers is drawn. Each day ends with a report that pauses the game.
- **Keys:** Space pause, 1–4 speed, V select, T tow, C chair, G gondola, R run, L lodge, H hut, P resort, U upgrade lift, M menu, Enter confirm, Backspace undo point, Delete remove, Esc cancel.

The game autosaves at the end of each day and when the tab is hidden. Save and Load use the same slot.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # type-check and build to dist/
```

Every push to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## How the code is structured

```
src/
  config.ts       every tunable number: lift specs, speeds, prices, thresholds
  main.ts         boot, wiring, fixed-timestep game loop
  sim/            pure game logic, no DOM
    world.ts      top-level state (company, calendar, weather, resorts), tick(), commands, day reports
    terrain.ts    height map generation, slope, terrain types
    lifts.ts      lift planning and validation, boarding and queues
    runs.ts       run profiles, difficulty from slope, ratings
    network.ts    which runs and lifts connect
    skiers.ts     skier agents: decisions, movement, feelings, meals
    guests.ts     returning guests: loyalty, skill progress
    weather.ts    daily weather and forecast
    progress.ts   magazine reviews, stars, land
    requests.ts   timed goals with rewards
    buildings.ts  lodges and huts
    economy.ts    company money: construction, refunds, tickets
    rng.ts        seeded RNG
    geometry.ts   vector and polyline helpers
  render/         canvas drawing only (camera, baked terrain, frame, gameplay overlay)
  ui/             DOM panels: HUD, toolbar, inspector, tool state, menus, day report
  input/          pointer (mouse, touch, pinch) and keyboard
  save/           versioned save format and migrations
tests/            Vitest unit tests for the simulation and saves
```

**The simulation never touches the DOM.** `World` is plain data (no classes, no closures), so it serializes straight to JSON for saves, and the tests run it headless, including a full simulated day. The UI changes the world only through typed `Command`s (`buildLift`, `removeRun`, ...), which validate and return a reason when they fail.

**Fixed timestep.** The sim advances in ticks of 3 game seconds, 35 ticks per real second at 1×. The render loop runs at the display's frame rate and interpolates skier positions between ticks. Speed (pause, 1×, 3×, 6×) only changes how many ticks run per real second, so results don't depend on frame rate or speed.

**Reproducible.** Terrain comes from a seed, and all sim randomness draws from a seeded RNG whose state lives in the world. The same seed and the same commands give the same game, which the tests check.

**Connections are spatial.** A run starts at any lift whose top station is within 40 m of its first point, and ends at any lift whose bottom station is within 40 m of its last point. The base area is one hub. A run whose first point lies on another run branches off it, and one whose last point lies on another run merges into it; the run graph is cached and rebuilt only when lifts or runs change. Nothing is stored, so removing a lift or run can't leave a stale link; skiers who lose their lift or run just decide again.

**Difficulty comes from the terrain.** A run's colour is set by its steepest stretch, measured as the drop along the path over a 20 m window: green up to 25% grade, blue up to 40%, black up to 60%, double black beyond. Traversing across a slope makes a run easier, as cat tracks do on real mountains.

**Saves are versioned.** Each save stores a `version`. Loading runs it through `MIGRATIONS[n]` (version n to n + 1) until it reaches the current version, so later milestones can change the world's shape and still load old saves. Saves from a newer version are refused instead of half-loaded.

## Why Canvas 2D and no game engine

The game is a top-down map with a few hundred dots and lines, which Canvas 2D draws easily at 60 fps on a phone. An engine like Phaser or Pixi would add a large dependency, its own scene graph and update loop, and pull game logic toward engine objects, which works against keeping the simulation pure and testable. With plain Canvas, the renderer is one function that reads the world and draws it. The terrain is baked once into an offscreen image (hillshade plus contours), so each frame is one image draw plus the dynamic objects. If later milestones need thousands of sprites, WebGL can replace the renderer without touching the simulation.
