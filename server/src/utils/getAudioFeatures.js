import { supabase } from './supabaseClient.js';
import axios from 'axios';

// Helper function to search MusicBrainz for a recording
async function searchMusicBrainz(artist, track, duration = null) {
  try {
    const cleanArtist = artist.replace(/[^\w\s]/g, '').trim();
    const cleanTrack = track.replace(/[^\w\s]/g, '').trim();
    
    const query = `recording:"${cleanTrack}" AND artist:"${cleanArtist}"`;
    
    const response = await axios.get('https://musicbrainz.org/ws/2/recording', {
      params: {
        query: query,
        fmt: 'json',
        limit: 5
      },
      headers: {
        'User-Agent': 'CollabPlaylist/1.0 (raymondc@example.com)' 
      }
    });

    if (!response.data.recordings || response.data.recordings.length === 0) {
      return null;
    }

    // Find the best match
    let bestMatch = response.data.recordings[0];
    
    // If we have duration, try to find a closer match
    if (duration) {
      const targetDuration = duration / 1000;
      bestMatch = response.data.recordings.reduce((best, current) => {
        if (!current.length) return best;
        
        const currentDiff = Math.abs(current.length / 1000 - targetDuration);
        const bestDiff = Math.abs(best.length / 1000 - targetDuration);
        
        return currentDiff < bestDiff ? current : best;
      });
    }

    return bestMatch.id;
  } catch (error) {
    console.error('MusicBrainz search error:', error.message);
    return null;
  }
}

// Helper function to get features from AcousticBrainz
async function getAcousticBrainzFeatures(mbid) {
  try {
    // Try to get high-level features first includes danceability
    const highLevelResponse = await axios.get(
      `https://acousticbrainz.org/api/v1/${mbid}/high-level`,
      { timeout: 5000 }
    );
    
    const lowLevelResponse = await axios.get(
      `https://acousticbrainz.org/api/v1/${mbid}/low-level`,
      { timeout: 5000 }
    );

    const highLevel = highLevelResponse.data;
    const lowLevel = lowLevelResponse.data;

    // Extract features
    const tempo = lowLevel.rhythm?.bpm || 120;
    const energy = lowLevel.lowlevel?.spectral_energy?.mean || 0.5;
    
    // Try to get danceability from high-level data
    let danceability = 0.5;
    if (highLevel.highlevel?.danceability?.all) {
      const danceData = highLevel.highlevel.danceability.all;
      danceability = danceData.danceable || 0.5;
    }

    return {
      tempo: Math.round(tempo),
      energy: Math.min(1.0, Math.max(0.0, energy)),
      danceability: Math.min(1.0, Math.max(0.0, danceability))
    };
    
  } catch (error) {
    console.error('AcousticBrainz error:', error.message);
    return null;
  }
}

// Helper function to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get audio features using MusicBrainz + AcousticBrainz
 */
