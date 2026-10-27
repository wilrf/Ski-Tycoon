# Summit Tycoon

A ski resort tycoon game for the browser, on desktop and phone. Build lifts, draw runs down a procedurally generated mountain, and watch skiers decide where to go.

**Play:** https://wilrf.github.io/ski-tycoon/

This is Milestone 1, the core toy: one mountain, three lift types, runs whose colour comes from the terrain, and skier agents with skill, happiness, energy and thoughts.

## How to play

- **Lifts:** pick Tow, Chair or Gondola, tap a bottom station, then a top station. The panel shows length, vertical rise and cost before you confirm. Skiers only arrive once a lift starts in the flat base area.
- **Runs:** pick Run and tap points down the mountain, starting near a lift's top station and ending at a lift's bottom station or the base. The colour updates live from the steepest stretch.
- **Inspect:** with Select, tap a skier, lift or run. Lifts and runs can be removed (lifts refund half their cost).
- **Camera:** drag to pan, scroll or pinch to zoom.
- **Keys:** Space pause, 1/2/3 speed, V select, T tow, C chair, G gondola, R run, Enter confirm, Backspace undo point, Delete remove, Esc cancel.

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
    world.ts      top-level state (company, calendar, resorts), tick(), commands
    terrain.ts    height map generation, slope, terrain types
    lifts.ts      lift planning and validation, boarding and queues
    runs.ts       run profiles, difficulty from slope, ratings
    network.ts    which runs and lifts connect
    skiers.ts     skier agents: decisions, movement, thoughts
    economy.ts    company money: construction, refunds, tickets
    rng.ts        seeded RNG
    geometry.ts   vector and polyline helpers
  render/         canvas drawing only (camera, baked terrain image, frame)
  ui/             DOM panels: HUD, toolbar, inspector, tool state
  input/          pointer (mouse, touch, pinch) and keyboard
  save/           versioned save format and migrations
tests/            Vitest unit tests for the simulation and saves
```

**The simulation never touches the DOM.** `World` is plain data (no classes, no closures), so it serializes straight to JSON for saves, and the tests run it headless, including a full simulated day. The UI changes the world only through typed `Command`s (`buildLift`, `removeRun`, ...), which validate and return a reason when they fail.

**Fixed timestep.** The sim advances in ticks of 3 game seconds, 10 ticks per real second at 1×. The render loop runs at the display's frame rate and interpolates skier positions between ticks. Speed (pause, 1×, 2×, 4×) only changes how many ticks run per real second, so results don't depend on frame rate or speed.

**Reproducible.** Terrain comes from a seed, and all sim randomness draws from a seeded RNG whose state lives in the world. The same seed and the same commands give the same game, which the tests check.

**Connections are spatial.** A run starts at any lift whose top station is within 40 m of its first point, and ends at any lift whose bottom station is within 40 m of its last point. The base area is one hub. Nothing is stored, so removing a lift or run can't leave a stale link; skiers who lose their lift or run just decide again.

**Difficulty comes from the terrain.** A run's colour is set by its steepest stretch, measured as the drop along the path over a 20 m window: green up to 25% grade, blue up to 40%, black up to 60%, double black beyond. Traversing across a slope makes a run easier, as cat tracks do on real mountains.

**Saves are versioned.** Each save stores a `version`. Loading runs it through `MIGRATIONS[n]` (version n to n + 1) until it reaches the current version, so later milestones can change the world's shape and still load old saves. Saves from a newer version are refused instead of half-loaded.

## Why Canvas 2D and no game engine

The game is a top-down map with a few hundred dots and lines, which Canvas 2D draws easily at 60 fps on a phone. An engine like Phaser or Pixi would add a large dependency, its own scene graph and update loop, and pull game logic toward engine objects, which works against keeping the simulation pure and testable. With plain Canvas, the renderer is one function that reads the world and draws it. The terrain is baked once into an offscreen image (hillshade plus contours), so each frame is one image draw plus the dynamic objects. If later milestones need thousands of sprites, WebGL can replace the renderer without touching the simulation.
