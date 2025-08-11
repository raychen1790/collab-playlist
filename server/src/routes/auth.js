// server/routes/auth.js - STREAMLINED VERSION with better error handling
import express from 'express';
import axios from 'axios';
import querystring from 'querystring';
import { ensureSpotifyToken } from '../middleware/ensureSpotifyToken.js';

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';

// Updated scopes for Web Playback SDK
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

const getCookieOptions = (maxAge = null) => ({
  httpOnly: true,
  signed: true,
  maxAge: maxAge,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
});

const getClearCookieOptions = () => ({
  httpOnly: true,
  signed: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
});

// 1. Login redirect
router.get('/login', (req, res) => {
  console.log('👉 GET /auth/login');
  
  const state = Math.random().toString(36).substring(2, 15);
  
  const params = querystring.stringify({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.REDIRECT_URI,
    state: state,
    show_dialog: 'true'
  });
  
  res.cookie('spotify_auth_state', state, {
    httpOnly: true,
    signed: true,
    maxAge: 10 * 60 * 1000,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/'
  });
  
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// 2. OAuth callback
router.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.signedCookies.spotify_auth_state || null;

  console.log('👉 GET /auth/callback');

  // Clear state cookie
  res.clearCookie('spotify_auth_state', {
    httpOnly: true,
    signed: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/'
  });

  if (state !== storedState) {
    console.error('❌ State mismatch');
    return res.redirect(`${process.env.FRONTEND_URI}?error=state_mismatch`);
  }

  if (!code) {
    console.error('❌ No authorization code');
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
        timeout: 10000
      }
    );
    
    const { access_token, refresh_token, expires_in } = response.data;
    console.log('✅ Successfully obtained tokens');

    // Set cookies
    const accessOptions = getCookieOptions(expires_in * 1000);
    res.cookie('spotify_token', access_token, accessOptions);
    
    if (refresh_token) {
      const refreshOptions = getCookieOptions(30 * 24 * 3600 * 1000);
      res.cookie('refresh_token', refresh_token, refreshOptions);
    }

    // Create token package for URL transfer
    const tokenPackage = {
      access_token,
      refresh_token,
      expires_in,
      expires_at: Date.now() + (expires_in * 1000),
      timestamp: Date.now()
    };

    const encodedTokens = encodeURIComponent(JSON.stringify(tokenPackage));
    
    console.log('🏠 Redirecting to frontend with tokens');
    res.redirect(`${process.env.FRONTEND_URI}?auth_tokens=${encodedTokens}`);

  } catch (err) {
    console.error('❌ Authentication failed:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URI}?error=auth_failed`);
  }
});

