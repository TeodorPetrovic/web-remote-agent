/**
 * MutationTracker — observes DOM mutations on the student's page and produces
 * compact mutation records that can be sent to the admin viewer for efficient
 * incremental updates.
 */
export class MutationTracker {
  /**
   * @param {Object} [opts]
   * @param {function} [opts.onMutations]  Callback receiving mutation records
   * @param {MutationObserverInit} [opts.observerConfig]
   */
  constructor(opts = {}) {
    this.onMutations = opts.onMutations || null;
    this._observer = null;
    this._pending = [];
    this._flushTimer = null;
    this._flushDelayMs = opts.flushDelayMs ?? 100; // batch window
    this._observerConfig = opts.observerConfig ?? {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    };
  }

  /** Start observing the document. */
  start() {
    if (this._observer) return;

    this._observer = new MutationObserver((records) => {
      this._pending.push(...records);
      this._scheduleFlush();
    });

    this._observer.observe(document.documentElement, this._observerConfig);
  }

  /** Stop observing and flush any pending mutations. */
  stop() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._flush();
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /** Immediately flush pending mutations. */
  flush() {
    this._flush();
  }

  // ---- internals ---------------------------------------------------------

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, this._flushDelayMs);
  }

  _flush() {
    if (this._pending.length === 0) return;

    const records = this._pending.map((r) => this._serializeRecord(r));
    this._pending = [];

    if (this.onMutations && records.length > 0) {
      this.onMutations({
        _type: 'mutations',
        records,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Convert a MutationRecord into a compact, JSON-safe object.
   */
  _serializeRecord(record) {
    const serialized = {
      type: record.type,
      target: this._nodeSelector(record.target),
    };

    if (record.type === 'childList') {
      serialized.addedNodes = Array.from(record.addedNodes)
        .map((n) => this._serializeNode(n))
        .filter(Boolean);
      serialized.removedNodes = Array.from(record.removedNodes)
        .map((n) => this._serializeNode(n))
        .filter(Boolean);
      if (record.previousSibling) {
        serialized.previousSibling = this._nodeSelector(record.previousSibling);
      }
      if (record.nextSibling) {
        serialized.nextSibling = this._nodeSelector(record.nextSibling);
      }
    }

    if (record.type === 'attributes') {
      serialized.attributeName = record.attributeName;
      serialized.oldValue = record.oldValue;
      serialized.newValue = record.target.getAttribute(record.attributeName);
    }

    if (record.type === 'characterData') {
      serialized.oldValue = record.oldValue;
      serialized.newValue = record.target.textContent;
    }

    return serialized;
  }

  _serializeNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return { nodeType: 'element', html: node.outerHTML };
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const trimmed = node.textContent.trim();
      if (!trimmed) return null;
      return { nodeType: 'text', content: trimmed };
    }
    return null;
  }

  _nodeSelector(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      // For text nodes, reference the parent element
      return node.parentElement ? this._nodeSelector(node.parentElement) : null;
    }

    if (node.id) return `#${CSS.escape(node.id)}`;

    const parts = [];
    let current = node;
    while (current && current !== document.documentElement) {
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
