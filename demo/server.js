/**
 * Demo WebSocket relay server for Web Remote Agent.
 *
 * Routes messages between paired client (student) and viewer (admin)
 * sessions. A single server can handle many concurrent sessions.
 *
 * Usage:
 *   node demo/server.js
 *   # or: npm run demo
 *
 * Environment variables:
 *   PORT — server port (default 8080)
 */

import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT || '8080', 10);

const wss = new WebSocketServer({ port: PORT });

console.log(`[demo-server] WebSocket relay listening on ws://localhost:${PORT}`);

/**
 * Session registry:
 *   sessions[sessionId] = { client: ws | null, viewer: ws | null }
 */
const sessions = new Map();

wss.on('connection', (ws) => {
  let sessionId = null;
  let role = null; // 'client' or 'viewer'

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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[demo-server] Shutting down...');
  wss.close(() => {
    console.log('[demo-server] Closed.');
    process.exit(0);
  });
});
