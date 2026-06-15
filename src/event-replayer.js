/**
 * EventReplayer — safely replays interaction events received from the admin
 * viewer onto the student's page.
 *
 * Security: only replays trusted event types and validates selectors against
 * the live DOM. Never dispatches synthetic events that could trigger native
 * browser actions (file uploads, extension APIs, etc.).
 */
export class EventReplayer {
  constructor() {
    this._allowedEvents = new Set([
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'mousemove',
      'input',
      'change',
      'focus',
      'blur',
      'scroll',
      'keydown',
      'keyup',
    ]);

    this._blockedSelectors = [
      'input[type="file"]',
    ];
  }

  /**
   * Replay a single interaction event.
   * @param {InteractionEvent} event
   * @returns {{ success: boolean, error?: string }}
   */
  replay(event) {
    if (!event || !event.type) {
      return { success: false, error: 'Missing event type' };
    }

    if (!this._allowedEvents.has(event.type)) {
      return { success: false, error: `Event type "${event.type}" not allowed` };
    }

    let target;
    if (event.selector) {
      target = this._resolveSelector(event.selector);
      if (!target) {
        return { success: false, error: `Selector "${event.selector}" not found` };
      }
    } else if (event.coords) {
      target = document.elementFromPoint(event.coords.x, event.coords.y);
      if (!target) {
        return { success: false, error: 'No element at coordinates' };
      }
    } else {
      target = document.activeElement || document.body;
    }

    // Safety: block file inputs and other sensitive elements
    if (this._isBlocked(target)) {
      return { success: false, error: 'Target element is blocked for remote interaction' };
    }

    try {
      this._dispatchEvent(target, event);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Replay multiple events in sequence with configurable delay.
   * @param {InteractionEvent[]} events
   * @param {Object} [opts]
   * @param {number} [opts.delayMs=50] Delay between events
   * @returns {Promise<Array<{success:boolean,error?:string}>>}
   */
  async replaySequence(events, opts = {}) {
    const delayMs = opts.delayMs ?? 50;
    const results = [];
    for (const event of events) {
      results.push(this.replay(event));
      if (delayMs > 0 && events.length > 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return results;
  }

  // ---- internals ---------------------------------------------------------

  _resolveSelector(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  _isBlocked(el) {
    for (const blocked of this._blockedSelectors) {
      if (el.matches?.(blocked)) return true;
    }
    return false;
  }

  _dispatchEvent(target, event) {
    if (event.type === 'input' || event.type === 'change') {
      // For input/change events, we need to actually set the value first
      if (event.value !== undefined) {
        if (target.type === 'checkbox' || target.type === 'radio') {
          target.checked = event.checked ?? !target.checked;
        } else {
          // Use native setter to trigger React/Vue reactivity
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value',
          );
          if (nativeSetter?.set) {
            nativeSetter.set.call(target, event.value);
          } else {
            target.value = event.value;
          }
        }
      }
    }

    // Dispatch the event — use the appropriate constructor
    const evt = this._createEvent(event, target);
    if (evt) {
      target.dispatchEvent(evt);
    }
  }

  _createEvent(event, target) {
    const opts = { bubbles: true, cancelable: true };

    switch (event.type) {
      case 'click':
      case 'dblclick':
      case 'mousedown':
      case 'mouseup': {
        const mouseOpts = {
          ...opts,
          clientX: event.coords?.x ?? 0,
          clientY: event.coords?.y ?? 0,
          button: event.button ?? 0,
          view: window,
        };
        if (event.type === 'dblclick') {
          return new MouseEvent(event.type, mouseOpts);
        }
        return new MouseEvent(event.type, mouseOpts);
      }

      case 'mousemove': {
        return new MouseEvent('mousemove', {
          ...opts,
          clientX: event.coords?.x ?? 0,
          clientY: event.coords?.y ?? 0,
          view: window,
        });
      }

      case 'input':
      case 'change':
        return new Event(event.type, opts);

      case 'focus':
      case 'blur':
        return new FocusEvent(event.type, opts);

      case 'scroll':
        if (event.scrollX !== undefined && target.scrollTo) {
          target.scrollTo(event.scrollX, event.scrollY);
        }
        return new Event('scroll', opts);

      case 'keydown':
      case 'keyup':
        return new KeyboardEvent(event.type, {
          ...opts,
          key: event.key ?? '',
          code: event.code ?? '',
          keyCode: event.keyCode ?? 0,
        });

      default:
        return new Event(event.type, opts);
    }
  }
}

/**
 * @typedef {Object} InteractionEvent
 * @property {string} type          Event type (click, input, keydown, etc.)
 * @property {string} [selector]    CSS selector to resolve the target element
 * @property {{x:number,y:number}} [coords]  Fallback: resolve target by coordinates
 * @property {string} [value]       For input/change events
 * @property {boolean} [checked]    For checkbox/radio toggles
 * @property {number} [button]      Mouse button index
 * @property {string} [key]         KeyboardEvent.key
 * @property {string} [code]        KeyboardEvent.code
 * @property {number} [keyCode]     KeyboardEvent.keyCode
 * @property {number} [scrollX]     For scroll events
 * @property {number} [scrollY]     For scroll events
 */
