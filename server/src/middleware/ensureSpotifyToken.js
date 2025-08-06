import { refreshSpotifyToken } from '../utils/refreshSpotifyToken.js';

/**
 * Ensures req.spotifyAccessToken is a live token.
 * If the access token is missing/expired but we have a refresh_token,
 * it transparently refreshes and sets a new spotify_token cookie.
 */
export async function ensureSpotifyToken(req, res, next) {
  console.log('🔍 ensureSpotifyToken middleware');
  console.log('    cookies:', Object.keys(req.cookies));
  console.log('    signed cookies:', Object.keys(req.signedCookies));
  
  let access = req.signedCookies.spotify_token;
  const refresh = req.signedCookies.refresh_token;

  console.log('    has access token:', !!access);
  console.log('    has refresh token:', !!refresh);

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
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    console.log('    🔄 Refreshing token...');
    const data = await refreshSpotifyToken(refresh);
    access = data.access_token;

    console.log('    ✅ Token refreshed successfully');
    console.log('    New token expires in:', data.expires_in, 'seconds');

    // Set new cookie with proper cross-site options
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      signed: true,
      maxAge: data.expires_in * 1000,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
    };
    
    res.cookie('spotify_token', access, cookieOptions);
    console.log('    🍪 Set new cookie with options:', cookieOptions);
    
    req.spotifyAccessToken = access;
    return next();
  } catch (err) {
    console.error('    ❌ Refresh failed:', err.response?.data || err.message);
    
    // Clear invalid refresh token
    const clearOpts = {
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      httpOnly: true
    };
    res.clearCookie('refresh_token', clearOpts);
    
    return res.status(401).json({ error: 'Re-login required' });
  }
}