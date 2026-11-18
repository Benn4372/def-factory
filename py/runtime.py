"""Player-facing Python runtime (runs inside the Pyodide worker).

Glue between the UI and the engine: the player's global namespace, the
terminal REPL, compiling player classes, and mirroring the layout.
"""

import ast
import asyncio
import builtins
import re

from pyodide.code import eval_code_async

import engine
import safety
from engine import CLASS_NAMES, Block, Item, current_block, format_error, world
from safety import SafetyError, TooLongWithoutAwait, watchdog

N, S, E, W = "north", "south", "east", "west"
G = {}               # the player's global namespace (terminal + classes)
blocks = {}          # name -> block, exposed as `blocks`


# --------------------------------------------------------------------- layout

def sync(layout):
    """Mirror the UI's layout. New blocks get on_place; moved or deleted blocks
    lose whatever they held."""
    layout = layout.to_py() if hasattr(layout, "to_py") else layout
    seen = set()
    created = []
    for data in layout["blocks"]:
        bid = data["id"]
        seen.add(bid)
        b = world.by_id.get(bid)
        if b is None:
            b = world.by_id[bid] = world.make_block(data)
            created.append(b)
        else:
            old = dict(b._data)
            b._data.update(data)
            if old["name"] != b.name and G.get(old["name"]) is b:
                del G[old["name"]]
            if (old["x"], old["y"]) != (b.x, b.y):
                world.drop_items_of(b)
    for bid in list(world.by_id):
        if bid not in seen:
            gone = world.by_id.pop(bid)
            world.drop_items_of(gone)
            if G.get(gone.name) is gone:
                del G[gone.name]
    world.rebuild_tiles()
    blocks.clear()
    for b in world.by_id.values():
        blocks[b.name] = b
        G[b.name] = b
    G["money"] = layout["money"]
    for b in created:
        _run_on_place(b)


def _on_place_signature(b):
    fn = getattr(type(b), "on_place", None)
    code = getattr(fn, "__code__", None)
    return None if code is None else (code.co_code, repr(code.co_consts), code.co_names)


def _run_on_place(b):
    b.__dict__["_on_place_sig"] = _on_place_signature(b)
    watchdog.arm()
    world.call_hook(b, "on_place")


def configure(cfg):
    cfg = cfg.to_py() if hasattr(cfg, "to_py") else cfg
    world.prices = {name: info["sell"] for name, info in cfg["items"].items()}
    world.item_names = set(cfg["items"])


# -------------------------------------------------------------------- classes

_LINE_RE = re.compile(r"line (\d+)")


def save_class(kind, src):
    """Compile a player class and hot-swap it onto every block of that kind.
    On failure the previous class keeps running."""
    name = CLASS_NAMES[kind]
    filename = f"<class:{name}>"
    try:
        tree = safety.check(src, filename=filename)
        if not any(isinstance(n, ast.ClassDef) and n.name == name for n in tree.body):
            raise SafetyError(f"line 1: this code must define `class {name}:`")
        ns = dict(G)  # class bodies see the player's globals...
        watchdog.arm()
        exec(compile(src, filename, "exec"), ns)
        cls = ns[name]
        if not isinstance(cls, type):
            raise SafetyError(f"line 1: `{name}` must be a class")
        cls.__module__ = "__main__"
        # ...and methods keep seeing live globals (new blocks, money, ...).
        for k, v in ns.items():
            if k not in G or k == name:
                G[k] = v
        _rebind_globals(cls)
    except BaseException as e:  # noqa: BLE001
        msg = format_error(e)
        m = _LINE_RE.search(msg)
        return {"ok": False, "error": msg, "line": int(m.group(1)) if m else None}

    world.set_class(kind, cls)
    # on_place runs again on existing blocks only when on_place itself changed,
    # so setting a direction from the terminal survives edits to on_receive.
    for b in list(world.by_id.values()):
        if b.kind == kind and b.__dict__.get("_on_place_sig") != _on_place_signature(b):
            _run_on_place(b)
    return {"ok": True}


