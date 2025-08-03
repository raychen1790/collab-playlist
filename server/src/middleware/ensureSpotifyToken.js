import { refreshSpotifyToken } from '../utils/refreshSpotifyToken.js';

/**
 * Ensures req.spotifyAccessToken is a live token.
 * If the access token is missing/expired but we have a refresh_token,
 * it transparently refreshes and sets a new spotify_token cookie.
 */
export async function ensureSpotifyToken(req, res, next) {
  let access  = req.signedCookies.spotify_token;
  const refresh = req.signedCookies.refresh_token;

  // test the token only when we actually need to call Spotify
  req.spotifyAccessToken = access;

  // fast-path: we already have one
  if (access) return next();

  // try refreshing
  if (!refresh) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const data = await refreshSpotifyToken(refresh);
    access = data.access_token;

    // set new 1-hour cookie
    res.cookie('spotify_token', access, {
      httpOnly: true,
      signed:   true,
      maxAge:   data.expires_in * 1000,  // seconds → ms
    });

    req.spotifyAccessToken = access;
    return next();
  } catch (err) {
    console.error('Refresh failed:', err.response?.data || err.message);
    return res.status(401).json({ error: 'Re-login required' });
  }
}
