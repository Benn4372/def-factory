# def factory() — Proof of Concept Design Document

**Status:** Draft v1 · 2026-11-18 · Phases 0–1 complete
**Platform:** Browser (GitHub Pages), vanilla JS + Pyodide
**Scope:** Proof of concept (PoC). Future ideas are listed in §14 and are explicitly *out of scope*.

---

## 1. Pitch

A 2D, top-down sandbox factory where **every block runs a Python class that you write**. You order raw supplies, store them, craft them into parts, and sell them. Nothing moves unless your code moves it. A belt is a two-line class; a warehouse is a real program where the quality of your search algorithm decides how fast you ship.

### Design pillars

1. **Code is the only control.** Placing a block gives you an object with no behavior. Its class decides everything.
2. **Simple things are simple, hard things are hard.** A belt's class is trivial. A warehouse's class grows with your skill: a `for` loop first, a hash map later.
3. **Algorithms pay off visibly.** Expensive operations (like looking into a warehouse slot) cost game time, so better code means a visibly faster factory.
4. **Open sandbox.** No objectives, no score. Money is the only constraint.
5. **Never crash the browser.** Bad code stops a block, never the game.

---

## 2. PoC scope

### In scope
- One grid map, place / move / delete / rename blocks.
- Seven block types: **Source, Belt, Splitter, Merger, Warehouse (2×2), Crafter, Sell**.
- One Python class per block type, written by the player from an empty template.
- A **terminal** (Python REPL) and a **Programs** tab (`async def main()` with Run/Stop).
- Money, purchases, fixed recipes, fixed prices.
- Continuous simulation with pause and speed control; editing while running.
- A safety layer (pre-run check + runtime watchdog).
- A closable in-game **Guide** panel with API reference and code examples.

### Out of scope (PoC)
Subclassing, access-controlled APIs, save/load, objectives/contracts, scoring, stack/queue access rules for warehouses, robots, 3D, sound.

---

## 3. Core loop

```
order supplies (code) → Source → belts → Warehouse (store / find / ship)
     → belts → Crafter (craft_x()) → belts → Sell → money → order more / build more
```

1. A program or the terminal calls `source_1.order("iron", 10)`. Money is deducted.
2. After 5 seconds, crates appear at the Source one at a time.
3. The Source's class pushes each crate onto an adjacent belt.
4. Belt classes move crates along to a Warehouse, whose class stores them in slots.
5. A program (or the warehouse itself) finds the right items and ships them onto belts toward a Crafter.
6. The Crafter is told to `craft_gear()`; the result is pushed onto a belt toward Sell.
7. The Sell block's class sells it. Money goes up. Repeat, then automate.

---

## 4. World

| Property | Value |
|---|---|
| Grid | 24 × 16 tiles |
| Tile size | 40 px (canvas 960 × 640, scaled to fit) |
| Footprint | All blocks 1×1 except Warehouse (2×2) |
| Directions | `"north"`, `"south"`, `"east"`, `"west"` (also constants `N`, `S`, `E`, `W`) |
| Coordinates | `(x, y)`, origin top-left; for the Warehouse, its top-left tile |

### Player actions on the map
- **Place:** pick a block from the palette, click a tile. Costs money unless a free one remains (§6). The block gets an auto name (`belt_7`) and its class's `on_place()` runs.
- **Move:** drag a block. Its instance state (attributes) is kept; items it held vanish.
- **Delete:** right-click (or select + Delete key). Refunds whatever placing one more of that type would cost right now, so place-then-delete is always net zero (deleting a block that was free refunds $0 and gives the free slot back). Items it held vanish.
- **Rename:** in the inspector. Names must be valid Python identifiers, unique, and not a keyword or builtin.
- **Inspect:** click a block to see its name, class, attributes, held items, status (OK / error), and for a Warehouse, a visual of its slots.

All actions are allowed while the simulation runs.

---

