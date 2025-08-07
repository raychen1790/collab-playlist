// server/src/middleware/requireAuth.js - Enhanced with better debugging
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
    const endpoint = `${req.method} ${req.path}`;
    console.log(`👤 requireAuth middleware for ${endpoint}`);
    
    const token = req.spotifyAccessToken;
    console.log('    has spotifyAccessToken:', !!token);
    console.log('    token length:', token?.length || 0);
    
    if (!token) {
      console.log(`    ❌ No token available for ${endpoint}`);
      return res.status(401).json({ 
        error: 'Not authenticated',
        debug: {
          stage: 'requireAuth',
          hasToken: false,
          endpoint: endpoint
        }
      });
    }

    try {
      console.log('    🔍 Fetching Spotify profile...');
      const { data: profile } = await axios.get(
        'https://api.spotify.com/v1/me',
        { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000 // 10 second timeout
        }
      );
      
      console.log(`    ✅ Profile fetched for ${endpoint}:`, profile.display_name);
      console.log('    Profile data:', {
        id: profile.id,
        display_name: profile.display_name,
        email: profile.email,
        country: profile.country
      });
      
      req.user = profile;   // make profile available downstream
      next();
    } catch (err) {
      console.error(`    ❌ Profile fetch failed for ${endpoint}:`, {
        status: err.response?.status,
        statusText: err.response?.statusText,
        message: err.message,
        timeout: err.code === 'ECONNABORTED'
      });
      
      if (err.response?.status === 401) {
        console.log('    ↳ Token expired, clearing cookies');
        // Token expired, clear it
        res.clearCookie('spotify_token', {
          httpOnly: true,
          signed: true,
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        });
        
        return res.status(401).json({ 
          error: 'Token expired or invalid',
          debug: {
            stage: 'requireAuth',
            tokenExpired: true,
            endpoint: endpoint
          }
        });
      }
      
      console.log(`    ↳ Returning 500 for ${endpoint} due to profile fetch error`);
      return res.status(500).json({ 
        error: 'Failed to fetch user profile',
        debug: {
          stage: 'requireAuth',
          profileFetchFailed: true,
          error: err.message,
          endpoint: endpoint
        }
      });
    }
  },
];