// server/src/middleware/ensureSpotifyToken.js - FIXED VERSION
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
 * FIXED: Enhanced middleware with better error handling and token management
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

  // Prefer header token over cookie token
  const tokenToUse = headerToken || access;

  if (tokenToUse) {
    console.log(`    ✅ Using ${headerToken ? 'header' : 'cookie'} token`);
    
    // FIXED: Better token verification with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenToUse}` },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const userData = await response.json();
        console.log('    ✅ Token verified for user:', userData.display_name);
        req.spotifyAccessToken = tokenToUse;
        req.user = userData;
        return next();
      } else {
        const errorText = await response.text();
        console.log('    ❌ Token verification failed:', response.status, errorText);
        
        // If header token failed, don't try to refresh (client should handle)
        if (headerToken) {
          console.log('    ↳ Header token invalid, returning 401');
          return res.status(401).json({ 
            error: 'Invalid access token',
            reauth_required: true,
            debug: { source: 'header_token_invalid' }
          });
        }
        
        // Cookie token failed, try refreshing if we have refresh token
        if (!refresh) {
          console.log('    ↳ No refresh token available after cookie verification failed');
          return res.status(401).json({ 
            error: 'Token expired and no refresh available',
            reauth_required: true,
            debug: { source: 'cookie_token_invalid_no_refresh' }
          });
        }
        // Fall through to refresh logic
      }
    } catch (verifyError) {
      console.log('    ❌ Token verification error:', verifyError.message);
      
      if (headerToken) {
        return res.status(401).json({ 
          error: 'Token verification failed',
          reauth_required: true,
          debug: { source: 'header_token_verify_error', error: verifyError.message }
        });
      }
      
      if (!refresh) {
        return res.status(401).json({ 
          error: 'Token verification failed and no refresh available',
          reauth_required: true,
          debug: { source: 'cookie_token_verify_error_no_refresh', error: verifyError.message }
        });
      }
      // Fall through to refresh logic
    }
  }

  console.log('    🔄 Attempting token refresh...');

  // Try refreshing if we have a refresh token
  if (!refresh) {
    console.log('    ❌ No refresh token available');
    console.log(`    ↳ Returning 401 for ${endpoint}`);
    return res.status(401).json({ 
      error: 'Not authenticated - no tokens available',
      reauth_required: true,
      debug: {
        hasHeaderToken: !!headerToken,
        hasCookieToken: !!access,
        hasRefreshToken: !!refresh,
        endpoint: endpoint
      }
    });
  }

  try {
    console.log('    🔄 Refreshing token...');
    const data = await refreshSpotifyToken(refresh);
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token; // May be the same as original

    console.log('    ✅ Token refreshed successfully');
    console.log('    New token expires in:', data.expires_in, 'seconds');

    // FIXED: Set both access and refresh tokens with proper options
    const accessTokenCookieOptions = getCookieOptions(data.expires_in * 1000);
    res.cookie('spotify_token', newAccessToken, accessTokenCookieOptions);
    
    // Update refresh token if we got a new one
    if (newRefreshToken !== refresh) {
      console.log('    🔄 Updating refresh token');
      const refreshTokenCookieOptions = getCookieOptions(30 * 24 * 3600 * 1000); // 30 days
      res.cookie('refresh_token', newRefreshToken, refreshTokenCookieOptions);
    }
    
    console.log('    🍪 Set new cookies with options:', accessTokenCookieOptions);
    
    // FIXED: Verify the new token and get user data with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${newAccessToken}` },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (userResponse.ok) {
        const userData = await userResponse.json();
        console.log('    ✅ New token verified for user:', userData.display_name);
        req.spotifyAccessToken = newAccessToken;
        req.user = userData;
        return next();
      } else {
        throw new Error(`User verification failed: ${userResponse.status}`);
      }
    } catch (userVerifyError) {
      console.error('    ❌ New token verification failed:', userVerifyError.message);
      throw userVerifyError;
    }
    
  } catch (refreshErr) {
    console.error('    ❌ Refresh failed:', refreshErr.message);
    console.error('    ❌ Full refresh error details:', {
      message: refreshErr.message,
      stack: refreshErr.stack?.substring(0, 200)
    });
    
    // FIXED: Clear invalid cookies with consistent options
    const clearOpts = getClearCookieOptions();
    res.clearCookie('spotify_token', clearOpts);
    res.clearCookie('refresh_token', clearOpts);
    console.log('    🗑️ Cleared invalid tokens');
    
    // FIXED: Better error response based on error type
    let errorMessage = 'Re-authentication required';
    let shouldReauth = true;
    
    if (refreshErr.message.includes('temporarily unavailable')) {
      errorMessage = 'Spotify service temporarily unavailable';
      shouldReauth = false;
    } else if (refreshErr.message.includes('timeout') || refreshErr.message.includes('network')) {
      errorMessage = 'Network error during token refresh';
      shouldReauth = false;
    }
    
    console.log(`    ↳ Returning 401 after failed refresh for ${endpoint}`);
    return res.status(401).json({ 
      error: errorMessage,
      reauth_required: shouldReauth,
      debug: {
        refreshFailed: true,
        refreshError: refreshErr.message,
        endpoint: endpoint,
        errorType: refreshErr.constructor.name
      }
    });
  }
}

// FIXED: Add a helper function for checking if token refresh is possible
export function canRefreshToken(req) {
  return !!(req.signedCookies?.refresh_token);
}

// FIXED: Add a helper function for clearing all auth cookies
export function clearAllAuthCookies(res) {
  const clearOpts = getClearCookieOptions();
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  res.clearCookie('spotify_auth_state', {
    ...clearOpts,
    maxAge: undefined // Don't set maxAge for clearing
  });
  console.log('🗑️ Cleared all authentication cookies');
}