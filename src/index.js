/**
 * Web Remote Agent — main entry point.
 *
 * Exports the ClientAgent (student side) and ViewerAgent (admin side) classes,
 * plus supporting utilities for direct use.
 *
 *   import { ClientAgent, ViewerAgent } from 'web-remote-agent';
 *
 *   // Student side
 *   const agent = new ClientAgent({
 *     sessionId: 'unique-session-id',
 *     serverUrl: 'wss://example.com/remote',
 *   });
 *   agent.start();
 *
 *   // Admin side
 *   const viewer = new ViewerAgent({
 *     sessionId: 'unique-session-id',
 *     serverUrl: 'wss://example.com/remote',
 *     container: document.getElementById('remote-view'),
 *   });
 *   viewer.start();
 */

export { ClientAgent } from './client-agent.js';
export { ViewerAgent } from './viewer-agent.js';
export { DOMSerializer } from './dom-serializer.js';
export { DOMReconstructor } from './dom-reconstructor.js';
export { Connection } from './connection.js';
export { EventReplayer } from './event-replayer.js';
export { MutationTracker } from './mutation-tracker.js';
export { SessionRecorder } from './session-recorder.js';
export { SessionPlayer } from './session-player.js';
