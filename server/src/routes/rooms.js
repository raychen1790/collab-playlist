// server/routes/rooms.js - FIXED VERSION with comprehensive error handling
import { requireAuth }        from '../middleware/requireAuth.js';
import { ensureSpotifyToken } from '../middleware/ensureSpotifyToken.js';
import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import { getAudioFeatures } from '../utils/getAudioFeatures.js';

const router = express.Router();

router.use(requireAuth);
router.use(ensureSpotifyToken); 

// Helper function to validate Spotify playlist ID
function extractPlaylistId(input) {
  if (!input) return null;
  
  // If it's already a playlist ID (base62 string)
  if (/^[a-zA-Z0-9]+$/.test(input) && input.length > 10 && input.length < 30) {
    return input;
  }
  
  // Extract from URL patterns
  const patterns = [
    /playlist\/([a-zA-Z0-9]+)/,
    /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
    /spotify:playlist:([a-zA-Z0-9]+)/
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

// Helper function to make Spotify API requests with retry logic
async function makeSpotifyRequest(url, token, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🎵 Spotify API request (attempt ${attempt}/${retries}): ${url}`);
      
      const response = await fetch(url, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      // Log response details
      console.log(`📝 Spotify API response: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Spotify API success on attempt ${attempt}`);
        return { success: true, data, status: response.status };
      }
      
      // Handle specific error cases
      if (response.status === 404) {
        return { 
          success: false, 
          error: 'Playlist not found or not accessible', 
          status: 404,
          retryable: false
        };
      }
      
      if (response.status === 403) {
        return { 
          success: false, 
          error: 'Access forbidden - playlist may be private', 
          status: 403,
          retryable: false
        };
      }
      
      if (response.status === 401) {
        return { 
          success: false, 
          error: 'Invalid or expired token', 
          status: 401,
          retryable: false
        };
      }
      
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
        console.log(`⏳ Rate limited, waiting ${retryAfter}s...`);
        
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        
        return { 
          success: false, 
          error: 'Rate limited by Spotify', 
          status: 429,
          retryable: false
        };
      }
      
      // For 500 and other server errors, we can retry
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => '');
        console.log(`❌ Server error ${response.status} on attempt ${attempt}: ${errorText}`);
        
        if (attempt < retries) {
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        
        return { 
          success: false, 
          error: `Spotify server error: ${response.status}`, 
          status: response.status,
          details: errorText,
          retryable: true
        };
      }
      
      // Other errors
      const errorText = await response.text().catch(() => '');
      return { 
        success: false, 
        error: `Spotify API error: ${response.status}`, 
        status: response.status,
        details: errorText,
        retryable: false
      };
      
    } catch (fetchError) {
      console.log(`❌ Network error on attempt ${attempt}:`, fetchError.message);
      
      if (attempt < retries && (
        fetchError.name === 'AbortError' || 
        fetchError.message.includes('fetch') ||
        fetchError.message.includes('network')
      )) {
        console.log(`⏳ Retrying network error in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      
      return { 
        success: false, 
        error: `Network error: ${fetchError.message}`, 
        networkError: true,
        retryable: fetchError.name === 'AbortError'
      };
    }
  }
  
  return { 
    success: false, 
    error: 'Max retries exceeded', 
    retryable: false
  };
}