## 5. Items and recipes

Items are objects with a read-only `name` (e.g. `"iron"`) and a unique `id`. All values below live in `js/config.js` and are expected to be tuned.

### Raw materials

| Item | Buy price | Sell price |
|---|---|---|
| iron | $2 | $1 |
| copper | $3 | $1 |
| wood | $1 | $0.50 |

### Recipes (fixed, visible in Guide, not editable)

| Method | Inputs | Time | Sell price |
|---|---|---|---|
| `craft_gear()` | 2 iron | 2 s | $7 |
| `craft_spring()` | 1 iron | 1 s | $4 |
| `craft_wire()` | 1 copper | 1 s | $5 |
| `craft_plank()` | 1 wood | 1 s | $2 |
| `craft_motor()` | 1 gear + 2 wire | 4 s | $30 |
| `craft_clock()` | 1 gear + 1 spring + 1 plank | 4 s | $25 |

Any Crafter can run any recipe. Everything is sellable; raw materials sell at a loss.

---

## 6. Economy

| Setting | Value |
|---|---|
| Starting money | $500 |
| Order shipping fee | $5 per `order()` call (rewards batching) |
| Order delay | 5 s, then 1 crate every 0.5 s |
| Refunds | Deleting a paid block refunds its full price |

| Block | Free | Price after free ones |
|---|---|---|
| Source | 1 | $200 |
| Warehouse | 1 | $150 |
| Crafter | 2 | $100 |
| Sell | 1 | $100 |
| Belt | 20 | $2 |
| Splitter | 2 | $20 |
| Merger | 2 | $20 |

Money can't go negative: an `order()` or placement you can't afford fails (returns `False` / shows a message).

---

## 7. Blocks

### 7.1 Object model

- Each block **type** has exactly one **class**, written by the player (e.g. `class Belt:`).
- Each placed block is an **instance** of that class. Per-block state lives on the instance (`self.direction = "east"`), so twenty belts share one class but each has its own direction.
- Instance attributes can be set from the class (`on_place`), from the terminal, or from a program: `belt_3.direction = "north"`.
- The engine supplies built-in attributes and methods on every instance (below). Player methods and attributes are added freely.
- Any block can find any other by name (§8.3), but **items only move between adjacent blocks**.

### 7.2 Built-ins on every block

| Member | Description |
|---|---|
| `self.name` | Block name (read-only from code; rename in UI) |
| `self.kind` | `"belt"`, `"warehouse"`, … |
| `self.pos` | `(x, y)` |
| `self.neighbor(direction)` | Adjacent block or `None` (Warehouse: use `self.neighbors()`) |
| `self.neighbors()` | List of all adjacent blocks |
| `self.items` | Items this block currently holds (read-only list; not for Warehouse slots) |
| `self.push(item, target)` | Send a held item to an adjacent block. `target` is a direction, a block, or a block name. See §7.3. |

### 7.3 Movement rules

- `push(item, target)` is a **move request**. It returns `True` if the request is accepted (item is held, target is adjacent and a legal receiver), otherwise `False` with the reason printed to the terminal.
- If the target is currently full, the item **waits** and moves automatically when space frees. This is how back-ups form.
- The item travels for 0.5 s (animated) and on arrival the target's `on_receive(item)` hook is called.
- If a block's class never pushes an item, the item just sits there, blocking that block. That is the player's bug to find.
- **Who can push into what:**
  - Source, Warehouse and Crafter may only push onto a **Belt, Splitter or Merger** (never directly into each other).
  - Belt, Splitter and Merger may push into any block that accepts it.
- **Who accepts from which side:**
  - **Belt:** only from directly behind it (the side opposite `self.direction`).
  - **Splitter:** only from behind.
  - **Merger:** from behind and both sides.
  - **Warehouse, Crafter, Sell:** from any side.
