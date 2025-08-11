// server/src/middleware/ensureSpotifyToken.js - ENHANCED VERSION with better 404 handling
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

// Enhanced token verification with retry logic
async function verifySpotifyToken(token, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`    🔍 Verifying token (attempt ${attempt}/${retries})...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // Increased timeout
      
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const userData = await response.json();
        console.log('    ✅ Token verified for user:', userData.display_name);
        return { valid: true, userData };
      } else if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
        console.log(`    ⏳ Rate limited, waiting ${retryAfter}s before retry...`);
        
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        } else {
          return { valid: false, error: 'rate_limited', retryAfter };
        }
      } else if (response.status === 401) {
        const errorData = await response.text().catch(() => '');
        console.log('    ❌ Token invalid (401):', errorData);
        return { valid: false, error: 'invalid_token', status: 401 };
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.log(`    ❌ Token verification failed (${response.status}):`, errorText);
        return { valid: false, error: 'verification_failed', status: response.status };
      }
    } catch (verifyError) {
      console.log(`    ❌ Token verification attempt ${attempt} error:`, verifyError.message);
      
      if (attempt === retries) {
        return { 
          valid: false, 
          error: 'network_error', 
          message: verifyError.message,
          isTimeout: verifyError.name === 'AbortError'
        };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  return { valid: false, error: 'max_retries_exceeded' };
}

/**
 * ENHANCED: Middleware with comprehensive error handling and token management
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
    
    // Enhanced token verification with retry logic
    const verificationResult = await verifySpotifyToken(tokenToUse);
    
    if (verificationResult.valid) {
      req.spotifyAccessToken = tokenToUse;
      req.user = verificationResult.userData;
      return next();
    } else {
      console.log('    ❌ Token verification failed:', verificationResult.error);
      
      // Handle different verification failure types
      if (verificationResult.error === 'rate_limited') {
        // For rate limiting, we might still want to proceed if it's a header token
        if (headerToken) {
          console.log('    ⚠️ Header token rate limited but proceeding');
          req.spotifyAccessToken = tokenToUse;
          req.user = { display_name: 'Rate Limited User' }; // Placeholder
          return next();
        }
      }
      
      if (verificationResult.error === 'network_error' && verificationResult.isTimeout) {
        // Network timeout - might be temporary
        if (headerToken) {
          console.log('    ⚠️ Header token verification timeout but proceeding');
          req.spotifyAccessToken = tokenToUse;
          req.user = { display_name: 'Network Timeout User' }; // Placeholder
          return next();
        }
      }
      
      // If header token failed, don't try to refresh (client should handle)
      if (headerToken) {
        console.log('    ↳ Header token invalid, returning 401');
        return res.status(401).json({ 
          error: 'Invalid access token',
          reauth_required: true,
          debug: { 
            source: 'header_token_invalid',
            reason: verificationResult.error,
            status: verificationResult.status
          }
        });
      }
      
      // Cookie token failed, try refreshing if we have refresh token
      if (!refresh) {
        console.log('    ↳ No refresh token available after cookie verification failed');
        return res.status(401).json({ 
          error: 'Token expired and no refresh available',
          reauth_required: true,
          debug: { 
            source: 'cookie_token_invalid_no_refresh',
            reason: verificationResult.error,
            status: verificationResult.status
          }
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

    // Set both access and refresh tokens with proper options
    const accessTokenCookieOptions = getCookieOptions(data.expires_in * 1000);
    res.cookie('spotify_token', newAccessToken, accessTokenCookieOptions);
    
    // Update refresh token if we got a new one
    if (newRefreshToken !== refresh) {
      console.log('    🔄 Updating refresh token');
      const refreshTokenCookieOptions = getCookieOptions(30 * 24 * 3600 * 1000); // 30 days
      res.cookie('refresh_token', newRefreshToken, refreshTokenCookieOptions);
    }
    
    console.log('    🍪 Set new cookies with options:', accessTokenCookieOptions);
    
    // Verify the new token with enhanced verification
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
    console.error('    ❌ Full refresh error details:', {
      message: refreshErr.message,
      stack: refreshErr.stack?.substring(0, 200)
    });
    
    // Clear invalid cookies with consistent options
    const clearOpts = getClearCookieOptions();
    res.clearCookie('spotify_token', clearOpts);
    res.clearCookie('refresh_token', clearOpts);
    console.log('    🗑️ Cleared invalid tokens');
    
    // Enhanced error response based on error type
    let errorMessage = 'Re-authentication required';
    let shouldReauth = true;
    let errorCode = 'refresh_failed';
    
    if (refreshErr.message.includes('temporarily unavailable') || 
        refreshErr.message.includes('503') || 
        refreshErr.message.includes('502')) {
      errorMessage = 'Spotify service temporarily unavailable';
      shouldReauth = false;
      errorCode = 'service_unavailable';
    } else if (refreshErr.message.includes('timeout') || 
               refreshErr.message.includes('network') ||
               refreshErr.message.includes('ENOTFOUND') ||
               refreshErr.message.includes('ECONNREFUSED')) {
      errorMessage = 'Network error during token refresh';
      shouldReauth = false;
      errorCode = 'network_error';
    } else if (refreshErr.message.includes('429') || 
               refreshErr.message.includes('rate limit')) {
      errorMessage = 'Rate limited during token refresh';
      shouldReauth = false;
      errorCode = 'rate_limited';
    } else if (refreshErr.message.includes('400') || 
               refreshErr.message.includes('invalid_grant')) {
      errorMessage = 'Refresh token expired - please re-authenticate';
      shouldReauth = true;
      errorCode = 'refresh_token_expired';
    }
    
    console.log(`    ↳ Returning 401 after failed refresh for ${endpoint}`);
    return res.status(401).json({ 
      error: errorMessage,
      reauth_required: shouldReauth,
      debug: {
        refreshFailed: true,
        refreshError: refreshErr.message,
        endpoint: endpoint,
        errorType: refreshErr.constructor.name,
        errorCode: errorCode
      }
    });
  }
}

// Add a helper function for checking token health
export async function checkTokenHealth(token) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
      // Quick health check with shorter timeout
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

// Add a helper function for checking if token refresh is possible
export function canRefreshToken(req) {
  return !!(req.signedCookies?.refresh_token);
}

// Add a helper function for clearing all auth cookies
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

// Add debugging middleware for token issues
export function debugTokenMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = req.signedCookies.spotify_token;
  const refreshToken = req.signedCookies.refresh_token;
  
  console.log('🔍 Token Debug Info:', {
    endpoint: `${req.method} ${req.path}`,
    hasHeaderToken: !!headerToken,
    hasCookieToken: !!cookieToken,
    hasRefreshToken: !!refreshToken,
    headerTokenPreview: headerToken ? `${headerToken.substring(0, 10)}...` : null,
    cookieTokenPreview: cookieToken ? `${cookieToken.substring(0, 10)}...` : null,
    tokensMatch: headerToken && cookieToken ? headerToken === cookieToken : null,
    userAgent: req.headers['user-agent']?.substring(0, 100),
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
  
  next();
}