/**
 * DOMSerializer — captures the current page state into a transferable object.
 *
 * The serialized payload contains enough information for the admin viewer to
 * reconstruct a faithful visual representation of the student's page.
 */
export class DOMSerializer {
  /**
   * Produce a full snapshot of the current document state.
   * @returns {Snapshot}
   */
  serialize() {
    return {
      _type: 'snapshot',
      html: document.documentElement.outerHTML,
      title: document.title,
      url: window.location.href,
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      forms: this._captureFormValues(),
      focus: this._captureFocus(),
      selection: this._captureSelection(),
      timestamp: Date.now(),
    };
  }

  /**
   * Produce a lightweight diff — only form values, scroll, focus, and
   * selection. Useful as a high-frequency supplement between full snapshots.
   * @returns {LightSnapshot}
   */
  serializeLight() {
    return {
      _type: 'light-snapshot',
      scroll: { x: window.scrollX, y: window.scrollY },
      forms: this._captureFormValues(),
      focus: this._captureFocus(),
      selection: this._captureSelection(),
      timestamp: Date.now(),
    };
  }

  // ---- internals ---------------------------------------------------------

  /** Collect current values of all form fields. */
  _captureFormValues() {
    const fields = [];
    const elements = document.querySelectorAll(
      'input, select, textarea, [contenteditable="true"]',
    );
    for (const el of elements) {
      const entry = {
        selector: this._buildSelector(el),
        tag: el.tagName.toLowerCase(),
      };

      if (el.tagName === 'INPUT') {
        if (el.type === 'checkbox' || el.type === 'radio') {
          entry.checked = el.checked;
        } else {
          entry.value = el.value;
        }
        entry.inputType = el.type;
      } else if (el.tagName === 'SELECT') {
        entry.value = el.value;
        entry.selectedIndex = el.selectedIndex;
      } else if (el.tagName === 'TEXTAREA') {
        entry.value = el.value;
      } else if (el.getAttribute('contenteditable') === 'true') {
        entry.value = el.innerHTML;
      }

      fields.push(entry);
    }
    return fields;
  }

  /** Capture the currently focused element (if any). */
  _captureFocus() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return null;
    }
    return { selector: this._buildSelector(el), tag: el.tagName.toLowerCase() };
  }

  /** Capture text selection range. */
  _captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    return { text: sel.toString() };
  }

  /**
   * Build a reasonably unique CSS selector for an element.
   * Prefers id, then a path of :nth-child selectors.
   */
  _buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let current = el;
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
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }
      parts.unshift(selector);
      current = parent;
    }
    return parts.join(' > ');
  }
}

/**
 * @typedef {Object} Snapshot
 * @property {'snapshot'} _type
 * @property {string} html
 * @property {string} title
 * @property {string} url
 * @property {{x:number,y:number}} scroll
 * @property {{width:number,height:number}} viewport
 * @property {FormField[]} forms
 * @property {{selector:string,tag:string}|null} focus
 * @property {{text:string}|null} selection
 * @property {number} timestamp
 */

/**
 * @typedef {Object} LightSnapshot
 * @property {'light-snapshot'} _type
 * @property {{x:number,y:number}} scroll
 * @property {FormField[]} forms
 * @property {{selector:string,tag:string}|null} focus
 * @property {{text:string}|null} selection
 * @property {number} timestamp
 */

/**
 * @typedef {Object} FormField
 * @property {string} selector
 * @property {string} tag
 * @property {string} [value]
 * @property {boolean} [checked]
 * @property {number} [selectedIndex]
 * @property {string} [inputType]
 */
