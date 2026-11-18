// Boot and wiring: grid, palette, side panel, terminal, Python worker.

import { World, fmt } from './world.js';
import { BLOCKS } from './config.js';
import { GridView } from './ui/canvas.js';
import { buildPalette } from './ui/palette.js';
import { buildPanels } from './ui/panels.js';
import { Terminal } from './ui/terminal.js';
import { PythonBridge } from './bridge.js';

const world = new World();
const moneyEl = document.getElementById('money');
const terminal = new Terminal(document.getElementById('terminal'));

const ui = {
  placing: null,  // block kind currently being placed, or null
  selected: null, // selected block, or null

  setPlacing(kind) {
    this.placing = kind;
    if (kind) this.select(null);
    palette.refresh();
    document.getElementById('grid').style.cursor = kind ? 'crosshair' : 'default';
  },

  select(block) {
    this.selected = block;
    panels.renderInspector();
  },

  remove(block) {
    const res = world.remove(block);
    if (this.selected === block) this.select(null);
    this.log(`deleted ${block.name}` + (res.refund ? ` (+$${res.refund})` : ''));
  },

  log(msg, cls = '') { terminal.log(msg, cls); },

  flashMoney() {
    moneyEl.classList.add('flash-bad');
    setTimeout(() => moneyEl.classList.remove('flash-bad'), 400);
  },
};

const palette = buildPalette(document.getElementById('palette'), world, ui);
const panels = buildPanels(world, ui);
new GridView(document.getElementById('grid'), world, ui);

function renderMoney() { moneyEl.textContent = `$${fmt(world.money)}`; }
world.onChange(renderMoney);
renderMoney();
panels.renderInspector();

// ---- Python ----
const bridge = new PythonBridge({
  onStatus: (state, detail) => terminal.setStatus(state, detail),
  onOutput: (text, stream) => terminal.write(text, stream),
  getLayout: () => world.snapshot(),
});
terminal.attach(bridge);
world.onChange(() => bridge.sendLayout());

terminal.write('def factory() — type help() to get started. Every block is a Python variable named after it.', 'good');

// Handy for poking at things from the browser console during development.
window.dev = { world, ui, bridge, terminal, BLOCKS };
