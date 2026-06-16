/**
 * ViewerAgent — admin-side agent.
 *
 * Runs on the admin's dashboard. Connects to the server, receives DOM
 * snapshots from a specific student session, reconstructs them in a
 * sandboxed iframe, and captures the admin's interactions to send back
 * to the student.
 *
 *   const viewer = new ViewerAgent({
 *     sessionId: 'session-abc',
 *     serverUrl: 'wss://example.com/remote',
 *     container: document.getElementById('remote-view'),
 *   });
 *   viewer.start();
 */
import { Connection } from './connection.js';
import { DOMReconstructor } from './dom-reconstructor.js';

export class ViewerAgent {
  /**
   * @param {Object} opts
   * @param {string} opts.sessionId           Session to observe
   * @param {string} opts.serverUrl           WebSocket server endpoint
   * @param {HTMLElement} opts.container      Container element — an iframe will be created inside
   * @param {boolean} [opts.allowInteraction=true]    Enable admin-to-student interaction
   * @param {boolean} [opts.allowScripts=false]       Allow scripts in reconstructed page
   * @param {Object} [opts.connectionOpts]            Passed through to Connection
   */
  constructor(opts = {}) {
    if (!opts.sessionId) throw new Error('ViewerAgent: sessionId is required');
    if (!opts.serverUrl) throw new Error('ViewerAgent: serverUrl is required');
    if (!opts.container) throw new Error('ViewerAgent: container element is required');

    this.sessionId = opts.sessionId;
    this.serverUrl = opts.serverUrl;
    this.container = opts.container;
    this.allowInteraction = opts.allowInteraction ?? true;
    this._connection = new Connection(opts.serverUrl, opts.connectionOpts);

    // Create the sandboxed iframe
    this._iframe = this._createIframe(opts.allowScripts ?? false);

    // DOMReconstructor calls onContentWritten after each doc.write() so
    // we can re-bind interaction listeners on the fresh document.
    this._reconstructor = new DOMReconstructor(this._iframe, {
      allowScripts: opts.allowScripts ?? false,
      onContentWritten: (doc) => this._bindInteractionListeners(doc),
    });

    this._started = false;
    this._interactionMode = false; // toggled by the admin
    this._frozen = false;         // freeze live updates to inspect the page
    this._onFrameClick = this._onFrameClick.bind(this);
    this._onFrameInput = this._onFrameInput.bind(this);
    this._onFrameKey = this._onFrameKey.bind(this);
    this._onFrameScroll = this._onFrameScroll.bind(this);
    this._onFrameMouseMove = this._onFrameMouseMove.bind(this);
  }

  /** Start the viewer — connect and begin receiving snapshots. */
  async start() {
    if (this._started) return;
    this._started = true;

    this._connection.on('message', (msg) => {
      // When frozen, skip snapshot updates so the admin can inspect
      // the page at their leisure without live data overwriting it.
      if (this._frozen && (msg._type === 'snapshot' || msg._type === 'light-snapshot')) {
        return;
      }

      switch (msg._type) {
        case 'snapshot':
          this._reconstructor.applySnapshot(msg);
          break;
        case 'light-snapshot':
          this._reconstructor.applyLightSnapshot(msg);
          break;
        case 'mutations':
          // Mutations are best-effort; we rely on full snapshots for correctness
          // Future: apply incremental mutation patches here
          break;
        case 'error':
          console.error('[WebRemoteAgent] Server error:', msg.message);
          break;
      }
    });

    await this._connection.connect();

    // Register as viewer for this session
    this._send({ _type: 'register', sessionId: this.sessionId, role: 'viewer' });

    // Bind interaction listeners on the initial about:blank document if
    // it's already accessible. After each snapshot write, onContentWritten
    // re-binds them automatically.
    if (this.allowInteraction) {
      const doc = this._iframe.contentDocument;
      if (doc) {
        this._bindInteractionListeners(doc);
      }
    }
  }

  /** Stop the viewer. */
  stop() {
    const doc = this._iframe.contentDocument;
    if (doc) this._unbindInteractionListeners(doc);
    this._connection.close();
    this._started = false;
  }

  /** Enable or disable admin-to-student interaction mode. */
  setInteractionMode(enabled) {
    this._interactionMode = enabled;
  }

