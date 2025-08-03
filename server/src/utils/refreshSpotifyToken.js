import axios from 'axios';

export async function refreshSpotifyToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  }).toString();

  const resp = await axios.post(
    'https://accounts.spotify.com/api/token',
    body,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
      },
    }
  );

  // success: { access_token, expires_in, scope, token_type }
  return resp.data;
}
