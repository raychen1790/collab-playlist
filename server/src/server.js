// server/src/server.js - FIXED VERSION with proper SPA routing support
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

// API routes - these must come BEFORE static file serving
app.use('/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms', votesRoutes);

app.get('/health', (_req, res) => res.send('ok'));

// FIXED: Proper SPA routing support for production
if (isProd) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  
  console.log('📦 Serving static files from:', clientBuildPath);
  
  // Serve static files (CSS, JS, images, etc.)
  app.use(express.static(clientBuildPath));
  
  // Helper function to check if request is for an API endpoint
  const isApiRequest = (req) => {
    return req.path.startsWith('/api/') || 
           req.path.startsWith('/auth/') || 
           req.path === '/health';
  };
  
  // Helper function to check if request is for a static asset
  const isStaticAsset = (req) => {
    const ext = path.extname(req.path);
    return ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'].includes(ext);
  };
  
  // FIXED: Catch-all handler for SPA routing (without problematic wildcards)
  app.use((req, res, next) => {
    // Skip API requests and static assets
    if (isApiRequest(req) || isStaticAsset(req)) {
      return next();
    }
    
    // For all other requests (SPA routes), serve index.html
    const indexPath = path.join(clientBuildPath, 'index.html');
    console.log(`🔄 SPA routing: ${req.path} -> index.html`);
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('Error serving index.html:', err);
        res.status(500).send('Server Error');
      }
    });
  });
  
  // Final 404 handler for actual missing resources
  app.use((req, res) => {
    console.log(`❌ 404: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Not found' });
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📡 Frontend URI: ${FRONTEND}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV}`);
});