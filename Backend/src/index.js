import { WebSocketServer } from 'ws';
import wsRouter from './routes/wsRouter.js';
import uploadRouter from './routes/uploadRouter.js';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
const app = express();
const port = process.env.HTTP_PORT || 3001;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/11fire', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB connection error:', err));

// Enable CORS for all origins (or configure as needed)
app.use(cors());

// REST API server
app.use(express.json());
app.use('/api', uploadRouter);
app.listen(port, () => {
    console.log(`REST API server running on port ${port}`);
});

// WebSocket server for both providers and bootstrap listener
const wssProvider = new WebSocketServer({ port: 9090 });
console.log("WebSocket Server for providers listening on port 9090");
wsRouter(wssProvider);

const wssBootstrap = new WebSocketServer({ port: 9091 });
console.log("WebSocket Server for bootstrap node listening on port 9091");
import bootstrapListener from './routes/bootstrapRouter.js';
bootstrapListener(wssBootstrap);