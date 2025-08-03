// server/src/middleware/requireAuth.js
import axios from 'axios';
import { ensureSpotifyToken } from './ensureSpotifyToken.js';

/**
 * requireAuth:
 *   1. ensureSpotifyToken → guarantees a fresh access token
 *   2. fetches Spotify profile → attaches req.user
 */
export const requireAuth = [
  ensureSpotifyToken,
  async (req, res, next) => {
    const token = req.spotifyAccessToken;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const { data: profile } = await axios.get(
        'https://api.spotify.com/v1/me',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      req.user = profile;   // make profile available downstream
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
  },
];
