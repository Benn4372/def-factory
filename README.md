# def factory()

A 2D top-down sandbox factory where every block runs a Python class you write. Order supplies, store them, craft parts, sell them — nothing moves unless your code moves it.

**Play it:** https://benn4372.github.io/def-factory/

See [DESIGN.md](DESIGN.md) for the full design and build phases.

## Status

**Phase 0 (skeleton) — done.** You can:
- Pick a block from the palette and click (or click-drag) on the grid to place it.
- Drag a placed block to move it.
- Right-click a block (or select it and press Delete) to remove it, refunding what it cost.
- Select a block and rename it in the Inspector. Names must be valid Python identifiers, since they become variables in Phase 1.
- Watch money change: each block type has a few free placements, then costs money.

**Phase 1 (Python runtime and safety) — done.** The terminal at the bottom is a real Python REPL (Pyodide, running in a Web Worker):
- Every block is a Python variable named after it (`warehouse_1`, `belt_3`, …), plus `blocks` (a dict of all of them) and `money`.
- Blocks keep any attributes you set (`belt_1.direction = "north"`). Name and position are read-only.
- Top-level `await` works: `await wait(1)`.
- Multi-line input: Enter after a `:` continues the block, Enter on an empty line runs it. Shift+Enter adds a line, ↑/↓ for history, Ctrl+C stops a running command, Ctrl+L clears.
- `help()` lists what's available.

Safety (the page should never freeze):
- **Pre-run check:** refuses `while True` loops with no `await` and no `break`, importing `js`/`pyodide`, and syntax errors, with the line number.
- **Blocked functions:** `time.sleep()`, `sys.settrace()`, `sys.setprofile()` and `sys.setrecursionlimit()` raise an error however they're reached (`await asyncio.sleep()` is fine).
- **Watchdog:** player code that runs more than 50 ms without an `await` is stopped, including background tasks you start yourself. A player `except Exception:` can't swallow the stop. Recursion deeper than 150 calls is stopped. Output is capped at 200 lines per second and results longer than 4,000 characters are cut short.
- **Restart:** if Python gets stuck where the watchdog can't see (a loop inside C code, like `sum(range(10**11))`), the worker is restarted after 3 seconds. Terminal variables and block attributes are lost; the layout is re-sent.

Block behavior (classes you write) arrives in Phase 2.

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
  bridge.js        talks to the Python worker; heartbeat watchdog and restart
  worker/
    worker.js      Web Worker hosting Pyodide (pinned 0.26.4 from jsDelivr)
  ui/
    canvas.js      grid rendering and mouse/keyboard input
    palette.js     block palette
    panels.js      side panel tabs and Inspector
    terminal.js    Python REPL
py/
  runtime.py       player namespace, block objects, REPL
  safety.py        pre-run check and settrace watchdog
```

## Deploying

Plain static files with no build step. GitHub Pages serves the root of `main`, so every push to `main` redeploys the live site.
