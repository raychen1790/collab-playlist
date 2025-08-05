import dotenv  from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import votesRoutes from './routes/votes.js';

const isProd = process.env.NODE_ENV === 'production';
const FRONTEND = process.env.FRONTEND_URI;

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
app.options('*', cors(corsOptions)); // handle preflight

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

app.use('/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms', votesRoutes);

const PORT = 4000;
app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
