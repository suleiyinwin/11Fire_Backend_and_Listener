import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import wsRouter from './routes/wsRouter.js';
import authRouter from './routes/authRouter.js';
import swarmRouter from './routes/swarmRouter.js';
import providerRouter from './routes/providerRouter.js';
import fileRouter from './routes/fileRouter.js';
import providerNodeRouter from './routes/providerNodeRouter.js';
import bootstrapListener from './routes/bootstrapRouter.js';
import cookieParser from 'cookie-parser';
import { attachUser } from './middlewares/authMiddleware.js';


dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI|| 'mongodb://localhost:27017/11fire').then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB connection error:', err));


const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: function(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  credentials: true,
}));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

app.use(express.json());
app.use(cookieParser());
app.use(attachUser);  

app.use('/auth', authRouter);
app.use('/swarms', swarmRouter);
app.use('/providers', providerRouter);
app.use('/files', fileRouter);
app.use('/provider-node', providerNodeRouter);

// app.listen(port, () => console.log(`REST API server running on port ${port}`));

const server = http.createServer(app);

const wssProvider = new WebSocketServer({ server, path: "/ws/provider" });
console.log("WebSocket Server for providers attached at /ws/provider");
wsRouter(wssProvider);

const wssBootstrap = new WebSocketServer({ server, path: "/ws/bootstrap" });
console.log("WebSocket Server for bootstrap node attached at /ws/bootstrap");
bootstrapListener(wssBootstrap);

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Health check: http://localhost:${port}/health`);
});