- `can_accept(self, item, from_direction)` is an optional hook on every class. Return `False` to refuse an item (it waits upstream). Default: accept if there's room.

### 7.4 Hooks

Hooks may be `def` or `async def`. Async hooks run as background tasks.

| Hook | When it fires |
|---|---|
| `on_place(self)` | Block placed (not on move) |
| `on_receive(self, item)` | An item arrives |
| `can_accept(self, item, from_direction)` | Before an item is delivered (must be sync, must be fast) |
| `on_craft_done(self, item)` | Crafter only: an item finished |

### 7.5 Block reference

#### Source (1×1)
Where ordered supplies arrive.
- `order(item_name, qty)` → `True`/`False`. Deducts `qty × price + $5`. After 5 s, crates enter a **hidden arrival queue**, one every 0.5 s (unlimited, shown as a count badge).
- The Source holds **one** crate at a time. When it's empty, the next queued crate moves in and `on_receive(item)` fires. The class must push it onto a belt.
- `queued()` → number of crates waiting.

#### Belt (1×1)
- Holds 1 item. Must have `self.direction` set before it can push (an arrow is drawn; a belt with no direction shows a "?" badge).
- `push(item, self.direction)` is the only legal push.

Minimal class:
```python
class Belt:
    def on_place(self):
        self.direction = "east"

    def on_receive(self, item):
        self.push(item, self.direction)
```

#### Splitter (1×1)
- Holds 1 item. Has `self.direction` (its front). Accepts from behind; may push to front, left or right.

#### Merger (1×1)
- Holds 1 item. Has `self.direction`. Accepts from behind and both sides; may only push to the front. Priority is up to `can_accept`.

#### Warehouse (2×2)
- **40 slots**, indexed `0–39`. Plus a 1-item **intake**.
- Arriving items land in the intake and `on_receive(item)` fires. Until the item is stored, the intake is full and further deliveries wait.
- `store(item, slot)` → `True`/`False`. Instant. Fails if the slot is occupied.
- `await look(slot)` → item or `None`. **Costs 0.1 s of game time.** This is the deliberate cost that makes search algorithms matter.
- `ship(slot, target)` → `True`/`False`. Removes the item from the slot and pushes it to an adjacent belt (by name or block). Same waiting rules as `push`.
- `capacity` → 40.
- There is no free "count" or "find" built in. Keeping track of what is where is the player's job; a Python dict on `self` is free to use, so an index is the obvious upgrade.

Example progression a player might write:
```python
class Warehouse:
    def on_receive(self, item):
        self.store(item, self.next_free())   # player-written helper

    async def ship_item(self, name, belt):
        for i in range(self.capacity):        # v1: linear search, 0.1 s per look
            item = await self.look(i)
            if item and item.name == name:
                return self.ship(i, belt)
        return False
```
```python
        # v2: maintain self.where = {"iron": [3, 7, 12]} in on_receive; no looks needed
```

#### Crafter (1×1)
- Input inventory: up to **10 items** (any mix). `self.inputs` → dict of counts, e.g. `{"iron": 3}` (free to read).
- `craft_<recipe>()` → `True` if crafting started, `False` if inputs are missing or it's busy (reason printed).
- `busy` → `True` while crafting.
- On completion the item goes to an output buffer (up to **5 items**) and `on_craft_done(item)` fires. Most classes will push it straight onto a belt.

#### Sell (1×1)
- Accepts from any side. `on_receive(item)` must call `self.sell(item)` to get paid. Unsold items sit and block.
- `sell(item)` → price received.

### 7.6 Empty templates
Every class starts as a skeleton with the hooks stubbed out and a short comment pointing to the Guide. Nothing works until the player writes it:
```python
class Belt:
    def on_place(self):
        pass

    def on_receive(self, item):
        pass
```

---

## 8. Programs, terminal, and globals

