"""The simulation engine (runs in the worker, in Python).

Phase 2: game clock, items, the movement rules (push / adjacency / accepting
sides / back-ups), player classes with hooks, and per-block errors.
See DESIGN.md §7 and §9.
"""

import asyncio
import contextvars
import traceback

import safety
from safety import watchdog

DT = 0.05            # fixed step: 20 Hz of game time
TRANSIT = 0.5        # seconds an item takes to move one tile

DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
OPPOSITE = {"north": "south", "south": "north", "east": "west", "west": "east"}
LEFT_OF = {"north": "west", "west": "south", "south": "east", "east": "north"}
RIGHT_OF = {v: k for k, v in LEFT_OF.items()}

CLASS_NAMES = {
    "source": "Source", "belt": "Belt", "splitter": "Splitter", "merger": "Merger",
    "warehouse": "Warehouse", "crafter": "Crafter", "sell": "Sell",
}
SIZES = {"warehouse": 2}
CAPACITY = {"source": 1, "belt": 1, "splitter": 1, "merger": 1, "warehouse": 1, "crafter": 10, "sell": 1}
CONVEYORS = {"belt", "splitter", "merger"}
DIRECTED = CONVEYORS

current_block = contextvars.ContextVar("current_block", default=None)


def emit(text, stream="out"):
    """Print a line to the terminal, tagged with the block whose code is running."""
    b = current_block.get()
    print(f"[{b.name}] {text}" if b is not None else text)


# ---------------------------------------------------------------------- items

class Item:
    _next = 1

    def __init__(self, name):
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "id", Item._next)
        Item._next += 1

    def __setattr__(self, k, v):
        raise AttributeError("items are read-only")

    def __repr__(self):
        return f"<Item {self.name} #{self.id}>"


class Transit:
    __slots__ = ("item", "src", "dst", "progress", "from_dir")

    def __init__(self, item, src, dst, from_dir):
        self.item, self.src, self.dst, self.from_dir = item, src, dst, from_dir
        self.progress = 0.0


# --------------------------------------------------------------------- blocks

class Block:
    """Engine side of every placed block. Player classes are mixed in front of
    this, so `self` has both the player's methods and these built-ins."""

    _READ_ONLY = {"name", "kind", "pos", "x", "y", "id", "items", "error"}

    def __init__(self, data):
        d = object.__getattribute__(self, "__dict__")
        d["_data"] = dict(data)
        d["_held"] = []       # items sitting in this block
        d["_pending"] = []    # (item, target) push requests not yet started
        d["_error"] = None

    # ---- read-only info ----
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

    @property
    def items(self): return list(self._held)

    @property
    def error(self): return self._error

    @property
    def size(self): return SIZES.get(self.kind, 1)

    def __setattr__(self, key, value):
        if key in self._READ_ONLY:
            hint = {"name": " Rename blocks in the Inspector.", "x": " Drag the block to move it.",
                    "y": " Drag the block to move it.", "pos": " Drag the block to move it."}.get(key, "")
            raise AttributeError(f"`{key}` is read-only.{hint}")
        object.__setattr__(self, key, value)

    def __repr__(self):
        return f"<{CLASS_NAMES.get(self.kind, self.kind)} {self.name} at {self.pos}>"

    # ---- geometry ----
    def tiles(self):
        s = self.size
        return [(self.x + dx, self.y + dy) for dx in range(s) for dy in range(s)]

    def facing(self):
        d = self.__dict__.get("direction")
        return d if d in DIRS else None

    def neighbor(self, direction):
        """The block next to this one in `direction` (1×1 blocks), or None."""
        if direction not in DIRS:
            raise ValueError(f"direction must be one of {', '.join(DIRS)}, not {direction!r}")
        dx, dy = DIRS[direction]
        return world.block_at(self.x + dx, self.y + dy)

    def neighbors(self):
        found = []
        for (tx, ty) in self.tiles():
            for dx, dy in DIRS.values():
                b = world.block_at(tx + dx, ty + dy)
                if b is not None and b is not self and b not in found:
                    found.append(b)
        return found

    def direction_to(self, other):
        """Direction from this block to an adjacent block, or None."""
        mine = set(self.tiles())
        for (tx, ty) in other.tiles():
            for d, (dx, dy) in DIRS.items():
                if (tx - dx, ty - dy) in mine:
                    return d
        return None

    # ---- movement ----
    def push(self, item, target):
        """Ask to move a held item to an adjacent block. Returns True if the
        request is accepted; the item moves as soon as the target has room."""
        reason = self._push_problem(item, target)
        if reason:
            emit(f"push failed: {reason}")
            return False
        dst = world.resolve(target, self)
        self._pending.append((item, dst))
        return True

    def _push_problem(self, item, target):
        if not isinstance(item, Item) or item not in self._held:
            return f"{self.name} isn't holding {item!r}"
        if any(p[0] is item for p in self._pending):
            return f"{item!r} is already being pushed"
        try:
            dst = world.resolve(target, self)
        except ValueError as e:
            return str(e)
        if dst is None:
            return f"there's no block {target!r} of {self.name}" if target in DIRS else f"no block called {target!r}"
        out_dir = self.direction_to(dst)
        if out_dir is None:
            return f"{dst.name} isn't next to {self.name}"
        if self.kind not in CONVEYORS and dst.kind not in CONVEYORS:
            return f"a {CLASS_NAMES[self.kind]} can only push onto a Belt, Splitter or Merger"
        if self.kind in DIRECTED:
            f = self.facing()
            if f is None:
                return f"{self.name} has no direction (set self.direction = \"east\", etc.)"
            allowed = {f} if self.kind != "splitter" else {f, LEFT_OF[f], RIGHT_OF[f]}
            if out_dir not in allowed:
                kind = CLASS_NAMES[self.kind]
                return (f"a {kind} facing {f} can only push {' / '.join(sorted(allowed))}, not {out_dir}")
        side = OPPOSITE[out_dir]  # the side of dst the item arrives from
        if not dst._accepts_side(side):
            return f"{dst.name} doesn't take items from its {side} side"
        return None

    def _accepts_side(self, side):
        # Belts and mergers take items from behind and both sides (so belt lines
        # can turn corners); splitters only from behind. Nothing enters a
        # conveyor through its front.
        if self.kind == "splitter":
            f = self.facing()
            return f is not None and side == OPPOSITE[f]
        if self.kind in ("belt", "merger"):
            f = self.facing()
            return f is not None and side != f
        return True

    def _room(self):
        incoming = sum(1 for t in world.transits if t.dst is self)
        return CAPACITY.get(self.kind, 1) - len(self._held) - incoming

    # ---- sell ----
    def sell(self, item):
        if self.kind != "sell":
            raise AttributeError(f"only Sell blocks can sell (this is a {CLASS_NAMES[self.kind]})")
        if item not in self._held:
            raise ValueError(f"{self.name} isn't holding {item!r}")
        self._held.remove(item)
        price = world.prices.get(item.name, 0)
        world.earned += price
        return price


