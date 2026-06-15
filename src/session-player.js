/**
 * SessionPlayer — replays a recorded session timeline into a DOMReconstructor
 * at a configurable speed with play/pause/seek controls.
 *
 *   const player = new SessionPlayer(reconstructor);
 *   player.load(timeline);  // from SessionRecorder.export()
 *   player.play(1.0);       // 1x speed
 *   player.seek(5000);      // jump to 5 seconds
 *   player.pause();
 */
export class SessionPlayer {
  /**
   * @param {import('./dom-reconstructor.js').DOMReconstructor} reconstructor
   *   The reconstructor to feed snapshots into.
   * @param {Object} [opts]
   * @param {function} [opts.onTick] Called each frame with { elapsed, frameIndex, frameCount }
   * @param {function} [opts.onEnd]  Called when playback reaches the end
   * @param {function} [opts.onStateChange] Called when play/pause/stop state changes
   */
  constructor(reconstructor, opts = {}) {
    if (!reconstructor) throw new Error('SessionPlayer requires a DOMReconstructor');
    this._reconstructor = reconstructor;
    this._onTick = opts.onTick || null;
    this._onEnd = opts.onEnd || null;
    this._onStateChange = opts.onStateChange || null;

    this._timeline = [];
    this._speed = 1.0;
    this._state = 'stopped'; // stopped | playing | paused
    this._cursor = 0;          // index into timeline
    this._elapsed = 0;         // virtual elapsed ms
    this._lastRealTime = 0;
    this._rafId = null;
    this._duration = 0;
  }

  // ---- public API --------------------------------------------------------

  /**
   * Load a timeline from a SessionRecorder export.
   * @param {import('./session-recorder.js').SessionRecording} recording
   */
  load(recording) {
    if (!recording || !Array.isArray(recording.timeline)) {
      throw new Error('Invalid recording: missing timeline array');
    }
    this._timeline = recording.timeline;
    this._duration = recording.durationMs || (
      this._timeline.length > 0
        ? this._timeline[this._timeline.length - 1].elapsed
        : 0
    );
    this.seek(0);
  }

  /** Start or resume playback. */
  play(speed = this._speed) {
    if (this._state === 'playing') return;
    if (this._timeline.length === 0) return;

    this._speed = speed;
    this._state = 'playing';
    this._lastRealTime = performance.now();
    this._emitStateChange();
    this._tick();
  }

  /** Pause playback (keeps position). */
  pause() {
    if (this._state !== 'playing') return;
    this._state = 'paused';
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emitStateChange();
  }

  /** Stop playback and reset to beginning. */
  stop() {
    this.pause();
    this._state = 'stopped';
    this.seek(0);
    this._emitStateChange();
  }

  /**
   * Seek to a specific elapsed time in milliseconds.
   * @param {number} elapsedMs
   */
  seek(elapsedMs) {
    const target = Math.max(0, Math.min(elapsedMs, this._duration));

    // Find the last full snapshot at or before the target time
    let lastSnapshot = null;
    let lastIndex = 0;

    for (let i = 0; i < this._timeline.length; i++) {
      const entry = this._timeline[i];
      if (entry.elapsed > target) break;

      if (entry.message._type === 'snapshot') {
        lastSnapshot = entry.message;
        lastIndex = i;
      }
    }

    if (lastSnapshot) {
      this._reconstructor.applySnapshot(lastSnapshot);
    }

    // Apply any light-snapshots between the last full snapshot and the target
    for (let i = lastIndex + 1; i < this._timeline.length; i++) {
      const entry = this._timeline[i];
      if (entry.elapsed > target) break;

      if (entry.message._type === 'light-snapshot') {
        this._reconstructor.applyLightSnapshot(entry.message);
      }
    }

    this._elapsed = target;
    this._cursor = lastIndex;
    this._emitTick();
  }

  /** Set playback speed multiplier (0.25, 0.5, 1, 2, 4, etc.). */
  setSpeed(multiplier) {
    this._speed = Math.max(0.1, Math.min(multiplier, 10));
    // If currently playing, reset the real-time anchor so speed change
    // takes effect immediately.
    if (this._state === 'playing') {
      this._lastRealTime = performance.now();
    }
  }

  /** Current playback state: stopped | playing | paused. */
  get state() {
    return this._state;
  }

  /** Current virtual elapsed time in milliseconds. */
  get currentTime() {
    return this._elapsed;
  }

  /** Total duration of the loaded recording in milliseconds. */
  get duration() {
    return this._duration;
  }

  /** Current playback speed multiplier. */
  get speed() {
    return this._speed;
  }

  /** Current timeline index. */
  get cursor() {
    return this._cursor;
  }

  /** Total number of frames in the timeline. */
  get frameCount() {
    return this._timeline.length;
  }

  /** Check whether a recording is loaded. */
  get hasRecording() {
    return this._timeline.length > 0;
  }

  // ---- internals ---------------------------------------------------------

  _tick() {
    if (this._state !== 'playing') return;

    const now = performance.now();
    const realDelta = now - this._lastRealTime;
    this._lastRealTime = now;

    // Advance virtual time by real delta * speed
    this._elapsed += realDelta * this._speed;

    // Apply all frames up to the current elapsed time
    while (this._cursor < this._timeline.length) {
      const entry = this._timeline[this._cursor];
      if (entry.elapsed > this._elapsed) break;

      switch (entry.message._type) {
        case 'snapshot':
          this._reconstructor.applySnapshot(entry.message);
          break;
        case 'light-snapshot':
          this._reconstructor.applyLightSnapshot(entry.message);
          break;
        // mutations and interactions are skipped during replay
      }
      this._cursor++;
    }

    this._emitTick();

    // Check if we've reached the end
    if (this._cursor >= this._timeline.length) {
      this._state = 'stopped';
      this._emitStateChange();
      if (this._onEnd) this._onEnd();
      return;
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _emitTick() {
    if (this._onTick) {
      this._onTick({
        elapsed: this._elapsed,
        duration: this._duration,
        frameIndex: this._cursor,
        frameCount: this._timeline.length,
        state: this._state,
      });
    }
  }

  _emitStateChange() {
    if (this._onStateChange) {
      this._onStateChange({
        state: this._state,
        elapsed: this._elapsed,
        speed: this._speed,
      });
    }
  }
}
