// Boot and wiring for the Phase 0 build: grid, palette, side panel, log.

import { World, fmt } from './world.js';
import { BLOCKS } from './config.js';
import { GridView } from './ui/canvas.js';
import { buildPalette } from './ui/palette.js';
import { buildPanels } from './ui/panels.js';

const world = new World();
const moneyEl = document.getElementById('money');
const termLog = document.getElementById('term-log');

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

  log(msg, cls = '') {
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    const t = new Date().toLocaleTimeString([], { hour12: false });
    line.innerHTML = `<span class="t">${t}</span>`;
    line.append(msg);
    termLog.appendChild(line);
    while (termLog.childElementCount > 200) termLog.firstChild.remove();
    termLog.scrollTop = termLog.scrollHeight;
  },

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

ui.log('def factory() — Phase 0. Place blocks from the palette; Python comes in Phase 1.', 'good');

// Handy for poking at things from the browser console during development.
window.dev = { world, ui, BLOCKS };
