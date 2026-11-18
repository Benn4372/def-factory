// The world model: blocks on the grid, money, naming.
// Phase 0 keeps this on the main thread. In later phases the simulation moves
// into a worker, but the UI keeps this layout as the authoritative copy (DESIGN.md §13).

import { GRID, BLOCKS, START_MONEY } from './config.js';

// Names a block can't take, because Python or the game already uses them.
const PY_KEYWORDS = `False None True and as assert async await break class continue def del elif else
except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield
match case _`.split(/\s+/);
const PY_BUILTINS = `abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex
delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id
input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print
property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip
Exception ValueError TypeError KeyError IndexError NameError RuntimeError StopIteration self`.split(/\s+/);
const GAME_GLOBALS = `blocks money wait time run stop RECIPES PRICES N S E W
Source Belt Splitter Merger Warehouse Crafter Sell`.split(/\s+/);
const RESERVED = new Set([...PY_KEYWORDS, ...PY_BUILTINS, ...GAME_GLOBALS]);

export class World {
  constructor() {
    this.money = START_MONEY;
    this.blocks = new Map(); // name -> block
    this.nextId = 1;         // stable ids survive renames (Python keys blocks by id)
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  countOf(kind) {
    let n = 0;
    for (const b of this.blocks.values()) if (b.kind === kind) n++;
    return n;
  }

  freeLeft(kind) {
    return Math.max(0, BLOCKS[kind].free - this.countOf(kind));
  }

  // What placing one more of this kind costs right now.
  priceFor(kind) {
    return this.freeLeft(kind) > 0 ? 0 : BLOCKS[kind].price;
  }

  // What deleting one of this kind refunds right now (mirror of priceFor, so
  // placing then deleting is always net zero).
  refundFor(kind) {
    return this.countOf(kind) > BLOCKS[kind].free ? BLOCKS[kind].price : 0;
  }

  blockAt(x, y) {
    for (const b of this.blocks.values()) {
      const s = BLOCKS[b.kind].size;
      if (x >= b.x && x < b.x + s && y >= b.y && y < b.y + s) return b;
    }
    return null;
  }

  // Can a block of `kind` sit with its top-left at (x, y)? `ignore` lets a
  // block being moved overlap its own old position.
  fits(kind, x, y, ignore = null) {
    const s = BLOCKS[kind].size;
    if (x < 0 || y < 0 || x + s > GRID.cols || y + s > GRID.rows) return false;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const other = this.blockAt(x + dx, y + dy);
        if (other && other !== ignore) return false;
      }
    }
    return true;
  }

  nextName(kind) {
    for (let i = 1; ; i++) {
      const name = `${kind}_${i}`;
      if (!this.blocks.has(name)) return name;
    }
  }

  // Returns { ok, block?, error? }
  place(kind, x, y) {
    if (!this.fits(kind, x, y)) return { ok: false, error: "That space is blocked." };
    const price = this.priceFor(kind);
    if (price > this.money) {
      return { ok: false, error: `Not enough money: a ${BLOCKS[kind].label} costs $${price}, you have $${fmt(this.money)}.` };
    }
    this.money -= price;
    const block = { id: this.nextId++, name: this.nextName(kind), kind, x, y };
    this.blocks.set(block.name, block);
    this.emit();
    return { ok: true, block, price };
  }

  move(block, x, y) {
    if (block.x === x && block.y === y) return { ok: true };
    if (!this.fits(block.kind, x, y, block)) return { ok: false, error: "That space is blocked." };
    block.x = x;
    block.y = y;
    this.emit();
    return { ok: true };
  }

  remove(block) {
    const refund = this.refundFor(block.kind);
    this.blocks.delete(block.name);
    this.money += refund;
    this.emit();
    return { ok: true, refund };
  }

  // Plain-data copy of the layout for the Python worker.
  snapshot() {
    return {
      money: this.money,
      blocks: [...this.blocks.values()].map(({ id, name, kind, x, y }) => ({ id, name, kind, x, y })),
    };
  }

  validateName(block, name) {
    if (name === block.name) return null;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return 'Names must be valid Python identifiers: letters, digits and _, not starting with a digit.';
    }
    if (name.startsWith('_')) return 'Names starting with _ are reserved for Python internals.';
    if (RESERVED.has(name)) return `"${name}" is reserved by Python or the game.`;
    if (this.blocks.has(name)) return `"${name}" is already used by another block.`;
    return null;
  }

  rename(block, name) {
    const error = this.validateName(block, name);
    if (error) return { ok: false, error };
    if (name === block.name) return { ok: true };
    this.blocks.delete(block.name);
    block.name = name;
    this.blocks.set(name, block);
    this.emit();
    return { ok: true };
  }
}

export function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