  /**
   * Freeze or unfreeze live updates. When frozen, incoming snapshots are
   * ignored so the admin can inspect the page without it refreshing.
   * The most recent snapshot before freezing is preserved. When unfrozen,
   * the next live snapshot restores the stream.
   */
  setFrozen(frozen) {
    this._frozen = frozen;
  }

  /** Whether live updates are currently frozen. */
  get isFrozen() {
    return this._frozen;
  }

  /** Get the underlying iframe element (e.g., to style or measure). */
  get iframe() {
    return this._iframe;
  }

  /** Get the DOMReconstructor instance. */
  get reconstructor() {
    return this._reconstructor;
  }

  // ---- internals ---------------------------------------------------------

  _send(payload) {
    this._connection.send(payload);
  }

  _createIframe(allowScripts) {
    const iframe = document.createElement('iframe');

    // Use the most restrictive sandbox that still allows rendering
    const sandboxTokens = ['allow-same-origin'];
    if (allowScripts) {
      sandboxTokens.push('allow-scripts');
    }
    iframe.setAttribute('sandbox', sandboxTokens.join(' '));
    iframe.style.cssText = 'width:100%;height:100%;border:none;';

    this.container.appendChild(iframe);
    return iframe;
  }

  /**
   * Bind interaction listeners on the given document.
   * Called once on start() for the initial about:blank doc, then again
   * via onContentWritten after each snapshot write replaces the content.
   */
  _bindInteractionListeners(doc) {
    if (!this.allowInteraction) return;
    if (!doc) return;

    // Remove stale listeners first (in case we're re-binding after a write)
    this._unbindInteractionListeners(doc);

    doc.addEventListener('click', this._onFrameClick, true);
    doc.addEventListener('input', this._onFrameInput, true);
    doc.addEventListener('change', this._onFrameInput, true);
    doc.addEventListener('keydown', this._onFrameKey, true);
    doc.addEventListener('scroll', this._onFrameScroll, true);
    doc.addEventListener('mousemove', this._onFrameMouseMove, true);
  }

  _unbindInteractionListeners(doc) {
    if (!doc) return;
    doc.removeEventListener('click', this._onFrameClick, true);
    doc.removeEventListener('input', this._onFrameInput, true);
    doc.removeEventListener('change', this._onFrameInput, true);
    doc.removeEventListener('keydown', this._onFrameKey, true);
    doc.removeEventListener('scroll', this._onFrameScroll, true);
    doc.removeEventListener('mousemove', this._onFrameMouseMove, true);
  }

  _onFrameClick(e) {
    if (!this._interactionMode) return;
    e.preventDefault();
    e.stopPropagation();
    this._sendInteraction({
      type: 'click',
      selector: this._getSelector(e.target),  // preferred by EventReplayer
      coords: { x: e.clientX, y: e.clientY }, // fallback
      button: e.button,
    });
  }

  _onFrameInput(e) {
    if (!this._interactionMode) return;
    this._sendInteraction({
      type: e.type,
      selector: this._getSelector(e.target),
      value: e.target.value,
      checked: e.target.checked,
    });
  }

  _onFrameKey(e) {
    if (!this._interactionMode) return;
    this._sendInteraction({
      type: e.type,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
    });
  }

  _onFrameScroll(e) {
    if (!this._interactionMode) return;
    this._sendInteraction({
      type: 'scroll',
      scrollX: e.target.scrollLeft,
      scrollY: e.target.scrollTop,
    });
  }

  _onFrameMouseMove(e) {
    if (!this._interactionMode) return;
    // Throttled — only send every ~50ms to avoid flooding
    if (this._lastMouseMove && Date.now() - this._lastMouseMove < 50) return;
    this._lastMouseMove = Date.now();
    this._sendInteraction({
      type: 'mousemove',
      selector: this._getSelector(e.target),
      coords: { x: e.clientX, y: e.clientY },
    });
  }

  _sendInteraction(event) {
    this._send({
      _type: 'interaction',
      sessionId: this.sessionId,
      event,
      timestamp: Date.now(),
    });
  }

  /**
   * Build a selector for an element within the iframe's document.
   */
  _getSelector(el) {
    if (!el || el === this._iframe.contentDocument?.documentElement) return 'html';
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let current = el;
    while (current && current !== this._iframe.contentDocument?.documentElement) {
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          selector += `:nth-child(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(selector);
      current = parent;
    }
    return parts.join(' > ');
  }
}
