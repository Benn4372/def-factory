// Main-thread side of the Python worker: messaging, heartbeat watchdog, restart.
// The UI never runs player code itself, so the page stays responsive even if
// Python gets stuck; if the worker stops answering we kill it and start fresh.

const HEARTBEAT_TIMEOUT_MS = 3000;

export class PythonBridge {
  constructor({ onStatus, onOutput, getLayout }) {
    this.onStatus = onStatus;   // (state, detail) state: loading | ready | busy | restarting | failed
    this.onOutput = onOutput;   // (text, stream) stream: out | err | sys
    this.getLayout = getLayout; // () => { blocks, money }
    this.pending = new Map();   // exec id -> resolve
    this.nextId = 1;
    this.start();
    setInterval(() => this.checkHeartbeat(), 500);
  }

  start() {
    this.ready = false;
    this.lastBeat = performance.now();
    this.onStatus('loading');
    this.worker = new Worker(new URL('./worker/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handle(e.data);
    this.worker.onerror = (e) => {
      this.onOutput(`Python worker error: ${e.message || 'unknown'}`, 'err');
    };
    this.sendLayout();
  }

  handle(msg) {
    switch (msg.type) {
      case 'hb':
        this.lastBeat = performance.now();
        break;
      case 'ready':
        this.ready = true;
        this.lastBeat = performance.now();
        this.onStatus('ready', `Pyodide ${msg.version}`);
        break;
      case 'fatal':
        this.onStatus('failed', msg.error);
        break;
      case 'out':
        this.onOutput(msg.text, msg.stream);
        break;
      case 'result': {
        const resolve = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (this.pending.size === 0 && this.ready) this.onStatus('ready');
        resolve?.(msg);
        break;
      }
    }
  }

  // Heartbeats only stop when Python is stuck in a long synchronous run that the
  // in-Python watchdog can't see (e.g. a loop inside C code). Restart the worker.
  checkHeartbeat() {
    if (!this.ready) return;
    if (performance.now() - this.lastBeat < HEARTBEAT_TIMEOUT_MS) return;
    this.restart('Python stopped responding for 3 seconds, so it was restarted. ' +
      'Variables you created in the terminal were lost.');
  }

  restart(reason) {
    this.worker.terminate();
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, kind: 'restarted', error: 'stopped: Python was restarted' });
    }
    this.pending.clear();
    this.onOutput(reason, 'sys');
    this.onStatus('restarting');
    this.start();
  }

  sendLayout() {
    this.worker.postMessage({ type: 'layout', layout: this.getLayout() });
  }

  exec(code) {
    const id = this.nextId++;
    this.onStatus('busy');
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'exec', id, code });
    });
  }

  cancel() {
    this.worker.postMessage({ type: 'cancel' });
  }
}
