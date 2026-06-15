/**
 * ClientAgent — student-side agent.
 *
 * Runs on the student's page. Captures DOM state, observes mutations, sends
 * everything to the server, and replays interaction events received from
 * the admin.
 *
 *   const agent = new ClientAgent({
 *     sessionId: 'session-abc',
 *     serverUrl: 'wss://example.com/remote',
 *   });
 *   agent.start();
 */
import { Connection } from './connection.js';
import { DOMSerializer } from './dom-serializer.js';
import { MutationTracker } from './mutation-tracker.js';
import { EventReplayer } from './event-replayer.js';

export class ClientAgent {
  /**
   * @param {Object} opts
   * @param {string} opts.sessionId      Unique session identifier shared with the admin
   * @param {string} opts.serverUrl      WebSocket server endpoint
   * @param {number} [opts.snapshotIntervalMs=2000]  Milliseconds between full snapshots
   * @param {number} [opts.lightIntervalMs=200]      Milliseconds between light diffs
   * @param {boolean} [opts.mutations=true]          Enable MutationObserver for incremental updates
   * @param {Object} [opts.connectionOpts]           Passed through to Connection
   */
  constructor(opts = {}) {
    if (!opts.sessionId) throw new Error('ClientAgent: sessionId is required');
    if (!opts.serverUrl) throw new Error('ClientAgent: serverUrl is required');

    this.sessionId = opts.sessionId;
    this.serverUrl = opts.serverUrl;
    this.snapshotIntervalMs = opts.snapshotIntervalMs ?? 2000;
    this.lightIntervalMs = opts.lightIntervalMs ?? 200;
    this.enableMutations = opts.mutations ?? true;

    this._connection = new Connection(opts.serverUrl, opts.connectionOpts);
    this._serializer = new DOMSerializer();
    this._mutations = new MutationTracker({
      onMutations: (records) => this._send(records),
    });
    this._replayer = new EventReplayer();
    this._snapshotTimer = null;
    this._lightTimer = null;
    this._started = false;
    this._running = false;
  }

  /** Start the agent — connect, begin capture loop. */
  async start() {
    if (this._started) return;
    this._started = true;

    // Wire incoming admin events to the replayer
    this._connection.on('message', (msg) => {
      if (msg._type === 'interaction') {
        const result = this._replayer.replay(msg.event);
        if (!result.success) {
          console.warn('[WebRemoteAgent] event replay failed:', result.error);
        }
      } else if (msg._type === 'interaction-sequence') {
        this._replayer.replaySequence(msg.events, { delayMs: msg.delayMs ?? 50 });
      }
    });

    await this._connection.connect();

    // Send session registration
    this._send({ _type: 'register', sessionId: this.sessionId, role: 'client' });

    this._running = true;

    // Send initial full snapshot immediately
    this._send(this._serializer.serialize());

    // Start periodic capture
    this._snapshotTimer = setInterval(() => {
      if (!this._running) return;
      this._send(this._serializer.serialize());
    }, this.snapshotIntervalMs);

    this._lightTimer = setInterval(() => {
      if (!this._running) return;
      this._send(this._serializer.serializeLight());
    }, this.lightIntervalMs);

    // Start mutation tracking
    if (this.enableMutations) {
      this._mutations.start();
    }

    // Handle page unload
    window.addEventListener('beforeunload', this._onUnload);
    window.addEventListener('pagehide', this._onUnload);
  }

  /** Stop the agent — disconnect, tear down timers and observers. */
  stop() {
    this._running = false;
    this._started = false;

    if (this._snapshotTimer) {
      clearInterval(this._snapshotTimer);
      this._snapshotTimer = null;
    }
    if (this._lightTimer) {
      clearInterval(this._lightTimer);
      this._lightTimer = null;
    }

    this._mutations.stop();
    this._connection.close();

    window.removeEventListener('beforeunload', this._onUnload);
    window.removeEventListener('pagehide', this._onUnload);
  }

  // ---- internals ---------------------------------------------------------

  _send(payload) {
    this._connection.send(payload);
  }

  _onUnload = () => {
    this._send({ _type: 'unregister', sessionId: this.sessionId });
    this.stop();
  };
}
