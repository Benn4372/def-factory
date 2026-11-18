// Left-hand block palette: shows each block's price and free placements left.

import { BLOCKS, BLOCK_ORDER } from '../config.js';

export function buildPalette(root, world, ui) {
  const items = {};
  for (const kind of BLOCK_ORDER) {
    const def = BLOCKS[kind];
    const btn = document.createElement('button');
    btn.className = 'pal-item';
    btn.innerHTML = `
      <span class="swatch" style="background:${def.color}">${def.icon}</span>
      <span class="name">${def.label}${def.size > 1 ? ` <span class="dim">${def.size}×${def.size}</span>` : ''}</span>
      <span class="cost"></span>`;
    btn.addEventListener('click', () => ui.setPlacing(ui.placing === kind ? null : kind));
    root.appendChild(btn);
    items[kind] = btn;
  }

  function refresh() {
    for (const kind of BLOCK_ORDER) {
      const btn = items[kind];
      const free = world.freeLeft(kind);
      const cost = btn.querySelector('.cost');
      cost.textContent = free > 0 ? `free (${free} left)` : `$${BLOCKS[kind].price}`;
      cost.classList.toggle('free', free > 0);
      btn.classList.toggle('active', ui.placing === kind);
    }
  }

  world.onChange(refresh);
  refresh();
  return { refresh };
}
