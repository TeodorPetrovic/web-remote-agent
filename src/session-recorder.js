/**
 * SessionRecorder — captures all incoming messages (snapshots, light-snapshots,
 * mutations, interactions) into a timestamped timeline that can be exported
 * and replayed later.
 *
 *   const recorder = new SessionRecorder();
 *   connection.on('message', (msg) => recorder.record(msg));
 *   // ... later ...
 *   const timeline = recorder.export();
 *   // Save timeline to localStorage, file, etc.
 */
export class SessionRecorder {
  constructor() {
    this._recording = false;
    this._timeline = [];
    this._startTime = null;
    this._sessionId = null;
  }

  /** Start recording. */
  start(sessionId = null) {
    this._recording = true;
    this._startTime = performance.now();
    this._sessionId = sessionId;
    // Keep existing timeline if resuming
  }

  /** Stop recording (keeps timeline in memory). */
  stop() {
    this._recording = false;
  }

  /** Clear the recording buffer and reset. */
  reset() {
    this._timeline = [];
    this._startTime = null;
    this._sessionId = null;
    this._recording = false;
  }

  /** Whether recording is active. */
  get isRecording() {
    return this._recording;
  }

  /** Number of recorded frames. */
  get frameCount() {
    return this._timeline.length;
  }

  /** Duration of the recording in milliseconds (wall-clock). */
  get duration() {
    if (this._timeline.length === 0) return 0;
    return this._timeline[this._timeline.length - 1].elapsed;
  }

  /**
   * Record a message from the WebSocket stream.
   * Call this from your connection.on('message') handler.
   */
  record(message) {
    if (!this._recording) return;

    // Only record meaningful message types
    const recordableTypes = new Set([
      'snapshot', 'light-snapshot', 'mutations', 'interaction',
    ]);
    if (!recordableTypes.has(message._type)) return;

    this._timeline.push({
      elapsed: performance.now() - this._startTime,
      timestamp: Date.now(),
      message: structuredClone ? structuredClone(message) : JSON.parse(JSON.stringify(message)),
    });
  }

  /**
   * Export the recording as a JSON-serializable object.
   * @returns {SessionRecording}
   */
  export() {
    return {
      _format: 'web-remote-agent-recording-v1',
      sessionId: this._sessionId,
      recordedAt: new Date().toISOString(),
      durationMs: this.duration,
      frameCount: this._timeline.length,
      timeline: this._timeline,
    };
  }

  /**
   * Import a previously exported recording.
   * @param {SessionRecording} data
   */
  import(data) {
    if (!data || data._format !== 'web-remote-agent-recording-v1') {
      throw new Error('Invalid recording format');
    }
    this._timeline = data.timeline || [];
    this._sessionId = data.sessionId || null;
    this._recording = false;
  }

  /**
   * Download the recording as a .json file.
   * @param {string} [filename]
   */
  download(filename) {
    const name = filename || `session-${this._sessionId || 'recording'}-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(this.export(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Load a recording from a File object (e.g., from a file input).
   * @param {File} file
   * @returns {Promise<void>}
   */
  async loadFromFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    this.import(data);
  }
}

/**
 * @typedef {Object} SessionRecording
 * @property {'web-remote-agent-recording-v1'} _format
 * @property {string|null} sessionId
 * @property {string} recordedAt
 * @property {number} durationMs
 * @property {number} frameCount
 * @property {TimelineEntry[]} timeline
 */

/**
 * @typedef {Object} TimelineEntry
 * @property {number} elapsed   Milliseconds from recording start
 * @property {number} timestamp  Unix epoch milliseconds
 * @property {Object} message    The original snapshot/light-snapshot/etc.
 */
