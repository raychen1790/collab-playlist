// server/src/utils/spotifyApi.js
import axios from 'axios';

/**
 * Get track details including preview URL from Spotify
 * @param {string} spotifyId - Spotify track ID
 * @param {string} accessToken - Spotify access token
 * @returns {Object} Track details with preview URL
 */
export async function getTrackDetails(spotifyId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.spotify.com/v1/tracks/${spotifyId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const track = response.data;
    
    return {
      id: track.id,
      name: track.name,
      artists: track.artists,
      album: track.album,
      preview_url: track.preview_url,
      duration_ms: track.duration_ms,
      external_urls: track.external_urls,
    };
  } catch (error) {
    console.error(`Failed to get track details for ${spotifyId}:`, error.message);
    return null;
  }
}

/**
 * Get audio features for multiple tracks
 * @param {string[]} spotifyIds - Array of Spotify track IDs
 * @param {string} accessToken - Spotify access token
 * @returns {Object[]} Array of audio features
 */
export async function getAudioFeatures(spotifyIds, accessToken) {
  if (!spotifyIds.length) return [];

  try {
    // Spotify API allows up to 100 tracks per request
    const chunks = [];
    for (let i = 0; i < spotifyIds.length; i += 100) {
      chunks.push(spotifyIds.slice(i, i + 100));
    }

    const allFeatures = [];
    
    for (const chunk of chunks) {
      const response = await axios.get(
        `https://api.spotify.com/v1/audio-features`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { ids: chunk.join(',') }
        }
      );

      if (response.data.audio_features) {
        allFeatures.push(...response.data.audio_features);
      }
    }

    return allFeatures;
  } catch (error) {
    console.error('Failed to get audio features:', error.message);
    return [];
  }
}

/**
 * Enrich tracks with preview URLs and audio features
 * @param {Object[]} tracks - Array of track objects from database
 * @param {string} accessToken - Spotify access token
 * @param {boolean} includeAudioFeatures - Whether to include audio features
 * @returns {Object[]} Enriched tracks
 */
export async function enrichTracksWithSpotifyData(tracks, accessToken, includeAudioFeatures = false) {
  if (!tracks.length) return tracks;

  try {
    // Get basic track details (including preview URLs)
    const trackDetailsPromises = tracks.map(track => 
      getTrackDetails(track.spotifyId, accessToken)
    );
    
    const trackDetails = await Promise.all(trackDetailsPromises);

    // Get audio features if requested
    let audioFeatures = [];
    if (includeAudioFeatures) {
      const spotifyIds = tracks.map(t => t.spotifyId);
      audioFeatures = await getAudioFeatures(spotifyIds, accessToken);
    }

    // Merge the data
    return tracks.map((track, index) => {
      const details = trackDetails[index];
      const features = audioFeatures[index];

      return {
        ...track,
        previewUrl: details?.preview_url || null,
        duration: details?.duration_ms || null,
        externalUrl: details?.external_urls?.spotify || null,
        // Add audio features if available
        ...(features && {
          tempo: features.tempo,
          energy: features.energy,
          danceability: features.danceability,
          valence: features.valence,
          acousticness: features.acousticness,
          instrumentalness: features.instrumentalness,
          liveness: features.liveness,
          speechiness: features.speechiness,
          loudness: features.loudness,
          key: features.key,
          mode: features.mode,
          time_signature: features.time_signature,
        }),
      };
    });
  } catch (error) {
    console.error('Failed to enrich tracks with Spotify data:', error);
    return tracks; // Return original tracks if enrichment fails
  }
}

/**
 * Get track preview URL specifically
 * @param {string} spotifyId - Spotify track ID
 * @param {string} accessToken - Spotify access token
 * @returns {string|null} Preview URL or null
 */
export async function getTrackPreviewUrl(spotifyId, accessToken) {
  const details = await getTrackDetails(spotifyId, accessToken);
  return details?.preview_url || null;
}