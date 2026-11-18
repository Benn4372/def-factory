// Boot and wiring: grid, palette, side panel, terminal, Python worker, classes.

import { World, fmt } from './world.js';
import { BLOCKS, ITEMS } from './config.js';
import { CLASS_TEMPLATES } from './templates.js';
import { GridView } from './ui/canvas.js';
import { buildPalette } from './ui/palette.js';
import { buildPanels } from './ui/panels.js';
import { Terminal } from './ui/terminal.js';
import { ClassesTab } from './ui/classes.js';
import { PythonBridge } from './bridge.js';

const world = new World();
const moneyEl = document.getElementById('money');
const clockEl = document.getElementById('clock');
const terminal = new Terminal(document.getElementById('terminal'));
let classesTab = null;

const ui = {
  placing: null,  // block kind currently being placed, or null
  selected: null, // selected block, or null
  sim: null,      // latest simulation snapshot: { snap, speed, at }

  setPlacing(kind) {
    this.placing = kind;
    if (kind) this.select(null);
    palette.refresh();
    document.getElementById('grid').style.cursor = kind ? 'crosshair' : 'default';
  },

  select(block) {
    this.selected = block;
    panels.renderInspector();
    bridge?.select(block ? block.id : null);
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

  onClassesShown() { classesTab?.refresh(); },
};

const palette = buildPalette(document.getElementById('palette'), world, ui);
const panels = buildPanels(world, ui);
new GridView(document.getElementById('grid'), world, ui);

function renderMoney() { moneyEl.textContent = `$${fmt(world.money)}`; }
world.onChange(renderMoney);
renderMoney();
panels.renderInspector();

// ---- Python + simulation ----
const bridge = new PythonBridge({
  onStatus: (state, detail) => terminal.setStatus(state, detail),
  onOutput: (text, stream) => terminal.write(text, stream),
  onSnapshot: (snap, speed) => {
    ui.sim = { snap, speed, at: performance.now() };
    if (snap.earned) world.addMoney(snap.earned);
    const t = Math.floor(snap.t);
    clockEl.textContent = `t = ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    panels.updateSim(snap.sel);
  },
  getLayout: () => world.snapshot(),
  getClasses: () => (classesTab ? classesTab.sources : CLASS_TEMPLATES),
  config: { items: ITEMS },
});
terminal.attach(bridge);
world.onChange(() => bridge.sendLayout());
classesTab = new ClassesTab(document.getElementById('tab-classes'), bridge);

// pause / speed buttons
const speedButtons = [...document.querySelectorAll('.sim-controls button')];
function setSpeed(speed) {
  bridge.setSpeed(speed);
  for (const b of speedButtons) b.classList.toggle('active', Number(b.dataset.speed) === speed);
}
for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));

terminal.write('def factory() — open the Guide tab for a quick start, or type help(). Every block is a Python variable named after it.', 'good');

// Handy for poking at things from the browser console during development.
window.dev = { world, ui, bridge, terminal, classesTab, BLOCKS };
