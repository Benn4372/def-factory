// Side panel: tabs, open/close, and the Inspector for the selected block.

import { BLOCKS } from '../config.js';

export function buildPanels(world, ui) {
  const layout = document.getElementById('layout');
  const tabs = [...document.querySelectorAll('.tabs button[data-tab]')];

  function showTab(name) {
    layout.classList.remove('panel-closed');
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === name);
    for (const body of document.querySelectorAll('.tab-body')) body.hidden = body.id !== `tab-${name}`;
  }

  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab));
  document.getElementById('panel-close').addEventListener('click', () => layout.classList.add('panel-closed'));
  document.getElementById('panel-toggle').addEventListener('click', () => layout.classList.toggle('panel-closed'));
  document.getElementById('guide-btn').addEventListener('click', () => showTab('guide'));

  // ----- Inspector -----
  const insp = document.getElementById('tab-inspector');
  let shownBlock = undefined;

  function renderInspector() {
    const b = ui.selected;
    if (b === shownBlock && b) { updateLive(); return; }
    shownBlock = b;

    if (!b) {
      insp.innerHTML = `<p class="placeholder">Click a block to inspect it.</p>`;
      return;
    }
    const def = BLOCKS[b.kind];
    insp.innerHTML = `
      <div class="insp-row"><span class="label">Name</span><input id="insp-name" spellcheck="false" value="${b.name}"></div>
      <div class="insp-error" id="insp-err"></div>
      <div class="insp-row"><span class="label">Class</span><code>${def.label}</code></div>
      <div class="insp-row"><span class="label">Position</span><span id="insp-pos"></span></div>
      <div class="insp-row"><span class="label">Size</span><span>${def.size}×${def.size}</span></div>
      <div class="insp-row"><span class="label">Refund</span><span id="insp-refund"></span></div>
      <p class="dim" style="margin:12px 0 6px">In code (from Phase 1) this block is:</p>
      <div class="insp-code" id="insp-code"></div>
      <p style="margin-top:16px"><button class="danger" id="insp-del">Delete block</button></p>`;

    const input = insp.querySelector('#insp-name');
    const err = insp.querySelector('#insp-err');
    const commit = () => {
      const res = world.rename(b, input.value.trim());
      if (!res.ok) {
        err.textContent = res.error;
        input.classList.add('invalid');
      } else {
        err.textContent = '';
        input.classList.remove('invalid');
      }
    };
    input.addEventListener('input', () => {
      const e = world.validateName(b, input.value.trim());
      err.textContent = e || '';
      input.classList.toggle('invalid', !!e);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { input.value = b.name; err.textContent = ''; input.classList.remove('invalid'); input.blur(); }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() !== b.name) commit();
    });
    insp.querySelector('#insp-del').addEventListener('click', () => ui.remove(b));
    updateLive();
  }

  // Parts that change without re-creating the form (so typing isn't interrupted).
  function updateLive() {
    const b = ui.selected;
    if (!b) return;
    insp.querySelector('#insp-pos').textContent = `(${b.x}, ${b.y})`;
    const r = world.refundFor(b.kind);
    insp.querySelector('#insp-refund').textContent = r ? `$${r}` : '$0 (free placement)';
    insp.querySelector('#insp-code').textContent = b.name;
    const input = insp.querySelector('#insp-name');
    if (document.activeElement !== input) input.value = b.name;
  }

  world.onChange(renderInspector);
  return { renderInspector, showTab };
}
