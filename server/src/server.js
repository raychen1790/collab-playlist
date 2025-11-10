// server/src/server.js 
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import votesRoutes from './routes/votes.js';
import deezerRoutes from './routes/deezer.js'; 

const isProd = process.env.NODE_ENV === 'production';
const FRONTEND = process.env.FRONTEND_URI;

const app = express();
app.set('trust proxy', 1);

const allowed = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  FRONTEND,
  'https://collab-playlist.vercel.app', 
].filter(Boolean));

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    console.log('🔍 CORS check for origin:', origin);
    const allowed_result = allowed.has(origin);
    console.log('✅ CORS allowed:', allowed_result);
    cb(null, allowed_result);
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

// API routes
app.use('/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms', votesRoutes);
app.use('/api/deezer', deezerRoutes); 

app.get('/health', (_req, res) => res.send('Backend API is healthy'));

// Root endpoint to confirm API is running
app.get('/', (req, res) => {
  res.json({ 
    message: 'Collab Playlist API Server',
    status: 'running',
    environment: process.env.NODE_ENV,
    frontend_url: FRONTEND,
    timestamp: new Date().toISOString()
  });
});

// 404 handler for undefined API routes
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'API endpoint not found',
    method: req.method,
    path: req.path,
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /auth/*',
      'POST /auth/*',
      'GET /api/rooms/*',
      'POST /api/rooms/*',
      'GET /api/deezer/search', 
      'GET /api/deezer/track/:id' 
    ]
  });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Server listening on port ${PORT}`);
  console.log(`📡 Frontend URL: ${FRONTEND}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 CORS allowed origins:`, Array.from(allowed));
  console.log(`🔗 This is an API-only server - frontend served separately`);
  console.log(`🎵 Deezer proxy available at /api/deezer/*`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});