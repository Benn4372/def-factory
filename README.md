# def factory()

A 2D top-down sandbox factory where every block runs a Python class you write. Order supplies, store them, craft parts, sell them — nothing moves unless your code moves it.

See [DESIGN.md](DESIGN.md) for the full design and build phases.

## Status

**Phase 0 (skeleton) — done.** You can:
- Pick a block from the palette and click (or click-drag) on the grid to place it.
- Drag a placed block to move it.
- Right-click a block (or select it and press Delete) to remove it, refunding what it cost.
- Select a block and rename it in the Inspector. Names must be valid Python identifiers, since they become variables in Phase 1.
- Watch money change: each block type has a few free placements, then costs money.

No code runs yet. Python (terminal + safety) arrives in Phase 1.

## Running locally

ES modules need an HTTP server (opening `index.html` as a file won't work):

```bash
python -m http.server 8173
```

Then open http://localhost:8173.

## Project layout

```
index.html, style.css
js/
  config.js        prices, free counts, grid size — all tunable numbers
  world.js         blocks, placement rules, money, naming
  main.js          boot and wiring
  ui/
    canvas.js      grid rendering and mouse/keyboard input
    palette.js     block palette
    panels.js      side panel tabs and Inspector
```

## Deploying

Plain static files with no build step; serve the repo root with GitHub Pages.