export async function getAudioFeatures(trackUuids, spotifyAccessToken) {
  if (!trackUuids.length) return {};

  console.log('🎵 getAudioFeatures called with:', trackUuids.length, 'tracks (using MusicBrainz/AcousticBrainz)');

  /* 1️ read cache */
  const { data: cached } = await supabase
    .from('audio_features')
    .select('track_id, tempo, energy, danceability')
    .in('track_id', trackUuids);

  const featuresMap = Object.fromEntries(
    (cached || []).map((row) => [row.track_id, row])
  );

  console.log('💾 Found', cached?.length || 0, 'cached features');

  /* 2️ figure out which UUIDs still need fetching */
  const missing = trackUuids.filter((id) => !featuresMap[id]);
  if (!missing.length) {
    console.log('✅ All features found in cache');
    return featuresMap;
  }

  console.log('🔍 Missing features for', missing.length, 'tracks');

  /* 3️ get track info from database and Spotify */
  const { data: trackRows } = await supabase
    .from('tracks')
    .select('id, spotify_track_id')
    .in('id', missing);

  if (!trackRows || trackRows.length === 0) {
    console.error('❌ No tracks found in database');
    return featuresMap;
  }

  // Get detailed track info from Spotify
  const spotifyIds = trackRows.map(r => r.spotify_track_id);
  const spotifyTracksUrl = `https://api.spotify.com/v1/tracks?ids=${spotifyIds.join(',')}`;
  
  let spotifyTracks = [];
  try {
    const spotifyResponse = await axios.get(spotifyTracksUrl, {
      headers: { Authorization: `Bearer ${spotifyAccessToken}` }
    });
    spotifyTracks = spotifyResponse.data.tracks;
    console.log('✅ Got Spotify track info for', spotifyTracks.length, 'tracks');
  } catch (error) {
    console.error('❌ Failed to get Spotify track info:', error.message);
    return featuresMap;
  }

  /* 4️ search MusicBrainz and get AcousticBrainz features */
  const toUpsert = [];
  
  for (let i = 0; i < spotifyTracks.length; i++) {
    const spotifyTrack = spotifyTracks[i];
    const trackRow = trackRows.find(r => r.spotify_track_id === spotifyTrack.id);
    
    if (!trackRow) continue;

    console.log(`🔍 Processing ${i + 1}/${spotifyTracks.length}: ${spotifyTrack.name} by ${spotifyTrack.artists[0].name}`);

    try {
      // Search MusicBrainz
      const mbid = await searchMusicBrainz(
        spotifyTrack.artists[0].name,
        spotifyTrack.name,
        spotifyTrack.duration_ms
      );

      if (!mbid) {
        console.log(`⚠️ No MusicBrainz match found for: ${spotifyTrack.name}`);
        // Create fallback features based on track metadata
        const fallbackFeatures = createFallbackFeatures(spotifyTrack);
        toUpsert.push({
          track_id: trackRow.id,
          ...fallbackFeatures
        });
        continue;
      }

      console.log(`✅ Found MusicBrainz ID: ${mbid}`);

      // Add delay to be respectful to APIs
      await delay(1000);

      // Get AcousticBrainz features
      const features = await getAcousticBrainzFeatures(mbid);

      if (features) {
        console.log(`✅ Got features: tempo=${features.tempo}, energy=${features.energy.toFixed(2)}, dance=${features.danceability.toFixed(2)}`);
        toUpsert.push({
          track_id: trackRow.id,
          tempo: features.tempo,
          energy: features.energy,
          danceability: features.danceability
        });
      } else {
        console.log(`⚠️ No AcousticBrainz data for MBID: ${mbid}`);
        // Create fallback features
        const fallbackFeatures = createFallbackFeatures(spotifyTrack);
        toUpsert.push({
          track_id: trackRow.id,
          ...fallbackFeatures
        });
      }

      // Add delay between requests
      await delay(500);

    } catch (error) {
      console.error(`❌ Error processing ${spotifyTrack.name}:`, error.message);
      // Create fallback features
      const fallbackFeatures = createFallbackFeatures(spotifyTrack);
      toUpsert.push({
        track_id: trackRow.id,
        ...fallbackFeatures
      });
    }
  }

  /* 5️ cache the features */
  if (toUpsert.length) {
    console.log('💾 Caching', toUpsert.length, 'features');
    try {
      await supabase.from('audio_features').upsert(toUpsert, {
        onConflict: 'track_id',
      });
    } catch (error) {
      console.error('❌ Failed to cache features:', error.message);
    }
  }

  /* 6️ merge into map */
  toUpsert.forEach((r) => {
    featuresMap[r.track_id] = r;
  });

  console.log('✅ Returning', Object.keys(featuresMap).length, 'total features');
  return featuresMap;
}

// Fallback feature generation based on Spotify metadata
function createFallbackFeatures(spotifyTrack) {
  const genres = spotifyTrack.artists[0].genres || [];
  const popularity = spotifyTrack.popularity || 50;
  const duration = spotifyTrack.duration_ms / 1000;
  
  // Estimate features based on available metadata
  let tempo = 120; // Default BPM
  let energy = 0.5;
  let danceability = 0.5;

  // Adjust based on genres if available
  const genreString = genres.join(' ').toLowerCase();
  
  if (genreString.includes('electronic') || genreString.includes('dance')) {
    tempo = 128;
    energy = 0.8;
    danceability = 0.8;
  } else if (genreString.includes('rock') || genreString.includes('metal')) {
    tempo = 140;
    energy = 0.9;
    danceability = 0.4;
  } else if (genreString.includes('jazz') || genreString.includes('blues')) {
    tempo = 100;
    energy = 0.6;
    danceability = 0.3;
  } else if (genreString.includes('pop')) {
    tempo = 120;
    energy = 0.7;
    danceability = 0.7;
  } else if (genreString.includes('classical')) {
    tempo = 90;
    energy = 0.3;
    danceability = 0.1;
  }

  // Adjust based on popularity (more popular songs tend to be more danceable)
  danceability += (popularity - 50) / 100 * 0.2;
  
  // Adjust based on duration (shorter songs often more energetic)
  if (duration < 180) { // Less than 3 minutes
    energy += 0.1;
    danceability += 0.1;
  }

  // Ensure values are in valid range
  return {
    tempo: Math.round(Math.max(60, Math.min(200, tempo))),
    energy: Math.max(0.0, Math.min(1.0, energy)),
    danceability: Math.max(0.0, Math.min(1.0, danceability))
  };
}