### 8.1 Terminal
- A Python REPL docked at the bottom. Supports top-level `await`.
- Used for one-off commands: `source_1.order("iron", 10)`, `belt_3.direction = "north"`, `money`, `run("restock")`.
- Shows all `print()` output from every script, tagged: `[warehouse_1] stored iron in slot 4`.
- Shows errors with block name, class, and line number.

### 8.2 Programs tab
- Named scripts, each must define `async def main():`.
- **Run / Stop** buttons and a running indicator per program. Many programs can run at once.
- Also controllable from the terminal: `run("restock")`, `stop("restock")`.

Example automation:
```python
async def main():
    while True:
        if warehouse_1.iron_count() < 10:     # player-written method
            source_1.order("iron", 20)
        await wait(2)
```

### 8.3 Globals (available in terminal, programs, and classes)

| Name | Description |
|---|---|
| `<block name>` | Every block by its name, e.g. `warehouse_1` (updates on rename) |
| `blocks` | Dict of all blocks by name |
| `money` | Current money (read-only) |
| `await wait(seconds)` | Pause for game seconds (respects pause and speed) |
| `time()` | Current game time in seconds |
| `RECIPES`, `PRICES` | Read-only reference data |
| `run(name)`, `stop(name)` | Start / stop programs |
| `print(...)` | To the terminal |

---

## 9. Simulation

- **Continuous** to the player: smooth animation, no visible ticks.
- Internally a **fixed step of 20 Hz** (game time), so behavior is consistent and `wait()` is exact.
- Controls: **Pause**, **1×**, **2×**, **4×**. Paused = no game time passes; `wait()` doesn't complete; hooks don't fire. Terminal still works.
- Hooks and program tasks are scheduled by the engine's own event loop (game-time based).

