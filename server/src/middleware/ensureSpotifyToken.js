// server/src/middleware/ensureSpotifyToken.js - STREAMLINED VERSION
import { refreshSpotifyToken } from '../utils/refreshSpotifyToken.js';

const isProd = process.env.NODE_ENV === 'production';

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

// Simplified token verification with single retry
async function verifySpotifyToken(token, retries = 1) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`    🔍 Verifying token (attempt ${attempt}/${retries})...`);
      
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      });
      
      if (response.ok) {
        const userData = await response.json();
        console.log('    ✅ Token verified for user:', userData.display_name);
        return { valid: true, userData };
      } else if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
        console.log(`    ⏳ Rate limited, retry in ${retryAfter}s...`);
        
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        return { valid: false, error: 'rate_limited', retryAfter };
      } else if (response.status === 401) {
        console.log('    ❌ Token invalid (401)');
        return { valid: false, error: 'invalid_token', status: 401 };
      } else {
        console.log(`    ❌ Verification failed (${response.status})`);
        return { valid: false, error: 'verification_failed', status: response.status };
      }
    } catch (verifyError) {
      console.log(`    ❌ Attempt ${attempt} error:`, verifyError.message);
      
      if (attempt === retries) {
        return { 
          valid: false, 
          error: 'network_error', 
          message: verifyError.message,
          isTimeout: verifyError.name === 'AbortError'
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { valid: false, error: 'max_retries_exceeded' };
}

/**
 * STREAMLINED: Middleware focused on core functionality
 */
export async function ensureSpotifyToken(req, res, next) {
  const endpoint = `${req.method} ${req.path}`;
  console.log(`🔍 ensureSpotifyToken for ${endpoint}`);
  
  // 1. Check Authorization header first (preferred)
  const authHeader = req.headers.authorization;
  let headerToken = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    headerToken = authHeader.slice(7);
    console.log('    ✅ Found Authorization header');
  }
  
  // 2. Check cookies as fallback
  const cookieToken = req.signedCookies.spotify_token;
  const refreshToken = req.signedCookies.refresh_token;

  console.log('    Auth status:', {
    hasHeaderToken: !!headerToken,
    hasCookieToken: !!cookieToken,
    hasRefreshToken: !!refreshToken
  });

  const tokenToUse = headerToken || cookieToken;

  // 3. If we have a token, verify it
  if (tokenToUse) {
    const verificationResult = await verifySpotifyToken(tokenToUse);
    
    if (verificationResult.valid) {
      req.spotifyAccessToken = tokenToUse;
      req.user = verificationResult.userData;
      return next();
    }
    
    console.log('    ❌ Token verification failed:', verificationResult.error);
    
    // Handle rate limiting gracefully
    if (verificationResult.error === 'rate_limited') {
      if (headerToken) {
        // For header tokens, proceed with warning
        console.log('    ⚠️ Header token rate limited but proceeding');
        req.spotifyAccessToken = tokenToUse;
        req.user = { display_name: 'Rate Limited User' };
        return next();
      }
    }
    
    // Handle network timeouts gracefully
    if (verificationResult.error === 'network_error' && verificationResult.isTimeout) {
      if (headerToken) {
        console.log('    ⚠️ Header token timeout but proceeding');
        req.spotifyAccessToken = tokenToUse;
        req.user = { display_name: 'Network Timeout User' };
        return next();
      }
    }
    
    // If header token failed, return 401 (client should handle refresh)
    if (headerToken) {
      console.log('    ↳ Header token invalid, returning 401');
      return res.status(401).json({ 
        error: 'Invalid access token',
        reauth_required: true,
        debug: { 
          source: 'header_token_invalid',
          reason: verificationResult.error
        }
      });
    }
    
    // Cookie token failed, try refresh if available
    if (!refreshToken) {
      console.log('    ↳ No refresh token available');
      return res.status(401).json({ 
        error: 'Token expired and no refresh available',
        reauth_required: true,
        debug: { 
          source: 'cookie_token_invalid_no_refresh',
          reason: verificationResult.error
        }
      });
    }
    // Fall through to refresh logic
  }

  // 4. No valid token, try refreshing
  if (!refreshToken) {
    console.log('    ❌ No tokens available');
    return res.status(401).json({ 
      error: 'Not authenticated - no tokens available',
      reauth_required: true,
      debug: { endpoint }
    });
  }

  try {
    console.log('    🔄 Refreshing token...');
    const data = await refreshSpotifyToken(refreshToken);
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token;

    console.log('    ✅ Token refreshed successfully');

    // Set new cookies
    const accessOptions = getCookieOptions(data.expires_in * 1000);
    res.cookie('spotify_token', newAccessToken, accessOptions);
    
    if (newRefreshToken !== refreshToken) {
      const refreshOptions = getCookieOptions(30 * 24 * 3600 * 1000);
      res.cookie('refresh_token', newRefreshToken, refreshOptions);
    }
    
    // Verify new token
    const newTokenVerification = await verifySpotifyToken(newAccessToken);
    
    if (newTokenVerification.valid) {
      req.spotifyAccessToken = newAccessToken;
      req.user = newTokenVerification.userData;
      return next();
    } else {
      throw new Error(`New token verification failed: ${newTokenVerification.error}`);
    }
    
  } catch (refreshErr) {
    console.error('    ❌ Refresh failed:', refreshErr.message);
    
    // Clear invalid cookies
    const clearOpts = getClearCookieOptions();
    res.clearCookie('spotify_token', clearOpts);
    res.clearCookie('refresh_token', clearOpts);
    
    // Determine error type and response
    let errorMessage = 'Re-authentication required';
    let shouldReauth = true;
    let errorCode = 'refresh_failed';
    
    if (refreshErr.message.includes('503') || refreshErr.message.includes('502')) {
      errorMessage = 'Spotify service temporarily unavailable';
      shouldReauth = false;
      errorCode = 'service_unavailable';
    } else if (refreshErr.message.includes('timeout') || refreshErr.message.includes('network')) {
      errorMessage = 'Network error during token refresh';
      shouldReauth = false;
      errorCode = 'network_error';
    } else if (refreshErr.message.includes('429')) {
      errorMessage = 'Rate limited during token refresh';
      shouldReauth = false;
      errorCode = 'rate_limited';
    } else if (refreshErr.message.includes('400') || refreshErr.message.includes('invalid_grant')) {
      errorMessage = 'Refresh token expired - please re-authenticate';
      shouldReauth = true;
      errorCode = 'refresh_token_expired';
    }
    
    return res.status(401).json({ 
      error: errorMessage,
      reauth_required: shouldReauth,
      debug: {
        refreshFailed: true,
        refreshError: refreshErr.message,
        endpoint,
        errorCode
      }
    });
  }
}

// Helper function for checking token health
export async function checkTokenHealth(token) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000) 
    });
    
    return {
      healthy: response.ok,
      status: response.status,
      rateLimited: response.status === 429,
      retryAfter: response.status === 429 ? response.headers.get('Retry-After') : null
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timeout: error.name === 'AbortError'
    };
  }
}

export function clearAllAuthCookies(res) {
  const clearOpts = getClearCookieOptions();
  res.clearCookie('spotify_token', clearOpts);
  res.clearCookie('refresh_token', clearOpts);
  res.clearCookie('spotify_auth_state', {
    ...clearOpts,
    maxAge: undefined
  });
  console.log('🗑️ Cleared all authentication cookies');
}