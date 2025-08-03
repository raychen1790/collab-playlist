import dotenv  from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import votesRoutes from './routes/votes.js';


const app = express();
app.use(
  cors({
    origin: 'http://127.0.0.1:5173',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

app.use('/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms', votesRoutes);

const PORT = 4000;
app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
