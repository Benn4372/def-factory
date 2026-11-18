// Simulation worker: hosts Pyodide and the engine so player code never runs on
// the UI thread. Steps the game clock at 20 Hz and posts snapshots to the UI.

import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PY_FILES = ['safety.py', 'engine.py', 'runtime.py'];
const TICK_MS = 50; // matches engine.DT (0.05 s of game time per step)

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

const toJs = (proxy) => {
  const v = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return v;
};

// ---- boot ----
let py = null;
let runtime = null;
let speed = 1;        // 0 = paused
let selectedId = null;
let engineFailed = false;

const ready = (async () => {
  py = await loadPyodide({ indexURL: PYODIDE_URL });
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
  setInterval(tick, TICK_MS);
  postMessage({ type: 'ready', version: py.version });
})().catch((err) => {
  postMessage({ type: 'fatal', error: String(err?.message || err) });
});

let tickCount = 0;

function tick() {
  if (!runtime) return;
  try {
    if (speed > 0 && !engineFailed) runtime.step(speed);
    // Once a second, include plain-data block attributes so the UI can restore them after a restart.
    const persist = ++tickCount % 20 === 0;
    postMessage({ type: 'snapshot', snap: toJs(runtime.snapshot(selectedId, persist)), speed });
  } catch (err) {
    // A bug in the engine itself (not player code, which is caught per block).
    if (!engineFailed) {
      engineFailed = true;
      out(`engine error (simulation paused): ${String(err?.message || err).split('\n').slice(-2).join(' ')}`, 'err');
    }
  }
}

// ---- messages from the UI ----
onmessage = async (e) => {
  const msg = e.data;
  await ready;
  if (!runtime) return;

  switch (msg.type) {
    case 'config':
      runtime.configure(py.toPy(msg.config));
      break;

    case 'layout':
      runtime.sync(py.toPy(msg.layout));
      break;

    case 'class': {
      let result;
      try {
        result = toJs(runtime.save_class(msg.kind, msg.src));
      } catch (err) {
        result = { ok: false, error: `internal error: ${String(err?.message || err).split('\n').pop()}` };
      }
      if (msg.id != null) postMessage({ type: 'classResult', id: msg.id, ...result });
      else if (!result.ok) out(`${msg.kind} class failed to load: ${result.error}`, 'err');
      break;
    }

    case 'restore':
      runtime.restore_attrs(py.toPy(msg.attrs));
      break;

    case 'speed':
      speed = msg.speed;
      engineFailed = false;
      break;

    case 'select':
      selectedId = msg.id;
      break;

    case 'exec': {
      // Always answer, or the terminal would wait forever.
      let result;
      try {
        result = toJs(await runtime.repl(msg.code));
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
