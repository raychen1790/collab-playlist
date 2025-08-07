// server/src/middleware/ensureSpotifyToken.js - Enhanced debugging
import { refreshSpotifyToken } from '../utils/refreshSpotifyToken.js';

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
 * Ensures req.spotifyAccessToken is a live token.
 * If the access token is missing/expired but we have a refresh_token,
 * it transparently refreshes and sets a new spotify_token cookie.
 */
export async function ensureSpotifyToken(req, res, next) {
  const endpoint = `${req.method} ${req.path}`;
  console.log(`🔍 ensureSpotifyToken middleware for ${endpoint}`);
  console.log('    cookies:', Object.keys(req.cookies));
  console.log('    signed cookies:', Object.keys(req.signedCookies));
  console.log('    cookie header present:', !!req.headers.cookie);
  console.log('    cookie header length:', req.headers.cookie?.length || 0);
  console.log('    origin:', req.headers.origin);
  console.log('    user-agent prefix:', req.headers['user-agent']?.substring(0, 50));
  
  // Log a snippet of the cookie header for debugging
  if (req.headers.cookie) {
    console.log('    cookie header snippet:', req.headers.cookie.substring(0, 100) + '...');
  }
  
  let access = req.signedCookies.spotify_token;
  const refresh = req.signedCookies.refresh_token;

  console.log('    has access token:', !!access);
  console.log('    has refresh token:', !!refresh);
  console.log('    access token length:', access?.length || 0);
  console.log('    refresh token length:', refresh?.length || 0);

  // If we have access token, set it and continue
  if (access) {
    console.log('    ✅ Access token found, proceeding');
    req.spotifyAccessToken = access;
    return next();
  }

  console.log('    ❌ No access token, attempting refresh...');

  // Try refreshing if we have a refresh token
  if (!refresh) {
    console.log('    ❌ No refresh token available');
    console.log(`    ↳ Returning 401 for ${endpoint}`);
    return res.status(401).json({ 
      error: 'Not authenticated',
      debug: {
        hasAccessToken: !!access,
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
    access = data.access_token;

    console.log('    ✅ Token refreshed successfully');
    console.log('    New token expires in:', data.expires_in, 'seconds');
    console.log('    New token length:', access?.length || 0);

    // Set new cookie with consistent options
    const cookieOptions = getCookieOptions(data.expires_in * 1000);
    res.cookie('spotify_token', access, cookieOptions);
    console.log('    🍪 Set new cookie with options:', cookieOptions);
    
    req.spotifyAccessToken = access;
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
      debug: {
        refreshFailed: true,
        refreshError: err.message,
        endpoint: endpoint
      }
    });
  }
}