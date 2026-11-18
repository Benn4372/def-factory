"""Player-facing Python runtime (runs inside the Pyodide worker).

Phase 1: the terminal REPL, block objects mirrored from the layout, and the
player's global namespace. Block behavior, the game clock and programs arrive
in later phases (DESIGN.md §14).
"""

import asyncio
import traceback

from pyodide.code import eval_code_async

import safety
from safety import SafetyError, TooLongWithoutAwait, watchdog

N, S, E, W = "north", "south", "east", "west"

CLASS_NAMES = {
    "source": "Source", "belt": "Belt", "splitter": "Splitter", "merger": "Merger",
    "warehouse": "Warehouse", "crafter": "Crafter", "sell": "Sell",
}


# --------------------------------------------------------------------- blocks

class Block:
    """A placed block as seen from Python. Name, kind and position mirror the
    layout and are read-only from code; any other attribute you set is kept on
    the object (per-block state, e.g. `belt_3.direction = "north"`)."""

    _READ_ONLY = {"name", "kind", "pos", "x", "y", "id"}

    def __init__(self, data):
        object.__setattr__(self, "_data", {})
        self._update(data)

    def _update(self, data):
        self._data.update(data)

    @property
    def name(self): return self._data["name"]

    @property
    def kind(self): return self._data["kind"]

    @property
    def x(self): return self._data["x"]

    @property
    def y(self): return self._data["y"]

    @property
    def pos(self): return (self.x, self.y)

    @property
    def id(self): return self._data["id"]

    def __setattr__(self, key, value):
        if key in self._READ_ONLY:
            hint = " Rename blocks in the Inspector." if key == "name" else " Drag the block to move it."
            raise AttributeError(f"`{key}` is read-only.{hint if key in ('name', 'x', 'y', 'pos') else ''}")
        object.__setattr__(self, key, value)

    def __repr__(self):
        return f"<{CLASS_NAMES.get(self.kind, self.kind)} {self.name} at {self.pos}>"


_by_id = {}          # layout id -> Block
blocks = {}          # name -> Block (exposed to the player)
G = {}               # the player's global namespace
_money = [0]


def sync(layout):
    """Called by the worker whenever the layout changes in the UI."""
    layout = layout.to_py() if hasattr(layout, "to_py") else layout
    seen = set()
    for data in layout["blocks"]:
        bid = data["id"]
        seen.add(bid)
        b = _by_id.get(bid)
        if b is None:
            b = _by_id[bid] = Block(data)
        else:
            old = b.name
            b._update(data)
            if old != b.name and G.get(old) is b:
                del G[old]
    for bid in list(_by_id):
        if bid not in seen:
            gone = _by_id.pop(bid)
            if G.get(gone.name) is gone:
                del G[gone.name]
    blocks.clear()
    for b in _by_id.values():
        blocks[b.name] = b
        G[b.name] = b
    _money[0] = layout["money"]
    G["money"] = layout["money"]


# ------------------------------------------------------------------- globals

async def wait(seconds):
    """Pause for `seconds`. (Real time in Phase 1; game time from Phase 2.)"""
    if not isinstance(seconds, (int, float)) or seconds < 0:
        raise ValueError("wait() needs a number of seconds >= 0")
    await asyncio.sleep(seconds)


def _help(*args):
    print(
        "def factory() terminal\n"
        "  blocks            dict of every block by name\n"
        "  <block name>      e.g. warehouse_1 — every block is a variable\n"
        "  money             your current money\n"
        "  await wait(s)     pause for s seconds (top-level await works here)\n"
        "  Shift+Enter: new line · Enter on an empty line runs a block · Ctrl+C: stop · Ctrl+L: clear\n"
        "Block behavior (classes) arrives in Phase 2."
    )


def _reset_namespace():
    G.clear()
    G.update({
        "__name__": "__main__",
        "blocks": blocks,
        "wait": wait,
        "help": _help,
        "N": N, "S": S, "E": E, "W": W,
        "money": _money[0],
    })
    for b in _by_id.values():
        G[b.name] = b


_reset_namespace()


# ---------------------------------------------------------------------- REPL

_current = None  # the running terminal task, so Ctrl+C can cancel it


def _format_error(e):
    """One or two readable lines: where in the player's code, and what."""
    tb = traceback.extract_tb(e.__traceback__)
    player = [f for f in tb if f.filename.startswith(safety.PLAYER_PREFIXES)]
    where = f"line {player[-1].lineno}: " if player else ""
    name = type(e).__name__
    msg = str(e)
    return f"{where}{name}: {msg}" if msg else f"{where}{name}"


MAX_REPR = 4000


async def _run(src):
    # The watchdog stays armed afterwards: tasks the player spawned keep being
    # watched when the event loop resumes them.
    watchdog.arm()
    value = await eval_code_async(src, G, filename="<terminal>", return_mode="last_expr")
    if value is None:
        return None
    r = repr(value)  # may run a player __repr__, so it stays inside the watched task
    return r if len(r) <= MAX_REPR else r[:MAX_REPR] + f"… ({len(r) - MAX_REPR} more characters)"


async def repl(src):
    """Run one terminal submission. Returns a dict for the UI."""
    global _current
    try:
        safety.check(src, filename="<terminal>")
    except SafetyError as e:
        return {"ok": False, "kind": "refused", "error": str(e)}

    task = asyncio.ensure_future(_run(src))
    _current = task
    try:
        text = await task
    except asyncio.CancelledError:
        return {"ok": False, "kind": "cancelled", "error": "KeyboardInterrupt: stopped"}
    except (TooLongWithoutAwait, SafetyError) as e:
        return {"ok": False, "kind": "watchdog", "error": _format_error(e)}
    except BaseException as e:  # noqa: BLE001 — player errors must never escape
        return {"ok": False, "kind": "error", "error": _format_error(e)}
    finally:
        _current = None

    return {"ok": True, "repr": text}


def cancel():
    if _current is not None and not _current.done():
        _current.cancel()
        return True
    return False