// POST /api/rooms
// Body: { name, spotifyPlaylistId }
router.post('/', async (req, res) => {
  const { name, spotifyPlaylistId } = req.body;
  const user = req.user;
  
  console.log('🏠 Creating room:', { name, spotifyPlaylistId, user: user?.display_name });
  
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  if (!name || !spotifyPlaylistId) {
    return res.status(400).json({ error: 'Name and Spotify playlist ID are required' });
  }
  
  // Validate and extract playlist ID
  const cleanPlaylistId = extractPlaylistId(spotifyPlaylistId);
  if (!cleanPlaylistId) {
    return res.status(400).json({ error: 'Invalid Spotify playlist URL or ID' });
  }
  
  console.log(`🎵 Using playlist ID: ${cleanPlaylistId}`);

  try {
    // 1) Upsert user
    const { data: rows, error: userErr } = await supabase
      .from('users')
      .upsert(
        { spotify_id: user.id, display_name: user.display_name },
        { onConflict: 'spotify_id', ignoreDuplicates: false, returning: 'representation' }
      )
      .select('id');

    if (userErr) {
      console.error('❌ User upsert error:', userErr);
      return res.status(500).json({ error: userErr.message });
    }

    const userId = rows?.[0]?.id;
    if (!userId) {
      return res.status(500).json({ error: 'Failed to retrieve user id' });
    }

    // 2) Test playlist access before creating room
    const token = req.spotifyAccessToken;
    const testUrl = `https://api.spotify.com/v1/playlists/${cleanPlaylistId}?fields=id,name,public,owner,tracks(total)`;
    
    const testResult = await makeSpotifyRequest(testUrl, token, 2, 1000);
    
    if (!testResult.success) {
      console.error('❌ Playlist validation failed:', testResult);
      return res.status(400).json({ 
        error: testResult.error,
        details: testResult.details,
        playlistId: cleanPlaylistId
      });
    }
    
    const playlistInfo = testResult.data;
    console.log(`✅ Playlist validated: "${playlistInfo.name}" (${playlistInfo.tracks.total} tracks)`);
    
    // 3) Create room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({
        name,
        host_user_id: userId,
        spotify_playlist: cleanPlaylistId, // Use clean ID
      })
      .select()
      .single();
      
    if (roomError) {
      console.error('❌ Room creation error:', roomError);
      return res.status(500).json({ error: roomError.message });
    }

    // 4) Add host as member
    const { error: memberError } = await supabase
      .from('room_members')
      .insert({ room_id: room.id, user_id: userId, role: 'host' });
      
    if (memberError) {
      console.error('❌ Member addition error:', memberError);
      return res.status(500).json({ error: memberError.message });
    }

    console.log(`✅ Room created successfully: ${room.id}`);
    res.status(201).json({ 
      room,
      playlistInfo: {
        name: playlistInfo.name,
        trackCount: playlistInfo.tracks.total,
        isPublic: playlistInfo.public
      }
    });
    
  } catch (error) {
    console.error('❌ Room creation failed:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// GET /api/rooms/:roomId
router.get('/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const sortMode = (req.query.sort || 'votes').toLowerCase();
  
  console.log(`🏠 Loading room: ${roomId} (sort: ${sortMode})`);
  
  try {
    // 1) Fetch room metadata
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id,name,spotify_playlist')
      .eq('id', roomId)
      .single();
      
    if (roomError) {
      console.error('❌ Room not found:', roomError);
      return res.status(404).json({ error: 'Room not found' });
    }
    
    console.log(`📁 Room found: "${room.name}" (playlist: ${room.spotify_playlist})`);

    // 2) Fetch playlist tracks from Spotify with comprehensive error handling
    const token = req.spotifyAccessToken;
    if (!token) {
      return res.status(401).json({ error: 'No Spotify token found' });
    }

    // Use the more detailed fields and add error handling for large playlists
    const playlistUrl = `https://api.spotify.com/v1/playlists/${room.spotify_playlist}/tracks?fields=items(track(id,name,artists,album(images),duration_ms,external_urls,available_markets,is_local,is_playable)),total,limit,offset`;
    
    const spotifyResult = await makeSpotifyRequest(playlistUrl, token);
    
    if (!spotifyResult.success) {
      console.error('❌ Failed to fetch Spotify playlist:', spotifyResult);
      
      // Provide specific error messages based on the error type
      let errorMessage = 'Failed to fetch Spotify playlist';
      let statusCode = 500;
      
      if (spotifyResult.status === 404) {
        errorMessage = 'Spotify playlist not found or not accessible';
        statusCode = 404;
      } else if (spotifyResult.status === 403) {
        errorMessage = 'Access denied to Spotify playlist - it may be private';
        statusCode = 403;
      } else if (spotifyResult.status === 401) {
        errorMessage = 'Spotify authentication expired';
        statusCode = 401;
      } else if (spotifyResult.networkError) {
        errorMessage = 'Network error connecting to Spotify';
        statusCode = 503;
      }
      
      return res.status(statusCode).json({ 
        error: errorMessage,
        details: spotifyResult.error,
        playlistId: room.spotify_playlist,
        retryable: spotifyResult.retryable
      });
    }
    
    const playlistData = spotifyResult.data;
    const items = playlistData.items || [];
    
    console.log(`🎵 Fetched ${items.length} tracks from Spotify playlist`);
    
    // Log sample track for debugging
    if (items.length > 0) {
      const sampleTrack = items[0]?.track;
      if (sampleTrack) {
        console.log(`📝 Sample track: "${sampleTrack.name}" by ${sampleTrack.artists?.[0]?.name}`);
        console.log(`🌍 Available markets: ${sampleTrack.available_markets?.length || 0} markets`);
        console.log(`🏠 Is local file: ${sampleTrack.is_local || false}`);
        console.log(`▶️ Is playable: ${sampleTrack.is_playable !== false}`);
      }
    }

    // Filter out null/invalid tracks
    const validItems = items.filter(item => 
      item && 
      item.track && 
      item.track.id && 
      item.track.name &&
      item.track.artists &&
      !item.track.is_local // Exclude local files
    );
    
    console.log(`✅ ${validItems.length} valid tracks after filtering`);
    
    if (validItems.length === 0) {
      return res.json({
        room,
        tracks: [],
        sort: sortMode,
        totalTracks: 0,
        playableTracks: 0,
        message: 'No playable tracks found in playlist'
      });
    }

    // 3) Handle database operations for tracks
    const spotifyTrackIds = validItems.map(item => item.track.id);
    
    // Check which tracks already exist for this room
    const { data: existingTracks, error: existingError } = await supabase
      .from('tracks')
      .select('spotify_track_id')
      .eq('room_id', roomId)
      .in('spotify_track_id', spotifyTrackIds);

    if (existingError) {
      console.error('❌ Existing tracks fetch error:', existingError);
      return res.status(500).json({ error: 'Failed to check existing tracks' });
    }

    // Insert new tracks
    const existingSpotifyIds = new Set(existingTracks?.map(t => t.spotify_track_id) || []);
    const newTracks = validItems
      .filter(item => !existingSpotifyIds.has(item.track.id))
      .map(item => ({
        room_id: roomId,
        spotify_track_id: item.track.id,
      }));

    if (newTracks.length > 0) {
      console.log(`➕ Inserting ${newTracks.length} new tracks`);
      const { error: insertError } = await supabase
        .from('tracks')
        .insert(newTracks);

      if (insertError) {
        console.error('❌ Track insert error:', insertError);
        return res.status(500).json({ error: 'Failed to save tracks to database' });
      }
    }

    // 4) Fetch tracks from database with their UUIDs
    const { data: dbTracks, error: fetchError } = await supabase
      .from('tracks')
      .select('id, spotify_track_id, added_at')
      .eq('room_id', roomId)
      .in('spotify_track_id', spotifyTrackIds);

    if (fetchError) {
      console.error('❌ Track fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch tracks from database' });
    }

    // 5) Get vote counts
    const trackIds = dbTracks.map(t => t.id);
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('track_id, vote')
      .in('track_id', trackIds);

    if (votesError) {
      console.error('❌ Votes fetch error:', votesError);
      return res.status(500).json({ error: 'Failed to fetch votes' });
    }

    // 6) Calculate scores
    const trackScores = {};
    dbTracks.forEach(track => {
      const trackVotes = votes?.filter(v => v.track_id === track.id) || [];
      const score = trackVotes.reduce((sum, v) => sum + v.vote, 0);
      trackScores[track.spotify_track_id] = {
        trackId: track.id,
        score: score,
        addedAt: track.added_at,
      };
    });

    // 7) Combine data and create track objects
    let tracks = validItems.map(item => {
      const dbData = trackScores[item.track.id];
      return {
        trackId: dbData?.trackId || null,
        spotifyId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map(a => a.name).join(', '),
        albumArt: item.track.album?.images?.[0]?.url || null,
        score: dbData?.score || 0,
        addedAt: dbData?.addedAt || new Date().toISOString(),
        duration: item.track.duration_ms,
        externalUrl: item.track.external_urls?.spotify,
        availableMarkets: item.track.available_markets?.length || 0,
        isLocal: item.track.is_local || false,
        isPlayable: item.track.is_playable !== false,
      };
    }).filter(track => track.trackId); // Only include tracks that exist in DB

    // 8) Handle sorting
    if (['tempo','energy','dance'].includes(sortMode)) {
      try {
        const features = await getAudioFeatures(tracks.map(t => t.trackId), token);

        tracks.forEach(t => {
          const f = features[t.trackId];
          t.tempo = f?.tempo;
          t.energy = f?.energy;
          t.danceability = f?.danceability;
        });

        const key = sortMode === 'dance' ? 'danceability' : sortMode;
        tracks.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
      } catch (featuresError) {
        console.error('❌ Audio features error:', featuresError);
        // Fall back to vote sorting if audio features fail
        tracks.sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));
      }
    } else {
      tracks.sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));
    }

    const playableTracksCount = tracks.filter(t => t.spotifyId).length;

    console.log(`✅ Room loaded successfully: ${tracks.length} tracks, ${playableTracksCount} playable`);

    res.json({ 
      room, 
      tracks,
      sort: sortMode,
      totalTracks: tracks.length,
      playableTracks: playableTracksCount,
    });

  } catch (error) {
    console.error('❌ Failed to load room:', error);
    res.status(500).json({ 
      error: 'Failed to load room',
      details: error.message
    });
  }
});

