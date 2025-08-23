import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import wsRouter from './routes/wsRouter.js';
import authRouter from './routes/authRouter.js';
import bootstrapListener from './routes/bootstrapRouter.js';
import cookieParser from 'cookie-parser';
import { attachUser } from './middlewares/authMiddleware.js';


dotenv.config();
const app = express();
const port = process.env.HTTP_PORT || 3001;

mongoose.connect(process.env.MONGODB_URI|| 'mongodb://localhost:27017/11fire').then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB connection error:', err));


app.use(cors({
  origin: process.env.ALLOWED_ORIGINS,
  credentials: true, 
}));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);  

app.use('/auth', authRouter);

app.listen(port, () => console.log(`REST API server running on port ${port}`));

const wssProvider = new WebSocketServer({ port: 9090 });
console.log("WebSocket Server for providers listening on port 9090");
wsRouter(wssProvider);

const wssBootstrap = new WebSocketServer({ port: 9091 });
console.log("WebSocket Server for bootstrap node listening on port 9091");
bootstrapListener(wssBootstrap);