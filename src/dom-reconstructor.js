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
   */
  constructor(iframe, opts = {}) {
    if (!iframe || iframe.tagName !== 'IFRAME') {
      throw new Error('DOMReconstructor requires an <iframe> element');
    }
    this._iframe = iframe;
    this._allowScripts = opts.allowScripts ?? false;
    this._lastSnapshot = null;
    this._ready = false;

    // Wait for the iframe to be ready
    this._iframe.addEventListener('load', () => {
      this._ready = true;
      // Re-apply the last snapshot if one was set before the iframe loaded
      if (this._lastSnapshot) {
        this._applySnapshot(this._lastSnapshot);
      }
    });
  }

  /**
   * Apply a full snapshot to the iframe.
   * @param {import('./dom-serializer').Snapshot} snapshot
   */
  applySnapshot(snapshot) {
    this._lastSnapshot = snapshot;
    if (!this._ready) return; // will be applied via load handler
    this._applySnapshot(snapshot);
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
    return this._ready && !!this._getDoc();
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

    // After the write completes (next microtask), restore scroll position
    requestAnimationFrame(() => {
      if (snapshot.scroll) {
        doc.defaultView?.scrollTo(snapshot.scroll.x, snapshot.scroll.y);
      }
      // Restore form values after DOM is settled
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
    // Remove <script> tags and inline event handlers for security
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript\s*:/gi, 'blocked:');
  }
}
