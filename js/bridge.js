// Main-thread side of the Python worker: messaging, heartbeat watchdog, restart.
// The UI never runs player code itself, so the page stays responsive even if
// Python gets stuck; if the worker stops answering we kill it and start fresh,
// re-sending config, the saved classes, the layout and the speed.

const HEARTBEAT_TIMEOUT_MS = 3000;

export class PythonBridge {
  constructor({ onStatus, onOutput, onSnapshot, getLayout, getClasses, config }) {
    this.onStatus = onStatus;     // (state, detail) state: loading | ready | busy | restarting | failed
    this.onOutput = onOutput;     // (text, stream)
    this.onSnapshot = onSnapshot; // (snap, speed)
    this.getLayout = getLayout;   // () => { blocks, money }
    this.getClasses = getClasses; // () => { kind: src }
    this.config = config;
    this.pendingExec = new Map();
    this.pendingClass = new Map();
    this.nextId = 1;
    this.speed = 1;
    this.selectedId = null;
    this.start();
    setInterval(() => this.checkHeartbeat(), 500);
  }

  start() {
    this.ready = false;
    this.lastBeat = performance.now();
    this.onStatus('loading');
    this.worker = new Worker(new URL('./worker/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handle(e.data);
    this.worker.onerror = (e) => this.onOutput(`Python worker error: ${e.message || 'unknown'}`, 'err');
    // Order matters: classes before layout, so new blocks run the player's on_place.
    this.post({ type: 'config', config: this.config });
    for (const [kind, src] of Object.entries(this.getClasses())) this.post({ type: 'class', kind, src });
    this.sendLayout();
    if (this.savedAttrs) this.post({ type: 'restore', attrs: this.savedAttrs });
    this.post({ type: 'speed', speed: this.speed });
    this.post({ type: 'select', id: this.selectedId });
  }

  post(msg) { this.worker.postMessage(msg); }

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
      case 'snapshot':
        if (msg.snap.persist) this.savedAttrs = msg.snap.persist;
        this.onSnapshot(msg.snap, msg.speed);
        break;
      case 'result': {
        const resolve = this.pendingExec.get(msg.id);
        this.pendingExec.delete(msg.id);
        if (this.pendingExec.size === 0 && this.ready) this.onStatus('ready');
        resolve?.(msg);
        break;
      }
      case 'classResult': {
        const resolve = this.pendingClass.get(msg.id);
        this.pendingClass.delete(msg.id);
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
      'Items in the factory and terminal variables were lost; the layout, saved classes and ' +
      'block attributes (as of the last second) were restored.');
  }

  restart(reason) {
    this.worker.terminate();
    for (const resolve of this.pendingExec.values()) {
      resolve({ ok: false, kind: 'restarted', error: 'stopped: Python was restarted' });
    }
    for (const resolve of this.pendingClass.values()) {
      resolve({ ok: false, error: 'Python was restarted; save again' });
    }
    this.pendingExec.clear();
    this.pendingClass.clear();
    this.onOutput(reason, 'sys');
    this.onStatus('restarting');
    this.start();
  }

  sendLayout() { this.post({ type: 'layout', layout: this.getLayout() }); }

  setSpeed(speed) {
    this.speed = speed;
    this.post({ type: 'speed', speed });
  }

  select(id) {
    this.selectedId = id;
    this.post({ type: 'select', id });
  }

  exec(code) {
    const id = this.nextId++;
    this.onStatus('busy');
    return new Promise((resolve) => {
      this.pendingExec.set(id, resolve);
      this.post({ type: 'exec', id, code });
    });
  }

  saveClass(kind, src) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pendingClass.set(id, resolve);
      this.post({ type: 'class', id, kind, src });
    });
  }

  cancel() { this.post({ type: 'cancel' }); }
}
