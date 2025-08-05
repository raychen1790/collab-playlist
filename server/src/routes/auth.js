import express from 'express';
import axios from 'axios';
import querystring from 'querystring';
import { ensureSpotifyToken } from '../middleware/ensureSpotifyToken.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';

// Updated scopes to include Web Playback SDK requirements
const scopes = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-modify-public', 
  'playlist-modify-private',
  'user-read-playback-state',
  'user-modify-playback-state',  // Required for Web Playback SDK
  'user-read-currently-playing', // Required for Web Playback SDK
  'streaming',                   // Required for Web Playback SDK - MOST IMPORTANT
  'user-library-read'
].join(' ');

// 1. Redirect user to Spotify login
router.get('/login', (req, res) => {
  console.log('👉 GET /auth/login');
  console.log('    using CLIENT_ID=', process.env.SPOTIFY_CLIENT_ID);
  console.log('    using REDIRECT_URI=', process.env.REDIRECT_URI);
  
  // Add state parameter for security
  const state = Math.random().toString(36).substring(2, 15);
  
  const params = querystring.stringify({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.REDIRECT_URI,
    state: state,
    show_dialog: 'true' // Force user to reauthorize to ensure fresh scopes
  });
  
  // Store state in session/cookie for verification
  res.cookie('spotify_auth_state', state, {
    httpOnly: true,
    maxAge: 10 * 60 * 1000, // 10 minutes
    sameSite: 'lax'
  });
  
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// 2. Handle callback & exchange code for tokens
router.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies.spotify_auth_state || null;

  // Clear the state cookie
  res.clearCookie('spotify_auth_state');

  if (state === null || state !== storedState) {
    console.error('State mismatch in OAuth callback');
    return res.redirect(`${process.env.FRONTEND_URI}?error=state_mismatch`);
  }

  if (!code) {
    console.error('No authorization code received');
    return res.redirect(`${process.env.FRONTEND_URI}?error=access_denied`);
  }

  try {
    console.log('🔄 Exchanging code for tokens...');
    const response = await axios.post('https://accounts.spotify.com/api/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
        },
      }
    );
    
    const { access_token, refresh_token, expires_in } = response.data;
    console.log('✅ Successfully obtained tokens');
    
    // Verify token has correct scopes
    try {
      const tokenInfo = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      console.log('✅ Token verification successful for user:', tokenInfo.data.display_name);
    } catch (tokenError) {
      console.error('❌ Token verification failed:', tokenError.response?.status, tokenError.response?.data);
      return res.redirect(`${process.env.FRONTEND_URI}?error=token_verification_failed`);
    }
    
    // Set as HTTP‑only cookie for simplicity
    res.cookie('spotify_token', access_token, {
      httpOnly: true,
      signed: true,
      maxAge: expires_in * 1000,          // ~1 hour
      sameSite: 'none',                   // cross-site: API <-> Frontend
      secure:  isProd,                    // required by SameSite=None
    });

    // a refresh_token usually comes only on first auth. store it 30 days
    if (refresh_token) {
      res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        signed: true,
        maxAge: 30 * 24 * 3600 * 1000,    // 30 days
        sameSite: 'none',
        secure:  isProd,
      });
     }

    console.log('🏠 Redirecting to frontend');
    res.redirect(process.env.FRONTEND_URI);
  } catch (err) {
    console.error('❌ Authentication failed:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URI}?error=auth_failed`);
  }
});

// 3. Get user profile
router.get('/me', ensureSpotifyToken, async (req, res) => {
  const token = req.spotifyAccessToken;
  console.log('👉 GET /auth/me');
  
  if (!token) {
    console.log('   ↳ no token, returning user: null');
    return res.json({ user: null });
  }

  try {
    const profile = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('   ↳ got profile:', profile.data.display_name);
    res.json({ user: profile.data });
  } catch (err) {
    console.error('   ↳ error fetching profile:', err.response?.status, err.response?.data?.error?.message || err.message);
    
    // If token is invalid, clear cookies and return null user
    if (err.response?.status === 401) {
      const clearOpts = { sameSite: 'none', secure: isProd, httpOnly: true };
      res.clearCookie('spotify_token', clearOpts);
      res.clearCookie('refresh_token', clearOpts);
    }
    
    res.json({ user: null });
  }
});

// 4. Get access token for Web Playback SDK (client-side needs this)
router.get('/token', requireAuth, async (req, res) => {
  const token = req.spotifyAccessToken;
  console.log('👉 GET /auth/token');
  
  if (!token) {
    console.log('   ↳ no token available');
    return res.status(401).json({ error: 'No access token available' });
  }
  
  // Verify token is still valid and has correct scopes
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('   ↳ token verified for user:', response.data.display_name);
    
    // Return the token to the client for Web Playback SDK initialization
    res.json({ 
      access_token: token,
      user: response.data
    });
  } catch (err) {
    console.error('   ↳ token verification failed:', err.response?.status, err.response?.data?.error?.message || err.message);
    
    if (err.response?.status === 401) {
      // Token is expired or invalid
      res.clearCookie('spotify_token');
      return res.status(401).json({ 
        error: 'Token expired or invalid',
        reauth_required: true
      });
    }
    
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// 5. Force reauthorization endpoint
router.get('/reauth', (req, res) => {
  console.log('👉 GET /auth/reauth - clearing cookies and forcing reauth');
  
  // Clear existing cookies
  const clearOpts = { sameSite: 'none', secure: isProd, httpOnly: true };
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  
  // Redirect to login with show_dialog=true to force fresh consent
  res.redirect('/auth/login');
});

// 6. Logout endpoint
router.post('/logout', (req, res) => {
  console.log('👉 POST /auth/logout');
  
  const clearOpts = { sameSite: 'none', secure: isProd, httpOnly: true };
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  res.clearCookie('spotify_auth_state', { httpOnly: true, sameSite: 'lax', secure: isProd });
  
  res.json({ success: true });
});

export default router;