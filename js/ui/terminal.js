// The terminal: a Python REPL bound to the worker, plus the game's own log lines.
//
// Keys: Enter runs (or continues a block after ':'), Shift+Enter adds a line,
// Enter on an empty line finishes a multi-line block, Up/Down history,
// Ctrl+C stops a running command (or clears the input), Ctrl+L clears the screen.

export class Terminal {
  constructor(root) {
    this.root = root;
    this.logEl = root.querySelector('#term-log');
    this.input = root.querySelector('#term-input');
    this.prompt = root.querySelector('#term-prompt');
    this.statusEl = root.querySelector('#term-status');
    this.history = [];
    this.histPos = 0;
    this.running = false;
    this.bridge = null;
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => this.autosize());
    this.logEl.addEventListener('mouseup', () => {
      if (!window.getSelection().toString()) this.input.focus();
    });
    this.setEnabled(false);
  }

  attach(bridge) { this.bridge = bridge; }

  // ---------- output ----------

  write(text, cls = '') {
    const atBottom = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 30;
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    line.textContent = text;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > 500) this.logEl.firstChild.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // Game events (placing, deleting, …) — dim, prefixed with "#" like a comment.
  log(msg, cls = '') { this.write(`# ${msg}`, `game ${cls}`); }

  echo(code) {
    code.split('\n').forEach((l, i) => this.write(`${i ? '... ' : '>>> '}${l}`, 'echo'));
  }

  clear() { this.logEl.innerHTML = ''; }

  // ---------- status ----------

  setStatus(state, detail = '') {
    const labels = {
      loading: 'Python: loading…',
      ready: `Python ready${detail ? ` (${detail})` : ''}`,
      busy: 'running… (Ctrl+C to stop)',
      restarting: 'Python: restarting…',
      failed: `Python failed to load: ${detail}`,
    };
    if (state === 'ready' && !detail && this.readyDetail) detail = this.readyDetail;
    if (state === 'ready' && detail) this.readyDetail = detail;
    this.statusEl.textContent = state === 'ready' ? `Python ready (${this.readyDetail || ''})` : labels[state];
    this.statusEl.dataset.state = state;
    this.running = state === 'busy';
    this.setEnabled(state === 'ready' || state === 'busy');
    if (state === 'ready') this.prompt.textContent = '>>>';
  }

  setEnabled(on) {
    this.input.disabled = !on;
    this.input.placeholder = on ? 'type Python, e.g. blocks   ·   help()' : 'waiting for Python…';
  }

  // ---------- input ----------

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 160) + 'px';
    this.prompt.textContent = this.input.value.includes('\n') ? '...' : '>>>';
  }

  insertNewline(extraIndent = '') {
    const v = this.input.value;
    const lastLine = v.slice(v.lastIndexOf('\n') + 1);
    const indent = lastLine.match(/^\s*/)[0] + extraIndent;
    const pos = this.input.selectionStart;
    this.input.value = v.slice(0, pos) + '\n' + indent + v.slice(this.input.selectionEnd);
    this.input.selectionStart = this.input.selectionEnd = pos + 1 + indent.length;
    this.autosize();
  }

  onKey(e) {
    const v = this.input.value;

    if (e.key === 'c' && e.ctrlKey && !this.input.value.slice(this.input.selectionStart, this.input.selectionEnd)) {
      e.preventDefault();
      if (this.running) this.bridge?.cancel();
      else { this.input.value = ''; this.autosize(); }
      return;
    }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      const pos = this.input.selectionStart;
      this.input.value = v.slice(0, pos) + '    ' + v.slice(this.input.selectionEnd);
      this.input.selectionStart = this.input.selectionEnd = pos + 4;
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) { this.insertNewline(); return; }
      const multiline = v.includes('\n');
      const lastLine = v.slice(v.lastIndexOf('\n') + 1);
      if (/:\s*$/.test(lastLine)) { this.insertNewline('    '); return; }
      if (multiline && lastLine.trim() !== '') { this.insertNewline(); return; }
      this.submit();
      return;
    }

    const singleLine = !v.includes('\n');
    if (e.key === 'ArrowUp' && singleLine && this.history.length) {
      e.preventDefault();
      this.histPos = Math.max(0, this.histPos - 1);
      this.input.value = this.history[this.histPos];
      this.autosize();
    } else if (e.key === 'ArrowDown' && singleLine && this.history.length) {
      e.preventDefault();
      this.histPos = Math.min(this.history.length, this.histPos + 1);
      this.input.value = this.history[this.histPos] ?? '';
      this.autosize();
    }
  }

  async submit() {
    if (this.running || !this.bridge) return;
    const code = this.input.value.replace(/\s+$/, '');
    this.input.value = '';
    this.autosize();
    if (!code.trim()) { this.write('>>>', 'echo'); return; }

    this.echo(code);
    if (this.history[this.history.length - 1] !== code) this.history.push(code);
    this.histPos = this.history.length;

    const res = await this.bridge.exec(code);
    if (res.ok) {
      if (res.repr != null) this.write(res.repr, 'result');
    } else {
      this.write(res.error, res.kind === 'refused' || res.kind === 'watchdog' ? 'refused' : 'error');
    }
    this.input.focus();
  }
}
