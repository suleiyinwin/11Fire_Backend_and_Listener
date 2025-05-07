import { WebSocketServer } from 'ws';
import wsRouter from './routes/wsRouter.js';

// Create WebSocket server on port 9090
const wss = new WebSocketServer({ port: 9090 });
console.log("Backend WebSocket Server running on port 9090");

// Initialize WebSocket event handling through router
wsRouter(wss);
