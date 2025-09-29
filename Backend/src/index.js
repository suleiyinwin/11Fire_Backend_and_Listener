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


const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    try {
      if (!origin) return callback(null, true);

      if (allowedOrigins.length === 0) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      for (const allowed of allowedOrigins) {
        if (allowed.startsWith('.') && origin.endsWith(allowed)) return callback(null, true);
      }

      return callback(new Error('CORS: origin not allowed'), false);
    } catch (err) {
      console.error('CORS origin check error:', err);
      return callback(new Error('CORS check failed'), false);
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

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

// Provider WS
const wssProvider = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws/provider") {
    wssProvider.handleUpgrade(req, socket, head, ws => {
      wssProvider.emit("connection", ws, req);
    });
  }
});

// Bootstrap WS
const wssBootstrap = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws/bootstrap") {
    wssBootstrap.handleUpgrade(req, socket, head, ws => {
      wssBootstrap.emit("connection", ws, req);
    });
  }
});

// Register handlers
wsRouter(wssProvider);
bootstrapListener(wssBootstrap);

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Health check: http://localhost:${port}/health`);
});