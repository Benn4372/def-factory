// Grid rendering and mouse/keyboard input for placing, selecting, moving and deleting blocks.

import { GRID, BLOCKS } from '../config.js';

export class GridView {
  constructor(canvas, world, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.ui = ui; // shared UI state + callbacks, see main.js
    this.hover = null; // {x, y} tile under the cursor
    this.drag = null;  // {block, offX, offY, moved}
    this.painting = false; // mouse held while placing
    this.lastPainted = null;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindInput();
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // Fit the grid into the stage, keeping tiles square and crisp.
  resize() {
    const stage = this.canvas.parentElement;
    const availW = stage.clientWidth - 24;
    const availH = stage.clientHeight - 36;
    const logicalW = GRID.cols * GRID.tile;
    const logicalH = GRID.rows * GRID.tile;
    const scale = Math.max(0.3, Math.min(availW / logicalW, availH / logicalH));
    const cssW = Math.floor(logicalW * scale);
    const cssH = Math.floor(logicalH * scale);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.pxPerTile = (cssW / GRID.cols) * dpr;
  }

  tileFromEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * GRID.cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * GRID.rows);
    if (x < 0 || y < 0 || x >= GRID.cols || y >= GRID.rows) return null;
    return { x, y };
  }

  bindInput() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const t = this.tileFromEvent(e);
      if (!t) return;
      if (this.ui.placing) {
        this.painting = true;
        this.tryPlace(t);
        return;
      }
      const b = this.world.blockAt(t.x, t.y);
      this.ui.select(b);
      if (b) this.drag = { block: b, offX: t.x - b.x, offY: t.y - b.y, moved: false, startX: t.x, startY: t.y };
    });

    c.addEventListener('mousemove', (e) => {
      this.hover = this.tileFromEvent(e);
      if (!this.hover) return;
      if (this.painting && this.ui.placing) this.tryPlace(this.hover);
      if (this.drag && (this.hover.x !== this.drag.startX || this.hover.y !== this.drag.startY)) {
        this.drag.moved = true;
      }
    });

    c.addEventListener('mouseleave', () => { this.hover = null; });

    window.addEventListener('mouseup', () => {
      this.painting = false;
      this.lastPainted = null;
      if (this.drag && this.drag.moved && this.hover) {
        const { block, offX, offY } = this.drag;
        const res = this.world.move(block, this.hover.x - offX, this.hover.y - offY);
        if (!res.ok) this.ui.log(res.error, 'error');
      }
      this.drag = null;
    });

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.ui.placing) { this.ui.setPlacing(null); return; }
      const t = this.tileFromEvent(e);
      const b = t && this.world.blockAt(t.x, t.y);
      if (b) this.ui.remove(b);
    });

    window.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        if (this.ui.placing) this.ui.setPlacing(null);
        else this.ui.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && this.ui.selected) {
        this.ui.remove(this.ui.selected);
      }
    });
  }

  tryPlace(t) {
    const key = `${t.x},${t.y}`;
    if (this.lastPainted === key) return;
    this.lastPainted = key;
    const kind = this.ui.placing;
    if (!this.world.fits(kind, t.x, t.y)) {
      // Only complain on a fresh click, not while painting across existing blocks.
      return;
    }
    const res = this.world.place(kind, t.x, t.y);
    if (!res.ok) {
      this.ui.log(res.error, 'error');
      this.ui.flashMoney();
      this.painting = false;
      return;
    }
    this.ui.log(`placed ${res.block.name}` + (res.price ? ` (-$${res.price})` : ' (free)'));
  }

  // ---------- drawing ----------

  draw() {
    const { ctx } = this;
    const p = this.pxPerTile;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b1e24';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // grid lines
    ctx.strokeStyle = '#262a32';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID.cols; x++) { ctx.moveTo(Math.round(x * p) + 0.5, 0); ctx.lineTo(Math.round(x * p) + 0.5, GRID.rows * p); }
    for (let y = 0; y <= GRID.rows; y++) { ctx.moveTo(0, Math.round(y * p) + 0.5); ctx.lineTo(GRID.cols * p, Math.round(y * p) + 0.5); }
    ctx.stroke();

    // blocks (the one being dragged is drawn faded at its old spot)
    for (const b of this.world.blocks.values()) {
      const dragging = this.drag?.moved && this.drag.block === b;
      this.drawBlock(b.kind, b.x, b.y, dragging ? 0.3 : 1, b.name);
      if (b === this.ui.selected) this.outline(b.kind, b.x, b.y, '#6cc4ff');
    }

    // placement ghost
    if (this.ui.placing && this.hover) {
      const kind = this.ui.placing;
      const ok = this.world.fits(kind, this.hover.x, this.hover.y);
      this.drawBlock(kind, this.hover.x, this.hover.y, 0.45);
      this.outline(kind, this.hover.x, this.hover.y, ok ? '#6fd08c' : '#ff6b6b');
      const price = this.world.priceFor(kind);
      this.tag(this.hover.x, this.hover.y, price ? `$${price}` : 'free', price > this.world.money ? '#ff6b6b' : '#e3e6ec');
    }

    // move ghost
    if (this.drag?.moved && this.hover) {
      const { block, offX, offY } = this.drag;
      const x = this.hover.x - offX, y = this.hover.y - offY;
      const ok = this.world.fits(block.kind, x, y, block);
      this.drawBlock(block.kind, x, y, 0.6);
      this.outline(block.kind, x, y, ok ? '#6fd08c' : '#ff6b6b');
    }
  }

  drawBlock(kind, x, y, alpha = 1, name = null) {
    const { ctx } = this;
    const p = this.pxPerTile;
    const def = BLOCKS[kind];
    const s = def.size;
    const pad = p * 0.08;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = def.color;
    roundRect(ctx, x * p + pad, y * p + pad, s * p - pad * 2, s * p - pad * 2, p * 0.12);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `600 ${Math.round(p * (s > 1 ? 0.42 : 0.32))}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, (x + s / 2) * p, (y + s / 2) * p - (name && s > 1 ? p * 0.15 : 0));
    if (name && s > 1) {
      ctx.font = `${Math.round(p * 0.24)}px ui-monospace, Consolas, monospace`;
      ctx.fillText(name, (x + s / 2) * p, (y + s / 2) * p + p * 0.4);
    }
    ctx.globalAlpha = 1;
  }

  outline(kind, x, y, color) {
    const { ctx } = this;
    const p = this.pxPerTile;
    const s = BLOCKS[kind].size;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, p * 0.06);
    roundRect(ctx, x * p + 1, y * p + 1, s * p - 2, s * p - 2, p * 0.14);
    ctx.stroke();
  }

  tag(x, y, text, color) {
    const { ctx } = this;
    const p = this.pxPerTile;
    ctx.font = `600 ${Math.round(p * 0.3)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const w = ctx.measureText(text).width + p * 0.2;
    ctx.fillRect(x * p, y * p - p * 0.4, w, p * 0.38);
    ctx.fillStyle = color;
    ctx.fillText(text, x * p + p * 0.1, y * p - p * 0.04);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
