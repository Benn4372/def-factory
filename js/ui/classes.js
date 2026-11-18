// Classes tab: one code editor per block type. Ctrl+S (or Save) compiles the
// class in the worker and hot-swaps it onto every block of that type.

import { BLOCKS, BLOCK_ORDER } from '../config.js';
import { CLASS_TEMPLATES } from '../templates.js';

export class ClassesTab {
  constructor(root, bridge) {
    this.root = root;
    this.bridge = bridge;
    this.sources = { ...CLASS_TEMPLATES };   // last saved source per kind (authoritative copy)
    this.drafts = { ...CLASS_TEMPLATES };    // editor contents per kind
    this.status = {};                        // kind -> {ok, error, line}
    this.kind = 'belt';
    this.errorLine = null;

    root.innerHTML = `
      <div class="cls-kinds"></div>
      <div class="cls-editor"></div>
      <div class="cls-bar">
        <button id="cls-save">Save (Ctrl+S)</button>
        <button id="cls-reset" class="danger" title="Replace with the empty template">Reset to template</button>
        <span id="cls-status"></span>
      </div>`;
    this.kindsEl = root.querySelector('.cls-kinds');
    this.statusEl = root.querySelector('#cls-status');

    for (const kind of BLOCK_ORDER) {
      const b = document.createElement('button');
      b.dataset.kind = kind;
      b.textContent = BLOCKS[kind].label;
      b.addEventListener('click', () => this.show(kind));
      this.kindsEl.appendChild(b);
    }

    this.cm = window.CodeMirror(root.querySelector('.cls-editor'), {
      value: this.drafts[this.kind],
      mode: 'python',
      theme: 'material-darker',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      extraKeys: {
        Tab: (cm) => cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    '),
        'Shift-Tab': (cm) => cm.indentSelection('subtract'),
        'Ctrl-S': () => this.save(),
        'Cmd-S': () => this.save(),
      },
    });
    this.cm.on('change', () => {
      this.drafts[this.kind] = this.cm.getValue();
      this.renderKinds();
      if (this.status[this.kind]?.ok !== false) this.renderStatus(); // keep a save error visible until the next save
    });

    root.querySelector('#cls-save').addEventListener('click', () => this.save());
    root.querySelector('#cls-reset').addEventListener('click', () => {
      if (!confirm(`Replace your ${BLOCKS[this.kind].label} class with the empty template?`)) return;
      this.cm.setValue(CLASS_TEMPLATES[this.kind]);
    });
    this.show(this.kind);
  }

  // CodeMirror measures itself wrong while its tab is hidden.
  refresh() { setTimeout(() => this.cm.refresh(), 0); }

  show(kind) {
    this.kind = kind;
    this.cm.setValue(this.drafts[kind]);
    this.cm.clearHistory();
    this.markError();
    this.renderKinds();
    this.renderStatus();
    this.refresh();
  }

  renderKinds() {
    for (const b of this.kindsEl.children) {
      const k = b.dataset.kind;
      b.classList.toggle('active', k === this.kind);
      b.classList.toggle('dirty', this.drafts[k] !== this.sources[k]);
      b.classList.toggle('bad', this.status[k] && !this.status[k].ok);
    }
  }

  renderStatus() {
    const s = this.status[this.kind];
    const dirty = this.drafts[this.kind] !== this.sources[this.kind];
    if (s && !s.ok) {
      this.statusEl.className = 'bad';
      this.statusEl.textContent = s.error;
    } else if (dirty) {
      this.statusEl.className = 'dim';
      this.statusEl.textContent = 'unsaved changes';
    } else {
      this.statusEl.className = 'good';
      this.statusEl.textContent = s ? 'saved ✓ running on every ' + BLOCKS[this.kind].label.toLowerCase() : '';
    }
  }

  markError() {
    if (this.errorLine != null) this.cm.removeLineClass(this.errorLine, 'background', 'cm-error-line');
    this.errorLine = null;
    const s = this.status[this.kind];
    if (s && !s.ok && s.line) {
      this.errorLine = s.line - 1;
      this.cm.addLineClass(this.errorLine, 'background', 'cm-error-line');
    }
  }

  async save() {
    const kind = this.kind;
    const src = this.cm.getValue();
    this.statusEl.className = 'dim';
    this.statusEl.textContent = 'saving…';
    const res = await this.bridge.saveClass(kind, src);
    if (res.ok) this.sources[kind] = src;  // the worker keeps the old class on failure
    this.status[kind] = res;
    if (kind === this.kind) { this.markError(); this.renderStatus(); }
    this.renderKinds();
  }
}
