"""Safety layer for player code (DESIGN.md §10).

Two parts:
  * check(src)  — a static pre-run check using `ast`. Refuses code that would
    obviously hang or that reaches outside the game.
  * Watchdog    — a sys.settrace-based runtime guard. Any player code that runs
    for more than BUDGET seconds without yielding (an `await`) is stopped.

A perfect "will this hang?" check is impossible, so the runtime watchdog catches
what the static check can't. Loops stuck inside C code (e.g. sum(range(10**12)))
don't produce line events; the main thread's heartbeat watchdog restarts the
worker for those.
"""

import ast
import sys
from time import perf_counter

BUDGET = 0.05          # seconds of real time without yielding
MAX_DEPTH = 150        # nested player-code calls (recursion limit)
CHECK_EVERY = 32       # check the clock every N line events (keeps overhead down)

# Filenames given to player code. Frames from these are "player frames".
PLAYER_PREFIXES = ("<terminal", "<class", "<program")

BLOCKED_MODULES = {"js", "pyodide", "pyodide_js", "_pyodide", "micropip"}


class SafetyError(Exception):
    """Raised by check() when code is refused before running."""


# The watchdog's stops derive from BaseException so a player's
# `except Exception:` can't swallow them and keep running untraced.
class TooLongWithoutAwait(BaseException):
    """Raised inside player code that ran too long without yielding."""


class RecursionTooDeep(BaseException):
    """Raised when player code nests calls deeper than MAX_DEPTH."""


# ------------------------------------------------- runtime guards on builtins
# Patched once at import, so they apply however the function is reached
# (`time.sleep`, `from time import sleep`, getattr, ...). The watchdog keeps a
# private reference to the real settrace.

import time as _time

_real_settrace = sys.settrace


def _refuse(what, hint=""):
    def refused(*args, **kwargs):
        raise SafetyError(f"{what} isn't allowed in player code.{hint}")
    return refused


_time.sleep = _refuse("sleep()", " It would freeze the factory; use `await wait(seconds)` instead.")
sys.settrace = _refuse("sys.settrace()")
sys.setprofile = _refuse("sys.setprofile()")
sys.setrecursionlimit = _refuse("sys.setrecursionlimit()")


# ---------------------------------------------------------------- static check

def check(src, filename="<terminal>"):
    try:
        tree = ast.parse(src, filename=filename)
    except SyntaxError as e:
        line = f"line {e.lineno}: " if e.lineno else ""
        raise SafetyError(f"SyntaxError: {line}{e.msg}") from None
    except (RecursionError, MemoryError, ValueError) as e:
        raise SafetyError(f"this code is too complex to parse ({type(e).__name__})") from None

    for node in ast.walk(tree):
        if isinstance(node, ast.While):
            _check_while(node)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            _check_import(node)
    return tree


def _always_true(test):
    return isinstance(test, ast.Constant) and bool(test.value)


def _check_while(node):
    # Only loops that can obviously never end on their own are refused here:
    # `while True:` (or any constant-true test) with no `await` and no `break`.
    # Anything sneakier is caught by the runtime watchdog.
    if not _always_true(node.test):
        return
    if _contains(node.body, ast.Await, stop_at_loops=False):
        return
    if _contains(node.body, ast.Break, stop_at_loops=True):
        return
    raise SafetyError(
        f"line {node.lineno}: this `while` loop never ends and never waits, so it would "
        "freeze the factory. Add `await wait(seconds)` inside it, or a `break`."
    )


def _contains(stmts, kind, stop_at_loops):
    """Does `kind` appear in these statements? Never looks inside nested
    functions; optionally doesn't look inside nested loops (for `break`)."""
    stack = list(stmts)
    while stack:
        n = stack.pop()
        if isinstance(n, kind):
            return True
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        if stop_at_loops and isinstance(n, (ast.For, ast.AsyncFor, ast.While)):
            continue
        stack.extend(ast.iter_child_nodes(n))
    return False


def _check_import(node):
    names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
    for name in names:
        if name.split(".")[0] in BLOCKED_MODULES:
            raise SafetyError(f"line {node.lineno}: importing `{name}` isn't allowed in player code.")


# ------------------------------------------------------------ runtime watchdog

class Watchdog:
    def __init__(self):
        self.depth = 0
        self.deadline = 0.0
        self.counter = 0

    def arm(self):
        """Call at every entry point into player code, and every engine step.
        The tracer stays on between calls so background player tasks resumed
        by the event loop are watched too; re-arming is needed after a trip,
        because CPython unsets the tracer when a trace function raises."""
        self.depth = 0
        _real_settrace(self._global)

    def _global(self, frame, event, arg):
        # Called on every new frame ('call'), including a coroutine resuming
        # after an await. Only player frames are traced line by line.
        if not frame.f_code.co_filename.startswith(PLAYER_PREFIXES):
            return None
        if self.depth == 0:
            # A fresh slice of player code starts now (first call, or resuming
            # after an await): give it a new time budget.
            self.deadline = perf_counter() + BUDGET
            self.counter = 0
        self.depth += 1
        if self.depth > MAX_DEPTH:
            self.depth -= 1
            raise RecursionTooDeep(f"recursion too deep (more than {MAX_DEPTH} nested calls)")
        return self._local

    def _local(self, frame, event, arg):
        if event == "line":
            self.counter += 1
            if self.counter >= CHECK_EVERY:
                self.counter = 0
                if perf_counter() > self.deadline:
                    raise TooLongWithoutAwait(
                        f"stopped: ran for more than {int(BUDGET * 1000)} ms without an `await`. "
                        "Long loops need `await wait(...)` so the factory can keep running."
                    )
        elif event == "return":
            # Fires on normal return, on exceptions unwinding, and when a
            # coroutine suspends at an await.
            self.depth = max(0, self.depth - 1)
        return self._local


watchdog = Watchdog()
