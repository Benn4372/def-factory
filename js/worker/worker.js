// Simulation worker: hosts Pyodide so player code never runs on the UI thread.
// Phase 1: terminal REPL + layout mirroring. The engine joins this worker in Phase 2.

import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PY_FILES = ['safety.py', 'runtime.py'];

// ---- output, rate-limited so a print loop can't flood the UI ----
const OUTPUT_LINES_PER_SEC = 200;
let windowStart = 0;
let linesThisWindow = 0;
let droppedNotice = false;

function out(text, stream) {
  const now = performance.now();
  if (now - windowStart > 1000) {
    windowStart = now;
    linesThisWindow = 0;
    droppedNotice = false;
  }
  if (++linesThisWindow > OUTPUT_LINES_PER_SEC) {
    if (!droppedNotice) {
      droppedNotice = true;
      postMessage({ type: 'out', stream: 'err', text: '[output limited: too many lines per second, some were dropped]' });
    }
    return;
  }
  postMessage({ type: 'out', stream, text });
}

// ---- boot ----
let runtime = null;

const ready = (async () => {
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  py.setStdout({ batched: (s) => out(s, 'out') });
  py.setStderr({ batched: (s) => out(s, 'err') });

  py.FS.mkdirTree('/game');
  for (const f of PY_FILES) {
    const res = await fetch(new URL(`../../py/${f}`, import.meta.url));
    if (!res.ok) throw new Error(`could not load py/${f} (${res.status})`);
    py.FS.writeFile(`/game/${f}`, await res.text());
  }
  py.runPython(`import sys; sys.path.insert(0, '/game')`);
  runtime = py.pyimport('runtime');

  setInterval(() => postMessage({ type: 'hb' }), 250);
  postMessage({ type: 'ready', version: py.version });
})().catch((err) => {
  postMessage({ type: 'fatal', error: String(err?.message || err) });
});

// ---- messages from the UI ----
onmessage = async (e) => {
  const msg = e.data;
  await ready;
  if (!runtime) return;

  switch (msg.type) {
    case 'layout':
      runtime.sync(msg.layout);
      break;

    case 'exec': {
      // Always answer, or the terminal would wait forever.
      let result;
      try {
        const proxy = await runtime.repl(msg.code);
        result = proxy.toJs({ dict_converter: Object.fromEntries });
        proxy.destroy();
      } catch (err) {
        result = { ok: false, kind: 'error', error: `internal error: ${String(err?.message || err).split('\n').pop()}` };
      }
      postMessage({ type: 'result', id: msg.id, ...result });
      break;
    }

    case 'cancel':
      runtime.cancel();
      break;
  }
};
