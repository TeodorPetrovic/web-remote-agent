# Web Remote Agent

Remote screen viewing and collaboration library for web applications. Enables admins to view and interact with users' browser sessions in real time.

## Use Cases

- **Remote proctoring** — monitor students during online exams
- **Live support** — see what a user sees and help them navigate
- **Co-browsing** — collaborative browsing for training or demos
- **Session replay** — record and replay user sessions for debugging

## Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Student Tab │ ──WS──▶ │    Server    │ ──WS──▶ │  Admin Tab   │
│ (ClientAgent)│ ◀──WS── │  (relay)     │ ◀──WS── │(ViewerAgent) │
└──────────────┘         └──────────────┘         └──────────────┘
```

- **ClientAgent** runs on the student's page. It captures DOM state, observes mutations, and replays interaction events from the admin.
- **ViewerAgent** runs on the admin's dashboard. It reconstructs the student's page in a sandboxed iframe and captures admin interactions to send back.
- **Server** is a thin WebSocket relay that routes messages between paired clients. A reference demo server is included.

## Installation

```bash
npm install web-remote-agent
```

Or load directly in the browser:

```html
<script type="module">
  import { ClientAgent } from 'https://unpkg.com/web-remote-agent/src/index.js';
</script>
```

## Quick Start

### Student Side

```js
import { ClientAgent } from 'web-remote-agent';

const agent = new ClientAgent({
  sessionId: 'unique-session-id',
  serverUrl: 'wss://your-server.com/remote',
  snapshotIntervalMs: 2000,  // full DOM snapshot every 2s
  lightIntervalMs: 200,      // lightweight form/scroll diff every 200ms
});

agent.start();

// Later:
// agent.stop();
```

### Admin Side

```js
import { ViewerAgent } from 'web-remote-agent';

const viewer = new ViewerAgent({
  sessionId: 'unique-session-id',  // same ID as the student
  serverUrl: 'wss://your-server.com/remote',
  container: document.getElementById('remote-view'),
});

viewer.start();

// Enable interaction mode to click/type on the student's page:
viewer.setInteractionMode(true);
```

### Demo Server

```bash
npm install
npm run demo
# Opens WebSocket server on ws://localhost:8080
# Open demo/student.html in one tab, demo/admin.html in another
```

## API Reference

### `ClientAgent`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionId` | `string` | *required* | Unique session identifier shared with admin |
| `serverUrl` | `string` | *required* | WebSocket server endpoint |
| `snapshotIntervalMs` | `number` | `2000` | Milliseconds between full DOM snapshots |
| `lightIntervalMs` | `number` | `200` | Milliseconds between lightweight diffs |
| `mutations` | `boolean` | `true` | Enable MutationObserver for incremental updates |
| `connectionOpts` | `object` | `{}` | Passed through to `Connection` |

**Methods:** `start()`, `stop()`

### `ViewerAgent`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionId` | `string` | *required* | Session to observe |
| `serverUrl` | `string` | *required* | WebSocket server endpoint |
| `container` | `HTMLElement` | *required* | Container for the sandboxed iframe |
| `allowInteraction` | `boolean` | `true` | Enable admin-to-student interaction |
| `allowScripts` | `boolean` | `false` | Allow scripts in reconstructed page |
| `connectionOpts` | `object` | `{}` | Passed through to `Connection` |

**Methods:** `start()`, `stop()`, `setInteractionMode(enabled)`

### `DOMSerializer`

Serializes the current page state into a transferable JSON object.

**Methods:** `serialize()` → `Snapshot`, `serializeLight()` → `LightSnapshot`

### `DOMReconstructor`

Renders serialized snapshots inside a sandboxed iframe.

**Methods:** `applySnapshot(snapshot)`, `applyLightSnapshot(light)`, `clear()`, `isReady()`

### `EventReplayer`

Safely replays interaction events from the admin on the student's page.

**Methods:** `replay(event)` → `{success, error?}`, `replaySequence(events, opts?)`

### `MutationTracker`

Observes DOM mutations and produces compact mutation records.

**Methods:** `start()`, `stop()`, `flush()`

## Security

- The viewer iframe is sandboxed (`allow-same-origin` only, no scripts by default).
- Inline event handlers and `javascript:` URLs are stripped from reconstructed pages.
- File inputs (`<input type="file">`) are blocked from remote interaction.
- Only a whitelist of safe event types can be replayed on the student's page.
- The library never accesses or transmits cookies, localStorage, or sessionStorage.

## License

MIT
