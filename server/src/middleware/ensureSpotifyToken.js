// server/src/middleware/ensureSpotifyToken.js - Enhanced for dual auth
import { refreshSpotifyToken } from '../utils/refreshSpotifyToken.js';
import axios from 'axios';

const isProd = process.env.NODE_ENV === 'production';

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

/**
 * Enhanced middleware that handles both cookie-based and header-based authentication
 * Ensures req.spotifyAccessToken is a live token.
 */
export async function ensureSpotifyToken(req, res, next) {
  const endpoint = `${req.method} ${req.path}`;
  console.log(`🔍 ensureSpotifyToken middleware for ${endpoint}`);
  
  // Check for Authorization header first (preferred method)
  const authHeader = req.headers.authorization;
  let headerToken = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    headerToken = authHeader.slice(7);
    console.log('    found Authorization header with token');
  }
  
  // Check cookies as fallback
  let access = req.signedCookies.spotify_token;
  const refresh = req.signedCookies.refresh_token;

  console.log('    has header token:', !!headerToken);
  console.log('    has cookie access token:', !!access);
  console.log('    has refresh token:', !!refresh);
  console.log('    cookie header present:', !!req.headers.cookie);
  console.log('    origin:', req.headers.origin);

  // Prefer header token over cookie token
  const tokenToUse = headerToken || access;

  if (tokenToUse) {
    console.log(`    ✅ Using ${headerToken ? 'header' : 'cookie'} token`);
    
    // Verify the token is still valid before proceeding
    try {
      const response = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenToUse}` },
        timeout: 5000
      });
      
      console.log('    ✅ Token verified for user:', response.data.display_name);
      req.spotifyAccessToken = tokenToUse;
      req.user = response.data; // Store user data
      return next();
      
    } catch (verifyError) {
      console.log('    ❌ Token verification failed:', verifyError.response?.status, verifyError.response?.data?.error?.message || verifyError.message);
      
      // If header token failed, don't try to refresh (client should handle)
      if (headerToken) {
        console.log('    ↳ Header token invalid, returning 401');
        return res.status(401).json({ 
          error: 'Invalid access token',
          reauth_required: true,
          debug: { source: 'header_token_invalid' }
        });
      }
      
      // If cookie token failed and we have refresh token, try refreshing
      if (refresh) {
        console.log('    🔄 Cookie token invalid, attempting refresh...');
        // Fall through to refresh logic
      } else {
        console.log('    ↳ No refresh token available after cookie verification failed');
        return res.status(401).json({ 
          error: 'Token expired and no refresh available',
          reauth_required: true,
          debug: { source: 'cookie_token_invalid_no_refresh' }
        });
      }
    }
  }

  console.log('    ❌ No valid access token, attempting refresh...');

  // Try refreshing if we have a refresh token
  if (!refresh) {
    console.log('    ❌ No refresh token available');
    console.log(`    ↳ Returning 401 for ${endpoint}`);
    return res.status(401).json({ 
      error: 'Not authenticated',
      reauth_required: true,
      debug: {
        hasHeaderToken: !!headerToken,
        hasCookieToken: !!access,
        hasRefreshToken: !!refresh,
        cookiesCount: Object.keys(req.cookies).length,
        signedCookiesCount: Object.keys(req.signedCookies).length,
        cookieHeaderPresent: !!req.headers.cookie,
        endpoint: endpoint
      }
    });
  }

  try {
    console.log('    🔄 Refreshing token...');
    const data = await refreshSpotifyToken(refresh);
    const newAccessToken = data.access_token;

    console.log('    ✅ Token refreshed successfully');
    console.log('    New token expires in:', data.expires_in, 'seconds');

    // Set new cookie with consistent options
    const cookieOptions = getCookieOptions(data.expires_in * 1000);
    res.cookie('spotify_token', newAccessToken, cookieOptions);
    console.log('    🍪 Set new cookie with options:', cookieOptions);
    
    // Verify the new token and get user data
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${newAccessToken}` }
    });
    
    req.spotifyAccessToken = newAccessToken;
    req.user = userResponse.data;
    return next();
    
  } catch (err) {
    console.error('    ❌ Refresh failed:', err.response?.data || err.message);
    console.error('    ❌ Full refresh error:', {
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message
    });
    
    // Clear invalid refresh token with consistent options
    const clearOpts = getClearCookieOptions();
    res.clearCookie('refresh_token', clearOpts);
    console.log('    🗑️ Cleared invalid refresh token');
    
    console.log(`    ↳ Returning 401 after failed refresh for ${endpoint}`);
    return res.status(401).json({ 
      error: 'Re-login required',
      reauth_required: true,
      debug: {
        refreshFailed: true,
        refreshError: err.message,
        endpoint: endpoint
      }
    });
  }
}