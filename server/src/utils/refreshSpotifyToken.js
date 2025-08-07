// server/src/utils/refreshSpotifyToken.js - FIXED VERSION
import axios from 'axios';

export async function refreshSpotifyToken(refreshToken) {
  console.log('🔄 Attempting to refresh Spotify token...');
  
  if (!refreshToken) {
    throw new Error('No refresh token provided');
  }

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing Spotify credentials in environment');
    throw new Error('Missing Spotify client credentials');
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString();

    console.log('🌐 Making request to Spotify token endpoint...');
    
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
        },
        timeout: 10000, // 10 second timeout
      }
    );

    console.log('✅ Token refresh successful');
    console.log('📊 New token expires in:', response.data.expires_in, 'seconds');

    // FIXED: Handle case where Spotify doesn't return a new refresh token
    const result = {
      access_token: response.data.access_token,
      token_type: response.data.token_type || 'Bearer',
      expires_in: response.data.expires_in || 3600,
      scope: response.data.scope
    };

    // Only include refresh_token if Spotify provided a new one
    if (response.data.refresh_token) {
      result.refresh_token = response.data.refresh_token;
      console.log('🔄 Received new refresh token');
    } else {
      console.log('♻️ Reusing existing refresh token');
      result.refresh_token = refreshToken; // Keep the original refresh token
    }

    return result;

  } catch (error) {
    console.error('❌ Token refresh failed:');
    
    if (error.response) {
      // Spotify API error
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
      
      const errorData = error.response.data;
      
      if (error.response.status === 400) {
        if (errorData.error === 'invalid_grant') {
          throw new Error('Refresh token is invalid or expired. Re-authentication required.');
        } else if (errorData.error === 'invalid_client') {
          throw new Error('Invalid client credentials. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.');
        } else {
          throw new Error(`Bad request: ${errorData.error_description || errorData.error}`);
        }
      } else if (error.response.status === 401) {
        throw new Error('Unauthorized: Invalid client credentials or refresh token.');
      } else if (error.response.status >= 500) {
        throw new Error('Spotify service temporarily unavailable. Please try again.');
      } else {
        throw new Error(`Spotify API error: ${error.response.status} - ${errorData.error || 'Unknown error'}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      // Timeout error
      console.error('   Timeout error');
      throw new Error('Request timed out. Please check your internet connection.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      // Network error
      console.error('   Network error:', error.code);
      throw new Error('Unable to connect to Spotify. Please check your internet connection.');
    } else {
      // Other errors
      console.error('   Unknown error:', error.message);
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }
}