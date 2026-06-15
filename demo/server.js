/**
 * Demo HTTP + WebSocket server for Web Remote Agent.
 *
 * Serves the static HTML/JS files AND routes WebSocket messages between
 * paired client (student) and viewer (admin) sessions. A single server
 * can handle many concurrent sessions.
 *
 * Usage:
 *   node demo/server.js
 *   # or: npm run demo
 *
 * Then open:
 *   http://localhost:8080/demo/student.html   (student side)
 *   http://localhost:8080/demo/admin.html     (admin side)
 *
 * Environment variables:
 *   PORT — server port (default 8080)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Project root is the parent of the demo/ directory
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ---- MIME types for static file serving ----------------------------------

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function getMimeType(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES.get(ext) || 'application/octet-stream';
}

// ---- Static file server --------------------------------------------------

const server = createServer(async (req, res) => {
  // Normalize the path and prevent directory traversal
  let pathname = normalize(req.url.split('?')[0]);

  // Default route → student page
  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/demo/student.html';
  }

  // Resolve to an absolute path within the project root
  const filePath = join(PROJECT_ROOT, pathname);

  // Security: ensure the resolved path is still inside the project root
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(content);
    console.log(`[demo-server] HTTP 200 ${pathname}`);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404);
      res.end('Not Found');
      console.log(`[demo-server] HTTP 404 ${pathname}`);
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
      console.error(`[demo-server] HTTP 500 ${pathname}:`, err.message);
    }
  }
});

// ---- WebSocket relay (attached to the same HTTP server) ------------------

const wss = new WebSocketServer({ server });

/**
 * Session registry:
 *   sessions[sessionId] = { client: ws | null, viewer: ws | null }
 */
const sessions = new Map();

wss.on('connection', (ws, req) => {
  let sessionId = null;
  let role = null; // 'client' or 'viewer'

  console.log(`[demo-server] WebSocket connected from ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore non-JSON
    }

    // Internal heartbeat — respond with pong
    if (msg._type === 'ping') {
      ws.send(JSON.stringify({ _type: 'pong' }));
      return;
    }

    // Registration
    if (msg._type === 'register') {
      sessionId = msg.sessionId;
      role = msg.role;

      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { client: null, viewer: null });
      }

      const session = sessions.get(sessionId);
      if (role === 'client') {
        session.client = ws;
        console.log(`[demo-server] session ${sessionId}: client registered`);
      } else if (role === 'viewer') {
        session.viewer = ws;
        console.log(`[demo-server] session ${sessionId}: viewer registered`);
      }

      // Confirm registration
      ws.send(JSON.stringify({ _type: 'registered', sessionId, role }));
      return;
    }

    // Unregistration
    if (msg._type === 'unregister') {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (role === 'client') session.client = null;
        if (role === 'viewer') session.viewer = null;

        // Clean up empty sessions
        if (!session.client && !session.viewer) {
          sessions.delete(sessionId);
          console.log(`[demo-server] session ${sessionId}: removed (empty)`);
        }
      }
      return;
    }

    // Relay: client → viewer
    if (role === 'client' && sessionId) {
      const session = sessions.get(sessionId);
      if (session?.viewer && session.viewer.readyState === 1) {
        session.viewer.send(JSON.stringify(msg));
      }
    }

    // Relay: viewer → client (interactions only)
    if (role === 'viewer' && sessionId) {
      const session = sessions.get(sessionId);
      if (session?.client && session.client.readyState === 1) {
        session.client.send(JSON.stringify(msg));
      }
    }
  });

  ws.on('close', () => {
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      if (role === 'client') session.client = null;
      if (role === 'viewer') session.viewer = null;

      if (!session.client && !session.viewer) {
        sessions.delete(sessionId);
        console.log(`[demo-server] session ${sessionId}: removed (empty)`);
      } else {
        // Notify the other party
        const peer = role === 'client' ? session.viewer : session.client;
        if (peer && peer.readyState === 1) {
          peer.send(JSON.stringify({
            _type: 'peer-disconnected',
            sessionId,
            role: role === 'client' ? 'viewer' : 'client',
          }));
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[demo-server] ws error (session ${sessionId}):`, err.message);
  });
});

// ---- Start ---------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`[demo-server] Listening on http://localhost:${PORT}`);
  console.log(`[demo-server]   Student: http://localhost:${PORT}/demo/student.html`);
  console.log(`[demo-server]   Admin:   http://localhost:${PORT}/demo/admin.html`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[demo-server] Shutting down...');
  wss.close(() => {
    server.close(() => {
      console.log('[demo-server] Closed.');
      process.exit(0);
    });
  });
});
