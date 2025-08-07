// server/routes/auth.js - Enhanced with better dual auth support
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
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'user-library-read'
].join(' ');

// Helper function for consistent cookie options
const getCookieOptions = (maxAge = null) => ({
  httpOnly: true,
  signed: true,
  maxAge: maxAge,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
});

// Helper function for clearing cookies
const getClearCookieOptions = () => ({
  httpOnly: true,
  signed: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
});

// 1. Redirect user to Spotify login
router.get('/login', (req, res) => {
  console.log('👉 GET /auth/login');
  console.log('    using CLIENT_ID=', process.env.SPOTIFY_CLIENT_ID);
  console.log('    using REDIRECT_URI=', process.env.REDIRECT_URI);
  console.log('    request origin:', req.headers.origin);
  
  const state = Math.random().toString(36).substring(2, 15);
  
  const params = querystring.stringify({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.REDIRECT_URI,
    state: state,
    show_dialog: 'true'
  });
  
  // Store state in signed cookie
  res.cookie('spotify_auth_state', state, {
    httpOnly: true,
    signed: true,
    maxAge: 10 * 60 * 1000,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/'
  });
  
  console.log('🍪 Set spotify_auth_state cookie (signed)');
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// 2. Handle callback & exchange code for tokens
router.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.signedCookies.spotify_auth_state || null;

  console.log('👉 GET /auth/callback');
  console.log('    code:', !!code);
  console.log('    state:', state);
  console.log('    storedState:', storedState);

  // Clear the state cookie
  res.clearCookie('spotify_auth_state', {
    httpOnly: true,
    signed: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/'
  });

  if (state === null || state !== storedState) {
    console.error('❌ State mismatch in OAuth callback');
    return res.redirect(`${process.env.FRONTEND_URI}?error=state_mismatch`);
  }

  if (!code) {
    console.error('❌ No authorization code received');
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

    // Set cookies AND pass via URL for maximum compatibility
    const accessTokenCookieOptions = getCookieOptions(expires_in * 1000);
    res.cookie('spotify_token', access_token, accessTokenCookieOptions);
    
    if (refresh_token) {
      const refreshTokenCookieOptions = getCookieOptions(30 * 24 * 3600 * 1000);
      res.cookie('refresh_token', refresh_token, refreshTokenCookieOptions);
    }

    // Create a secure token package for URL transfer
    const tokenPackage = {
      access_token,
      refresh_token,
      expires_in,
      expires_at: Date.now() + (expires_in * 1000),
      timestamp: Date.now()
    };

    // Encode the token package
    const encodedTokens = encodeURIComponent(JSON.stringify(tokenPackage));
    
    console.log('🏠 Redirecting to frontend with token package');
    res.redirect(`${process.env.FRONTEND_URI}?auth_tokens=${encodedTokens}`);

  } catch (err) {
    console.error('❌ Authentication failed:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URI}?error=auth_failed`);
  }
});

// 3. Store tokens endpoint (for URL-based auth)
router.post('/store-tokens', async (req, res) => {
  const { access_token, refresh_token, expires_in } = req.body;
  
  console.log('👉 POST /auth/store-tokens');
  console.log('    has access_token:', !!access_token);
  console.log('    has refresh_token:', !!refresh_token);

  if (!access_token) {
    return res.status(400).json({ error: 'Missing access token' });
  }

  try {
    // Verify the token before storing
    const profile = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    // Store in cookies
    const accessTokenCookieOptions = getCookieOptions(expires_in * 1000);
    res.cookie('spotify_token', access_token, accessTokenCookieOptions);
    
    if (refresh_token) {
      const refreshTokenCookieOptions = getCookieOptions(30 * 24 * 3600 * 1000);
      res.cookie('refresh_token', refresh_token, refreshTokenCookieOptions);
    }

    console.log('✅ Tokens stored successfully for user:', profile.data.display_name);
    res.json({ success: true, user: profile.data });

  } catch (err) {
    console.error('❌ Token verification failed:', err.response?.status, err.response?.data);
    res.status(401).json({ error: 'Invalid tokens' });
  }
});

// 4. Enhanced /me endpoint that works with both auth methods
router.get('/me', async (req, res) => {
  console.log('👉 GET /auth/me');
  
  // Check for Authorization header first
  const authHeader = req.headers.authorization;
  let token = null;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
    console.log('    using header token');
  } else if (req.signedCookies.spotify_token) {
    token = req.signedCookies.spotify_token;
    console.log('    using cookie token');
  }
  
  if (!token) {
    console.log('    no token found');
    return res.json({ user: null });
  }
  
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('    ✅ authenticated as:', response.data.display_name);
    res.json({ user: response.data });
    
  } catch (err) {
    console.log('    ❌ token invalid:', err.response?.status);
    res.json({ user: null });
  }
});

// 5. Enhanced token endpoint for Web Playback SDK
router.get('/token', async (req, res) => {
  console.log('👉 GET /auth/token');
  
  // Check for Authorization header first (for client-stored tokens)
  const authHeader = req.headers.authorization;
  let token = null;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
    console.log('    using header token');
  } else {
    // Fall back to ensureSpotifyToken middleware for cookie-based auth
    return ensureSpotifyToken(req, res, () => {
      const cookieToken = req.spotifyAccessToken;
      const user = req.user;
      
      if (!cookieToken) {
        console.log('   ↳ no cookie token available');
        return res.status(401).json({ error: 'No access token available' });
      }
      
      console.log('   ↳ cookie token verified for user:', user?.display_name);
      res.json({ 
        access_token: cookieToken,
        user: user
      });
    });
  }
  
  // Verify header token
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('   ↳ header token verified for user:', response.data.display_name);
    res.json({ 
      access_token: token,
      user: response.data
    });
    
  } catch (err) {
    console.error('   ↳ header token verification failed:', err.response?.status, err.response?.data?.error?.message || err.message);
    res.status(401).json({ 
      error: 'Invalid access token',
      reauth_required: true
    });
  }
});

// 6. Force reauthorization endpoint
router.get('/reauth', (req, res) => {
  console.log('👉 GET /auth/reauth - clearing cookies and forcing reauth');
  
  const clearOpts = getClearCookieOptions();
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  
  res.redirect('/auth/login');
});

// 7. Logout endpoint
router.post('/logout', (req, res) => {
  console.log('👉 POST /auth/logout');
  
  const clearOpts = getClearCookieOptions();
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  res.clearCookie('spotify_auth_state', {
    httpOnly: true,
    signed: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/'
  });
  
  res.json({ success: true });
});

// 8. Enhanced debug endpoint
router.get('/debug', (req, res) => {
  console.log('👉 GET /auth/debug');
  
  const authHeader = req.headers.authorization;
  const hasHeaderToken = !!(authHeader && authHeader.startsWith('Bearer '));
  
  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    headers: {
      origin: req.headers.origin,
      referer: req.headers.referer,
      'user-agent': req.headers['user-agent']?.substring(0, 100),
      cookie: req.headers.cookie ? `present (${req.headers.cookie.length} chars)` : 'missing',
      authorization: hasHeaderToken ? 'Bearer token present' : 'no auth header',
      cookiePreview: req.headers.cookie?.substring(0, 200)
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URI: process.env.FRONTEND_URI,
      isProd: isProd
    },
    cookieSettings: {
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      httpOnly: true,
      signed: true,
      path: '/'
    },
    authMethods: {
      headerToken: hasHeaderToken,
      cookieToken: !!req.signedCookies.spotify_token,
      refreshToken: !!req.signedCookies.refresh_token
    }
  });
});

export default router;