// server/src/server.js - FIXED VERSION without wildcards to avoid path-to-regexp errors
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import votesRoutes from './routes/votes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const FRONTEND = process.env.FRONTEND_URI;

const app = express();
app.set('trust proxy', 1);

// Allow local dev + your deployed frontend
const allowed = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  FRONTEND,
].filter(Boolean));

const corsOptions = {
  origin(origin, cb) {
    // allow non-browser tools (curl/postman) with no origin
    if (!origin) return cb(null, true);
    cb(null, allowed.has(origin));
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

// IMPORTANT: API routes MUST come before static file serving
app.use('/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms', votesRoutes);

app.get('/health', (_req, res) => res.send('ok'));

// FIXED: Production static file serving and SPA routing WITHOUT wildcards
if (isProd) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  
  console.log('📦 Serving static files from:', clientBuildPath);
  
  // Serve static files
  app.use(express.static(clientBuildPath));
  
  // FIXED: Define explicit routes for your SPA (no wildcards)
  const spaRoutes = [
    '/',
    '/rooms/:id'  // This matches /rooms/139113a6-dc93-453f-9fd3-461e7f00df81
  ];
  
  // Register each SPA route explicitly
  spaRoutes.forEach(route => {
    app.get(route, (req, res) => {
      const indexPath = path.join(clientBuildPath, 'index.html');
      console.log(`🔄 SPA routing: ${req.path} -> index.html`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error('❌ Error serving index.html:', err);
          res.status(500).json({ error: 'Internal server error' });
        }
      });
    });
  });
  
  // FIXED: Use middleware for catch-all instead of app.get('*')
  app.use((req, res, next) => {
    // Skip API requests - let them 404 properly
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/auth/') || 
        req.path === '/health') {
      return next();
    }
    
    // Skip requests for static assets with extensions (except .html)
    const ext = path.extname(req.path);
    if (ext && !['.html', ''].includes(ext)) {
      return next();
    }
    
    // For everything else, serve index.html (SPA catch-all)
    const indexPath = path.join(clientBuildPath, 'index.html');
    console.log(`🔄 SPA catch-all: ${req.method} ${req.path} -> index.html`);
    
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('❌ Error serving index.html:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  });
  
  // Final 404 handler
  app.use((req, res) => {
    console.log(`❌ 404: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Not found' });
  });
  
} else {
  // Development mode
  console.log('🔧 Development mode - client served by Vite dev server');
}

const PORT = process.env.PORT || 4000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📡 Frontend URI: ${FRONTEND}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV}`);
  console.log(`📂 Serving from: ${isProd ? 'static files' : 'development mode'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});