def _rebind_globals(cls):
    """Point the class's functions at the shared namespace G so they see
    blocks placed later, renames, and `money` updates."""
    import types
    for attr, fn in list(vars(cls).items()):
        target = fn
        if isinstance(fn, (staticmethod, classmethod)):
            target = fn.__func__
        if isinstance(target, types.FunctionType):
            new = types.FunctionType(target.__code__, G, target.__name__, target.__defaults__, target.__closure__)
            new.__kwdefaults__ = target.__kwdefaults__
            new.__qualname__ = target.__qualname__
            if isinstance(fn, staticmethod):
                new = staticmethod(new)
            elif isinstance(fn, classmethod):
                new = classmethod(new)
            setattr(cls, attr, new)


# ------------------------------------------------------------------- globals

async def wait(seconds):
    """Pause for `seconds` of game time (stops while the game is paused)."""
    if not isinstance(seconds, (int, float)) or seconds < 0:
        raise ValueError("wait() needs a number of seconds >= 0")
    await world.wait_future(seconds)


def game_time():
    """Seconds of game time since the page loaded."""
    return round(world.time, 3)


def spawn(item_name, block):
    """Debug helper: create an item directly inside a block (until Sources
    can order supplies in Phase 3). Returns the item."""
    if item_name not in world.item_names:
        raise ValueError(f"unknown item {item_name!r}; try one of {', '.join(sorted(world.item_names))}")
    if isinstance(block, str):
        block = blocks.get(block)
    if not isinstance(block, Block) or block.id not in world.by_id:
        raise ValueError("spawn(item_name, block): block must be a block or a block name")
    if block._room() <= 0:
        raise ValueError(f"{block.name} is full")
    item = Item(item_name)
    block._held.append(item)
    world.call_hook(block, "on_receive", item)
    return item


def _print(*args, sep=" ", end="\n", file=None, flush=False):
    text = sep.join(str(a) for a in args)
    b = current_block.get()
    builtins.print(f"[{b.name}] {text}" if b is not None else text, end=end)


def _help(*args):
    print(
        "def factory() terminal\n"
        "  blocks                dict of every block by name; each block is also a variable\n"
        "  belt_1.items          items a block is holding\n"
        "  spawn('iron', belt_1) put an item into a block (debug, until Phase 3)\n"
        "  money, time()         your money; game time in seconds\n"
        "  await wait(s)         pause for s game seconds\n"
        "Write behavior in the Classes tab: one class per block type, e.g.\n"
        "  class Belt:\n"
        "      def on_place(self): self.direction = 'east'\n"
        "      def on_receive(self, item): self.push(item, self.direction)\n"
        "Shift+Enter: new line · Enter on an empty line runs a block · Ctrl+C: stop · Ctrl+L: clear"
    )


G.update({
    "__name__": "__main__",
    "__builtins__": builtins,
    "print": _print,
    "blocks": blocks,
    "wait": wait,
    "time": game_time,
    "spawn": spawn,
    "help": _help,
    "N": N, "S": S, "E": E, "W": W,
    "money": 0,
})


# --------------------------------------------------------------------- engine

def step(n=1):
    for _ in range(int(n)):
        world.step()


def snapshot(selected_id=None, persist=False):
    snap = world.snapshot(selected_id)
    if persist:
        snap["persist"] = world.persistable_attrs()
    return snap


def restore_attrs(saved):
    world.restore_attrs(saved.to_py() if hasattr(saved, "to_py") else saved)


# ---------------------------------------------------------------------- REPL

_current = None  # the running terminal task, so Ctrl+C can cancel it
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
        return {"ok": False, "kind": "watchdog", "error": format_error(e)}
    except BaseException as e:  # noqa: BLE001 — player errors must never escape
        return {"ok": False, "kind": "error", "error": format_error(e)}
    finally:
        _current = None

    return {"ok": True, "repr": text}


def cancel():
    if _current is not None and not _current.done():
        _current.cancel()
        return True
    return False