// 3. Store tokens from URL-based auth
router.post('/store-tokens', async (req, res) => {
  const { access_token, refresh_token, expires_in } = req.body;
  
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const tokenToVerify = access_token || headerToken;
  
  console.log('👉 POST /auth/store-tokens');

  if (!tokenToVerify) {
    return res.status(400).json({ error: 'Missing access token' });
  }

  try {
    // Verify token with Spotify
    const profile = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenToVerify}` },
      timeout: 5000
    });

    // Store in cookies if provided in body
    if (access_token) {
      const accessOptions = getCookieOptions(expires_in * 1000);
      res.cookie('spotify_token', access_token, accessOptions);
      
      if (refresh_token) {
        const refreshOptions = getCookieOptions(30 * 24 * 3600 * 1000);
        res.cookie('refresh_token', refresh_token, refreshOptions);
      }
    }

    console.log('✅ Tokens stored for user:', profile.data.display_name);
    res.json({ success: true, user: profile.data });

  } catch (err) {
    console.error('❌ Token verification failed:', err.response?.status, err.response?.data);
    
    if (err.response?.status === 429) {
      // Rate limited but token might be valid
      console.log('⚠️ Rate limited during verification, assuming token valid');
      if (access_token) {
        const accessOptions = getCookieOptions(expires_in * 1000);
        res.cookie('spotify_token', access_token, accessOptions);
        
        if (refresh_token) {
          const refreshOptions = getCookieOptions(30 * 24 * 3600 * 1000);
          res.cookie('refresh_token', refresh_token, refreshOptions);
        }
      }
      return res.json({ success: true, user: { display_name: 'Rate Limited User' } });
    }
    
    res.status(401).json({ error: 'Invalid tokens' });
  }
});

// 4. Get current user info
router.get('/me', async (req, res) => {
  console.log('👉 GET /auth/me');
  
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
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000
    });
    
    console.log('    ✅ authenticated as:', response.data.display_name);
    res.json({ user: response.data });
    
  } catch (err) {
    console.log('    ❌ token invalid:', err.response?.status || err.message);
    
    // If header token failed but we have refresh capability, try refresh
    if (authHeader && req.signedCookies.refresh_token) {
      console.log('    🔄 Attempting refresh with cookies...');
      return ensureSpotifyToken(req, res, () => {
        if (req.user) {
          return res.json({ user: req.user });
        }
        return res.json({ user: null });
      });
    }
    
    res.json({ user: null });
  }
});

// 5. Get token for Web Playback SDK
router.get('/token', async (req, res) => {
  console.log('👉 GET /auth/token');
  
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    console.log('    using header token');
    
    try {
      // Quick verification
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const userData = await response.json();
        console.log('   ↳ header token verified for:', userData.display_name);
        res.json({ 
          access_token: token,
          user: userData
        });
      } else if (response.status === 429) {
        // Rate limited but probably valid
        console.log('   ↳ header token rate limited but assuming valid');
        res.json({ 
          access_token: token,
          user: { display_name: 'Rate Limited User' }
        });
      } else {
        throw new Error(`Token verification failed: ${response.status}`);
      }
      
    } catch (err) {
      console.error('   ↳ header token verification failed:', err.message);
      
      // If header token failed but we have cookies, try cookie-based refresh
      if (req.signedCookies.refresh_token) {
        console.log('   🔄 Header failed, trying cookie refresh...');
        return ensureSpotifyToken(req, res, () => {
          const cookieToken = req.spotifyAccessToken;
          const user = req.user;
          
          if (!cookieToken) {
            return res.status(401).json({ 
              error: 'No access token available after refresh',
              reauth_required: true 
            });
          }
          
          console.log('   ↳ cookie refresh successful for:', user?.display_name);
          res.json({ 
            access_token: cookieToken,
            user: user
          });
        });
      }
      
      res.status(401).json({ 
        error: 'Invalid access token',
        reauth_required: true
      });
    }
    
    return; // Important: prevent fall-through
  }
  
  // Fall back to cookie-based auth with middleware
  console.log('    using cookie-based auth');
  return ensureSpotifyToken(req, res, () => {
    const cookieToken = req.spotifyAccessToken;
    const user = req.user;
    
    if (!cookieToken) {
      console.log('   ↳ no cookie token available');
      return res.status(401).json({ 
        error: 'No access token available',
        reauth_required: true 
      });
    }
    
    console.log('   ↳ cookie token verified for:', user?.display_name);
    res.json({ 
      access_token: cookieToken,
      user: user
    });
  });
});

// 6. Force reauth
router.get('/reauth', (req, res) => {
  console.log('👉 GET /auth/reauth');
  
  const clearOpts = getClearCookieOptions();
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  
  res.redirect('/auth/login');
});

// 7. Logout
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

// 8. Debug endpoint
router.get('/debug', (req, res) => {
  console.log('👉 GET /auth/debug');
  
  const authHeader = req.headers.authorization;
  const hasHeaderToken = !!(authHeader && authHeader.startsWith('Bearer '));
  
  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    headers: {
      origin: req.headers.origin,
      'user-agent': req.headers['user-agent']?.substring(0, 100),
      authorization: hasHeaderToken ? 'Bearer token present' : 'no auth header'
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URI: process.env.FRONTEND_URI,
      isProd: isProd
    },
    authMethods: {
      headerToken: hasHeaderToken,
      cookieToken: !!req.signedCookies.spotify_token,
      refreshToken: !!req.signedCookies.refresh_token
    }
  });
});

export default router;