# ---------------------------------------------------------------------- world

class World:
    def __init__(self):
        self.by_id = {}
        self.tiles = {}
        self.transits = []
        self.time = 0.0
        self.earned = 0.0
        self.prices = {}
        self.item_names = set()
        self.classes = {}        # kind -> combined class (player class + Block)
        self.player_classes = {} # kind -> the player's own class
        self.waits = []          # (time, future)
        self.tasks = set()

    # ---- layout ----
    def rebuild_tiles(self):
        self.tiles = {}
        for b in self.by_id.values():
            for t in b.tiles():
                self.tiles[t] = b

    def block_at(self, x, y):
        return self.tiles.get((x, y))

    def resolve(self, target, src):
        if isinstance(target, Block):
            return target if target.id in self.by_id else None
        if isinstance(target, str):
            if target in DIRS:
                if src.size != 1:
                    raise ValueError(f"{src.name} is bigger than one tile; push to a block or name instead of a direction")
                return src.neighbor(target)
            for b in self.by_id.values():
                if b.name == target:
                    return b
            return None
        raise ValueError(f"push target must be a direction, a block or a block name, not {target!r}")

    def drop_items_of(self, block):
        """A block was moved or deleted: everything it held or was moving vanishes."""
        block._held.clear()
        block._pending.clear()
        self.transits = [t for t in self.transits if t.src is not block and t.dst is not block]
        for b in self.by_id.values():
            b._pending = [p for p in b._pending if p[1] is not block]

    # ---- classes ----
    def make_block(self, data):
        cls = self.classes.get(data["kind"])
        obj = object.__new__(cls) if cls else object.__new__(Block)
        Block.__init__(obj, data)
        return obj

    def set_class(self, kind, player_cls):
        combined = type(CLASS_NAMES[kind], (player_cls, Block), {})
        self.player_classes[kind] = player_cls
        self.classes[kind] = combined
        resumed = []
        for b in self.by_id.values():
            if b.kind == kind:
                b.__class__ = combined
                if b._error is not None:
                    b.__dict__["_error"] = None  # a fixed class resumes errored blocks
                    resumed.append(b)
        # Items that arrived while a block was stopped never got on_receive: retry them.
        for b in resumed:
            waiting = {id(p[0]) for p in b._pending}
            for item in list(b._held):
                if id(item) not in waiting and b._error is None:
                    watchdog.arm()
                    self.call_hook(b, "on_receive", item)

    # ---- hooks ----
    def call_hook(self, block, name, *args, default=None):
        if block._error is not None:
            return default
        fn = getattr(block, name, None)
        if fn is None:
            return default
        token = current_block.set(block)
        try:
            result = fn(*args)
            if asyncio.iscoroutine(result):
                task = asyncio.ensure_future(result)  # copies the context (block tag)
                self.tasks.add(task)
                task.add_done_callback(lambda t, b=block: self._task_done(b, t))
                return default
            return result
        except BaseException as e:  # noqa: BLE001 — player errors must not escape
            self.fail(block, e)
            return default
        finally:
            current_block.reset(token)

    def _task_done(self, block, task):
        self.tasks.discard(task)
        if task.cancelled():
            return
        e = task.exception()
        if e is not None:
            self.fail(block, e)

    def fail(self, block, e):
        msg = format_error(e)
        block.__dict__["_error"] = msg
        print(f"[{block.name}] error in {CLASS_NAMES[block.kind]}: {msg} (block stopped — fix the class and save to resume)")

    # ---- clock ----
    def wait_future(self, seconds):
        fut = asyncio.get_event_loop().create_future()
        self.waits.append((self.time + seconds, fut))
        return fut

    def step(self, dt=DT):
        watchdog.arm()
        self.time += dt

        # 1. finish waits
        due = [w for w in self.waits if w[0] <= self.time + 1e-9]
        if due:
            self.waits = [w for w in self.waits if w[0] > self.time + 1e-9]
            for _, fut in due:
                if not fut.done():
                    fut.set_result(None)

        # 2. advance items in transit; deliver the ones that arrived
        arrived = []
        for t in self.transits:
            t.progress += dt
            if t.progress >= TRANSIT - 1e-9:
                arrived.append(t)
        for t in arrived:
            self.transits.remove(t)
            t.dst._held.append(t.item)
            self.call_hook(t.dst, "on_receive", t.item)

        # 3. start pending pushes whose target has room (otherwise they wait = back-up)
        for b in list(self.by_id.values()):
            if not b._pending:
                continue
            still = []
            for item, dst in b._pending:
                if dst.id not in self.by_id or item not in b._held:
                    continue
                out_dir = b.direction_to(dst)
                if out_dir is None:
                    continue  # no longer adjacent (moved): drop the request
                side = OPPOSITE[out_dir]
                if dst._room() > 0 and self.call_hook(dst, "can_accept", item, side, default=True) is not False:
                    b._held.remove(item)
                    self.transits.append(Transit(item, b, dst, side))
                else:
                    still.append((item, dst))  # target full or refusing: the item waits (back-up)
            b._pending = still

    # ---- attribute backup (restored if the worker restarts) ----
    def persistable_attrs(self):
        import json
        saved = {}
        for b in self.by_id.values():
            attrs = {}
            for k, v in b.__dict__.items():
                if k.startswith("_"):
                    continue
                try:
                    if len(json.dumps(v)) <= 2000:
                        attrs[k] = json.dumps(v)
                except (TypeError, ValueError):
                    pass  # not plain data (e.g. an Item or a block): not backed up
            if attrs:
                saved[b.id] = attrs
        return saved

    def restore_attrs(self, saved):
        import json
        for bid, attrs in saved.items():
            b = self.by_id.get(int(bid))
            if b is None:
                continue
            for k, v in attrs.items():
                try:
                    setattr(b, k, json.loads(v))
                except Exception:  # noqa: BLE001 — best effort
                    pass

    # ---- snapshot for the renderer ----
    def snapshot(self, selected_id=None):
        blocks = {}
        for b in self.by_id.values():
            entry = {"dir": b.facing(), "n": len(b._held)}
            if b._error:
                entry["err"] = b._error
            if b._held:
                entry["held"] = [i.name for i in b._held[:6]]
            blocks[b.id] = entry
        items = [{"id": t.item.id, "name": t.item.name, "src": t.src.id, "dst": t.dst.id,
                  "p": min(1.0, t.progress / TRANSIT)} for t in self.transits]
        snap = {"t": self.time, "blocks": blocks, "items": items, "earned": self.earned}
        self.earned = 0.0
        if selected_id is not None and selected_id in self.by_id:
            b = self.by_id[selected_id]
            attrs = {}
            for k, v in b.__dict__.items():
                if k.startswith("_"):
                    continue
                r = repr(v)
                attrs[k] = r if len(r) <= 60 else r[:57] + "..."
                if len(attrs) >= 12:
                    break
            snap["sel"] = {"id": b.id, "attrs": attrs, "held": [repr(i) for i in b._held],
                           "pending": len(b._pending), "err": b._error}
        return snap


def format_error(e):
    if isinstance(e, safety.SafetyError):
        return str(e)
    tb = traceback.extract_tb(e.__traceback__)
    player = [f for f in tb if f.filename.startswith(safety.PLAYER_PREFIXES)]
    where = f"line {player[-1].lineno}: " if player else ""
    msg = str(e)
    return f"{where}{type(e).__name__}: {msg}" if msg else f"{where}{type(e).__name__}"


world = World()