// Vote endpoint remains the same...
router.post('/:roomId/tracks/:trackId/vote', async (req, res) => {
  const { roomId, trackId } = req.params;
  const { vote } = req.body;
  const user = req.user;

  console.log('🗳️ Processing vote:', { roomId, trackId, vote, userId: user?.id });

  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (![1, 0, -1].includes(vote)) {
    return res.status(400).json({ error: 'Vote must be 1, 0, or -1' });
  }

  try {
    const { data: userRows, error: userErr } = await supabase
      .from('users')
      .upsert(
        { spotify_id: user.id, display_name: user.display_name },
        { onConflict: 'spotify_id', ignoreDuplicates: false, returning: 'representation' }
      )
      .select('id');

    if (userErr) {
      console.error('❌ User upsert error:', userErr);
      return res.status(500).json({ error: userErr.message });
    }

    if (!userRows || userRows.length === 0) {
      console.error('❌ No user data returned from upsert');
      return res.status(500).json({ error: 'Failed to get user data' });
    }

    const userId = userRows[0].id;

    // Verify track exists in room
    const { data: track, error: trackError } = await supabase
      .from('tracks')
      .select('id')
      .eq('id', trackId)
      .eq('room_id', roomId)
      .single();

    if (trackError || !track) {
      console.error('❌ Track verification failed:', { trackId, roomId, error: trackError });
      return res.status(404).json({ error: 'Track not found' });
    }

    if (vote === 0) {
      const { error: deleteError } = await supabase
        .from('votes')
        .delete()
        .eq('track_id', trackId)
        .eq('user_id', userId);

      if (deleteError) {
        console.error('❌ Vote delete error:', deleteError);
        return res.status(500).json({ error: 'Failed to remove vote' });
      }
    } else {
      const { error: voteError } = await supabase
        .from('votes')
        .upsert({
          track_id: trackId,
          user_id: userId,
          vote,
        });

      if (voteError) {
        console.error('❌ Vote upsert error:', voteError);
        return res.status(500).json({ error: 'Failed to submit vote' });
      }
    }

    // Get updated score
    const { data: votes } = await supabase
      .from('votes')
      .select('vote')
      .eq('track_id', trackId);

    const newScore = votes?.reduce((sum, v) => sum + v.vote, 0) || 0;
    
    console.log('✅ Vote processed successfully:', { trackId, newScore });

    res.json({ 
      success: true, 
      newScore,
      trackId,
    });

  } catch (error) {
    console.error('❌ Failed to submit vote:', error);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

// Enhanced test endpoint
router.get('/test-spotify/:playlistId', async (req, res) => {
  const { playlistId } = req.params;
  const token = req.spotifyAccessToken;
  
  if (!token) {
    return res.status(401).json({ error: 'No Spotify token found' });
  }

  console.log(`🧪 Testing Spotify playlist: ${playlistId}`);
  
  try {
    // Test playlist metadata first
    const metadataUrl = `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,public,owner,tracks(total)`;
    const metadataResult = await makeSpotifyRequest(metadataUrl, token);
    
    if (!metadataResult.success) {
      return res.status(metadataResult.status || 500).json({
        success: false,
        error: metadataResult.error,
        details: metadataResult.details
      });
    }
    
    // Test tracks endpoint
    const tracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=5&fields=items(track(id,name,artists,is_local,is_playable))`;
    const tracksResult = await makeSpotifyRequest(tracksUrl, token);
    
    if (!tracksResult.success) {
      return res.status(tracksResult.status || 500).json({
        success: false,
        error: tracksResult.error,
        details: tracksResult.details
      });
    }
    
    res.json({
      success: true,
      playlist: metadataResult.data,
      sampleTracks: tracksResult.data.items?.map(item => ({
        id: item.track.id,
        name: item.track.name,
        artists: item.track.artists.map(a => a.name),
        isLocal: item.track.is_local,
        isPlayable: item.track.is_playable
      })) || [],
      message: 'Playlist successfully fetched from Spotify'
    });
    
  } catch (error) {
    console.error('🚨 Spotify test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;