/**
 * Connection — thin WebSocket wrapper with auto-reconnect, JSON message
 * routing, and event emitter semantics.
 */
export class Connection {
  /**
   * @param {string} url        WebSocket endpoint URL
   * @param {Object} [opts]
   * @param {number} [opts.maxReconnectAttempts=10]  0 = no reconnect
   * @param {number} [opts.reconnectDelayMs=1000]    Base delay (doubles each attempt)
   * @param {number} [opts.maxReconnectDelayMs=30000] Ceiling for exponential backoff
   * @param {number} [opts.heartbeatIntervalMs=15000] Ping interval
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 30000;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 15000;

    this._ws = null;
    this._handlers = new Map();
    this._reconnectAttempts = 0;
    this._heartbeatTimer = null;
    this._intentionalClose = false;
    this._connected = false;
    this._connectPromise = null;
    this._connectResolve = null;
  }

  // ---- public API --------------------------------------------------------

  /** Open the WebSocket. Returns a promise that resolves on first open. */
  connect() {
    if (this._connected) return Promise.resolve();
    this._intentionalClose = false;
    this._connectPromise = new Promise((resolve) => {
      this._connectResolve = resolve;
    });
    this._open();
    return this._connectPromise;
  }

  /** Send a JSON-serializable message. */
  send(message) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this._emit('error', new Error('WebSocket not open — message dropped'));
      return;
    }
    this._ws.send(JSON.stringify(message));
  }

  /** Register an event listener. Events: open, close, message, error, reconnect. */
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
  }

  /** Remove an event listener. */
  off(event, fn) {
    const set = this._handlers.get(event);
    if (set) set.delete(fn);
  }

  /** Graceful close — no reconnect. */
  close(code = 1000) {
    this._intentionalClose = true;
    this._stopHeartbeat();
    if (this._ws) {
      this._ws.close(code);
      this._ws = null;
    }
    this._connected = false;
  }

  /** Whether the socket is currently open. */
  get isConnected() {
    return this._connected;
  }

  // ---- internals ---------------------------------------------------------

  _open() {
    if (this._ws) {
      this._ws.onopen = null;
      this._ws.onclose = null;
      this._ws.onerror = null;
      this._ws.onmessage = null;
    }

    const ws = new WebSocket(this.url);
    this._ws = ws;

    ws.onopen = () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      this._startHeartbeat();
      this._emit('open');
      if (this._connectResolve) {
        this._connectResolve();
        this._connectResolve = null;
      }
    };

    ws.onmessage = (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        // Non-JSON messages are forwarded as raw strings
        this._emit('message', { raw: evt.data });
        return;
      }

      // Handle internal heartbeat pongs silently
      if (data._type === 'pong') return;

      this._emit('message', data);
    };

    ws.onclose = (evt) => {
      this._connected = false;
      this._stopHeartbeat();
      this._emit('close', { code: evt.code, reason: evt.reason });

      if (!this._intentionalClose && this._reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(
          this.reconnectDelayMs * Math.pow(2, this._reconnectAttempts),
          this.maxReconnectDelayMs,
        );
        this._reconnectAttempts++;
        this._emit('reconnect', { attempt: this._reconnectAttempts, delayMs: delay });
        setTimeout(() => this._open(), delay);
      }
    };

    ws.onerror = () => {
      // onclose always fires after onerror, so we only emit here for
      // logging / diagnostic purposes
      this._emit('error', new Error('WebSocket transport error'));
    };
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ _type: 'ping' }));
      }
    }, this.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        // Don't let one handler kill others
        console.error('[WebRemoteAgent] handler error:', err);
      }
    }
  }
}
