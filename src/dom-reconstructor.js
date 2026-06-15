/**
 * DOMReconstructor — takes a serialized snapshot and renders it inside a
 * sandboxed iframe on the admin viewer side so the admin sees exactly what
 * the student sees.
 */
export class DOMReconstructor {
  /**
   * @param {HTMLIFrameElement} iframe — a sandboxed iframe element
   * @param {Object} [opts]
   * @param {boolean} [opts.allowScripts=false] Enable scripts inside the
   *   reconstructed page (security risk — only enable for trusted content)
   * @param {function} [opts.onContentWritten] Called after each doc.write
   *   completes, so callers can re-bind event listeners on the fresh document
   */
  constructor(iframe, opts = {}) {
    if (!iframe || iframe.tagName !== 'IFRAME') {
      throw new Error('DOMReconstructor requires an <iframe> element');
    }
    this._iframe = iframe;
    this._allowScripts = opts.allowScripts ?? false;
    this._onContentWritten = opts.onContentWritten || null;
    this._lastSnapshot = null;
    this._ready = false;

    // Proactive check: the iframe may already be loaded (e.g. about:blank
    // fired its load event synchronously before we could listen).
    if (this._getDoc()) {
      this._ready = true;
    }

    // Safety net: if the iframe wasn't loaded yet, wait for the load event.
    // We add the listener after the proactive check so that if load fires
    // between the check and here, we still catch it.
    if (!this._ready) {
      this._iframe.addEventListener('load', () => {
        this._ready = true;
        if (this._lastSnapshot) {
          this._applySnapshot(this._lastSnapshot);
        }
      }, { once: true });
    }
  }

  /**
   * Apply a full snapshot to the iframe.
   * @param {import('./dom-serializer').Snapshot} snapshot
   */
  applySnapshot(snapshot) {
    this._lastSnapshot = snapshot;

    // If we can access the document right now, apply immediately.
    // This handles both the case where the iframe loaded before we
    // listened (constructor set _ready=true) and any transient state.
    if (this._getDoc()) {
      this._ready = true;
      this._applySnapshot(snapshot);
      return;
    }

    // Document isn't accessible yet — either cross-origin or the iframe
    // hasn't finished its initial load. The load handler will replay
    // _lastSnapshot when it fires.
  }

  /**
   * Apply only the lightweight form/scroll/focus updates.
   * @param {import('./dom-serializer').LightSnapshot} light
   */
  applyLightSnapshot(light) {
    const doc = this._getDoc();
    if (!doc) return;

    // Scroll
    if (light.scroll) {
      doc.defaultView?.scrollTo(light.scroll.x, light.scroll.y);
    }

    // Form values
    if (light.forms) {
      for (const field of light.forms) {
        try {
          const el = doc.querySelector(field.selector);
          if (!el) continue;
          if (field.tag === 'input' && (field.inputType === 'checkbox' || field.inputType === 'radio')) {
            el.checked = field.checked;
          } else if (field.tag === 'select') {
            el.value = field.value;
          } else if (field.tag === 'textarea') {
            el.value = field.value;
          } else if (el.getAttribute('contenteditable') === 'true') {
            el.innerHTML = field.value || '';
          } else if (el.tagName === 'INPUT') {
            el.value = field.value || '';
          }
        } catch {
          // Element may not exist in reconstructed DOM — safe to skip
        }
      }
    }

    // Focus (visual indicator only — don't actually focus in the iframe)
    if (light.focus) {
      try {
        const el = doc.querySelector(light.focus.selector);
        if (el && el.focus) {
          el.focus({ preventScroll: true });
        }
      } catch { /* ignore */ }
    }
  }

  /** Clear the iframe contents. */
  clear() {
    const doc = this._getDoc();
    if (doc) {
      doc.open();
      doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
      doc.close();
    }
    this._lastSnapshot = null;
  }

  /** Check whether the iframe document is accessible. */
  isReady() {
    return !!this._getDoc();
  }

  // ---- internals ---------------------------------------------------------

  _applySnapshot(snapshot) {
    const doc = this._getDoc();
    if (!doc) return;

    // Write the remote page's HTML into the iframe. We strip scripts
    // for security unless explicitly allowed.
    let html = snapshot.html;
    if (!this._allowScripts) {
      html = this._stripScripts(html);
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Notify that new content was written (so ViewerAgent can re-bind
    // interaction listeners on the fresh document).
    if (this._onContentWritten) {
      this._onContentWritten(doc);
    }

    // After the write completes (next animation frame), restore scroll
    // position and form values.
    requestAnimationFrame(() => {
      if (snapshot.scroll) {
        doc.defaultView?.scrollTo(snapshot.scroll.x, snapshot.scroll.y);
      }
      if (snapshot.forms) {
        for (const field of snapshot.forms) {
          try {
            const el = doc.querySelector(field.selector);
            if (!el) continue;
            if (field.tag === 'input' && (field.inputType === 'checkbox' || field.inputType === 'radio')) {
              el.checked = field.checked;
            } else if (field.tag === 'select') {
              el.value = field.value;
            } else if (field.tag === 'textarea') {
              el.value = field.value;
            } else if (el.tagName === 'INPUT') {
              el.value = field.value || '';
            } else if (el.getAttribute('contenteditable') === 'true') {
              el.innerHTML = field.value || '';
            }
          } catch { /* skip */ }
        }
      }
    });
  }

  _getDoc() {
    try {
      return this._iframe.contentDocument || this._iframe.contentWindow?.document || null;
    } catch {
      // Cross-origin iframe — can't access
      return null;
    }
  }

  _stripScripts(html) {
    // Remove <script> tags and inline event handlers for security.
    // The regex handles both single- and double-quoted attribute values.
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Double-quoted on* handlers: onclick="code"
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      // Single-quoted on* handlers: onclick='code'
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      // Unquoted on* handlers: onclick=code
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript\s*:/gi, 'blocked:');
  }
}