### Editing while running
- **Saving a class** re-defines it and hot-swaps it onto every existing instance. Instance attributes are kept. If the new code fails the pre-check or has a syntax error, the old class keeps running and the error is shown.
- **Moving or deleting** a block: items it held, and items in transit to/from it, vanish.
- **Renaming**: the global name updates immediately; code still using the old name gets a `NameError` (the player's bug).
- Anything else that would put the world in an invalid state: the affected item disappears.

---

## 10. Safety ("never crash the browser")

A perfect "will this hang?" check is impossible (the halting problem), so there are two layers.

### 10.1 Pre-run check (static, on save / run)
Parse with Python's `ast` and refuse to run with a clear message and line number for:
- Syntax errors.
- A `while` loop whose condition is always true (`while True:`, `while 1:`) with no `await` and no `break` in its body. Other `while` loops (e.g. `while i < n`) are allowed through and left to the runtime watchdog, so legitimate finite loops aren't refused.
- `sleep()` calls (use `await wait()`), importing `js`, `pyodide` or `micropip`, and touching `settrace` / `setprofile` / `setrecursionlimit`.
- Programs without `async def main()`.
- Classes whose name doesn't match the block type.

### 10.2 Runtime watchdog
- **Time budget:** any single run of player code that executes for more than **50 ms of real time without yielding** raises `TooLongWithoutAwait` (implemented via a `sys.settrace` instruction/time check). The block halts; the program stops.
- **Recursion limit:** 150 nested player-code calls (counted by the watchdog, so Pyodide's own stack isn't affected).
- **Output limit:** terminal print rate capped (excess lines dropped with a notice).
- **Isolation:** Pyodide and the simulation run in a **Web Worker**. The UI thread never runs player code, so the page always stays responsive. If the worker stops responding for 3 s anyway, the UI terminates and restarts it, restoring the layout, classes, programs and instance attributes from the last snapshot (items in the world are lost) and shows a message. *(Phase 1 restores only the layout; terminal variables and block attributes are lost. Snapshotting classes, programs and instance attributes comes with Phase 2/4, when they exist.)*

### 10.3 Errors
- A block whose hook raises turns **red**, stops firing hooks, and shows the error in the inspector and terminal. Other blocks keep running.
- Fixing and saving the class clears the error on all affected blocks (they resume).
- A program that raises stops and shows the error.

---

## 11. UI layout

```
┌──────────────────────────────────────────────────────────────────┐
│ def factory()   $482.50   ⏸ 1× 2× 4×   t = 03:14        [Guide]  │
├────────┬──────────────────────────────────────┬──────────────────┤
│Palette │                                      │ Side panel       │
│ Source │            Grid canvas               │ (closable)       │
│ Belt   │                                      │ Tabs:            │
│ Split  │                                      │  Classes         │
│ Merge  │                                      │  Programs        │
│ Wareh. │                                      │  Inspector       │
│ Craft  │                                      │  Guide           │
│ Sell   │                                      │                  │
├────────┴──────────────────────────────────────┴──────────────────┤
│ Terminal  >>> source_1.order("iron", 10)                          │
└──────────────────────────────────────────────────────────────────┘
```

- **Palette:** block, price, free remaining.
- **Classes tab:** one editor per block type (7). Save with Ctrl+S. Error markers in the gutter.
- **Programs tab:** list + editor + Run/Stop.
- **Inspector:** selected block's details; rename field.
- **Guide:** see §12.
- **Art:** flat colored tiles with simple icons, items as small labeled squares, belt arrows, red outline for errors.

---

## 12. Coding guide (in-game panel)

Closable, searchable, every example has a **Copy** button. Content lives in `guide/*.md`, rendered in the panel.

1. **Getting started:** your first belt, getting a crate from Source to Sell (complete walkthrough).
2. **Classes and objects:** one class per block type; each block is an object; `self` and instance attributes.
3. **Moving items:** `push`, adjacency, who accepts from where, back-ups.
4. **Block reference:** one page per block (§7.5).
5. **Terminal and programs:** REPL, `async def main()`, `run`/`stop`.
6. **Waiting and loops:** why `await wait()`, what the safety check refuses and why.
7. **Recipes and prices.**
8. **Errors:** reading tracebacks, red blocks, fixing and resuming.
9. **Ideas to improve:** hints only, no solutions: "your warehouse looks at every slot — could it remember where things are?", "can a Splitter route by item name?", "automate reordering".

---

## 13. Technical architecture

### 13.1 Stack
- Vanilla JS ES modules, HTML Canvas, CSS. No build step (matches existing projects).
- **Pyodide** (pinned version, from the jsDelivr CDN) inside a Web Worker.
- **CodeMirror 5** (pinned, from cdnjs) with Python mode for editors and the terminal input.
- Hosted on **GitHub Pages** from `main`.

### 13.2 Threads

```
Main thread (UI)                         Worker (simulation)
───────────────                          ──────────────────
render canvas  ◄── state snapshot (≈30/s) ── JS engine: world, items,
palette, panels                              movement, economy, clock
editors, terminal ── commands ─────────────► Pyodide: player classes,
inspector          ◄── print / errors ──────  programs, REPL, safety
watchdog (3 s heartbeat)
```

- The engine (JS) and Pyodide share the worker, so hook calls are synchronous function calls, not messages.
- The UI holds the authoritative copy of **source code and layout** for crash recovery.

### 13.3 File layout

```
def-factory/
├── index.html
├── style.css
├── js/
│   ├── main.js              # boot, wiring
│   ├── config.js            # prices, recipes, timings, costs
│   ├── world.js             # layout model: blocks, placement, money, naming (UI copy)
│   ├── ui/
│   │   ├── canvas.js        # grid rendering, animation interpolation
│   │   ├── palette.js
│   │   ├── panels.js        # tabs: classes, programs, inspector, guide
│   │   ├── editor.js        # CodeMirror setup
│   │   └── terminal.js
│   ├── bridge.js            # worker messaging, watchdog, restart
│   │   (ui/terminal.js: the REPL; py/runtime.py also holds block objects)
│   └── worker/
│       ├── worker.js        # entry: loads Pyodide + engine
│       ├── engine.js        # world, clock, step loop, movement rules
│       ├── blocks.js        # built-in behavior per block type
│       └── economy.js
├── py/
│   ├── runtime.py           # block base proxies, globals, scheduler, wait()
│   ├── safety.py            # ast pre-check, settrace watchdog
│   └── templates/           # empty class templates per block type
├── guide/                   # guide pages (.md)
└── README.md
```

### 13.4 Key implementation notes
- **Hot-swap:** keep instances as Python objects; on class save, `exec` the new class and set `instance.__class__ = NewClass` on each.
- **Built-ins:** injected by having the engine create instances via a hidden base (`_Block`) mixed in, so the player writes `class Belt:` with no base class.
- **`wait()`:** returns a Future resolved by the engine's game clock, not `setTimeout`.
- **`look()`:** `await wait(0.1)` then return the slot contents.
- **Snapshots:** the worker posts positions, items, money and block statuses; the canvas interpolates for smooth motion.

---

## 14. Build phases

Each phase ends with something playable and deployed to GitHub Pages.

### Phase 0: Skeleton ✅
- Repo, GitHub Pages, layout, grid canvas, palette.
- Place / move / delete / rename blocks, money and free counts.
- **Done when:** you can build a layout and see money change. No code runs.

### Phase 1: Python runtime and safety ✅
- Worker + Pyodide loading screen, terminal REPL with top-level `await`, `print` routing.
- Pre-check and watchdog, worker restart.
- **Done when:** `while True: pass` in the terminal is refused, a sneaky infinite loop is stopped in ≤ 50 ms, and the page never freezes.

### Phase 2: Engine, belts and classes
- Clock (20 Hz), pause/speed, items, `push` and adjacency rules, back-ups, animation.
- Classes tab with empty templates, hooks, hot-swap, red-block errors.
- Belt, Splitter, Merger, Sell (with a debug "spawn item" command).
- **Done when:** a player-written belt line carries spawned items to Sell and money goes up.

### Phase 3: Supply chain
- Source with `order()`, delay and hidden queue.
- Warehouse (2×2) with intake, slots, `store`, `await look`, `ship`.
- Crafter with all `craft_*` methods, timers, `on_craft_done`.
- **Done when:** the full loop (order → store → find → craft → sell) works manually from the terminal.

### Phase 4: Programs and automation
- Programs tab, `async def main()`, Run/Stop, `run()`/`stop()`, `wait()`, `time()`.
- **Done when:** a program keeps a factory running unattended and profitably.

### Phase 5: Guide and polish
- Guide panel with all pages and copyable examples, inspector improvements (warehouse slot view), error UX, balancing pass on `config.js`.
- **Done when:** a new player can follow the Guide from empty map to an automated motor factory.

---

## 15. Future (post-PoC)

- Subclassing (`class FragileBelt(Belt)`) and assigning classes per block.
- Public/private block APIs.
- Warehouse access rules (stack-only / queue-only bays) and item properties (fragile, perishable).
- Save/load and export/import.
- Plain `wait()` without `await`.
- Contracts and new imports unlocked over time.
- Robots, more blocks, bigger maps; possibly 3D in a different engine.

---

## 16. Risks and open questions

| Item | Notes |
|---|---|
| Pyodide load time (~10 MB) | Show a loading screen; consider caching via service worker. |
| `settrace` overhead | Could slow heavy scripts; fall back to periodic checks or a coarser instruction count if needed. |
| `await` learning curve | Mitigated by the Guide; revisit plain `wait()` later. |
| Warehouse model | Slots + timed `look()` is the PoC choice; the long-term model is undecided. |
| Balance | All numbers live in `config.js`. |
| Hidden-queue size | Unlimited in PoC; may need a cap if ordering huge amounts becomes an exploit. |
