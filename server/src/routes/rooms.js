import { requireAuth }        from '../middleware/requireAuth.js';
import { ensureSpotifyToken } from '../middleware/ensureSpotifyToken.js';
import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import { getAudioFeatures } from '../utils/getAudioFeatures.js';

const router = express.Router();

router.use(requireAuth);
router.use(ensureSpotifyToken); 

// POST /api/rooms
// Body: { name, spotifyPlaylistId }
router.post('/', async (req, res) => {
  const { name, spotifyPlaylistId } = req.body;
  const user = req.user; // from your auth middleware after /me
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { data: rows, error: userErr } = await supabase
    .from('users')
    .upsert(
      { spotify_id: user.id, display_name: user.display_name },
      { onConflict: 'spotify_id', ignoreDuplicates: false, returning: 'representation' }
    )
    .select('id');

  if (userErr) {
    console.error(userErr);
    return res.status(500).json({ error: userErr.message });
  }

  const userId = rows?.[0]?.id;
  if (!userId) {
    return res.status(500).json({ error: 'Failed to retrieve user id' });
  }
  
  // 2) Create room
  const { data: room, error: e3 } = await supabase
    .from('rooms')
    .insert({
      name,
      host_user_id: userId,
      spotify_playlist: spotifyPlaylistId,
    })
    .select()
    .single();
  if (e3) return res.status(500).json({ error: e3.message });

  // 3) Add host as member
  const { error: e4 } = await supabase
    .from('room_members')
    .insert({ room_id: room.id, user_id: userId, role: 'host' });
  if (e4) return res.status(500).json({ error: e4.message });

  res.status(201).json({ room });
});

// GET /api/rooms/:roomId
router.get('/:roomId', async (req, res) => {
  const { roomId } = req.params;
  
  // 1) Fetch room metadata
  const { data: room, error: e1 } = await supabase
    .from('rooms')
    .select('id,name,spotify_playlist')
    .eq('id', roomId)
    .single();
  if (e1) return res.status(404).json({ error: 'Room not found' });

  // 2) Fetch playlist tracks from Spotify
  const token = req.spotifyAccessToken;
  if (!token) {
    return res.status(401).json({ error: 'No Spotify token found' });
  }

  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${room.spotify_playlist}/tracks?fields=items(track(id,name,artists,album,duration_ms,external_urls,available_markets,is_local,is_playable))`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!response.ok) {
    return res.status(500).json({ error: 'Failed to fetch Spotify playlist' });
  }
  
  const { items } = await response.json();
  console.log('🎵 Debug: Analyzing playlist tracks...');
  const sampleTrack = items[0]?.track;
  if (sampleTrack) {
    console.log(`📝 Sample track: "${sampleTrack.name}" by ${sampleTrack.artists?.[0]?.name}`);
    console.log(`🌍 Available markets: ${sampleTrack.available_markets?.length || 0} markets`);
    console.log(`🏠 Is local file: ${sampleTrack.is_local || false}`);
    console.log(`▶️ Is playable: ${sampleTrack.is_playable !== false}`);
  }

  // 3) Only insert tracks that don't already exist in this room
  const spotifyTrackIds = items.map(item => item.track.id);
  
  // Check which tracks already exist for this room
  const { data: existingTracks, error: existingError } = await supabase
    .from('tracks')
    .select('spotify_track_id')
    .eq('room_id', roomId)
    .in('spotify_track_id', spotifyTrackIds);

  if (existingError) {
    console.error('Existing tracks fetch error:', existingError);
    return res.status(500).json({ error: 'Failed to check existing tracks' });
  }

  // Find tracks that don't exist yet
  const existingSpotifyIds = new Set(existingTracks?.map(t => t.spotify_track_id) || []);
  const newTracks = items
    .filter(item => !existingSpotifyIds.has(item.track.id))
    .map(item => ({
      room_id: roomId,
      spotify_track_id: item.track.id,
    }));

  // Insert only new tracks
  if (newTracks.length > 0) {
    const { error: insertError } = await supabase
      .from('tracks')
      .insert(newTracks);

    if (insertError) {
      console.error('Track insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save tracks to database' });
    }
  }

  // 4) Fetch tracks from database with their UUIDs
  const { data: dbTracks, error: fetchError } = await supabase
    .from('tracks')
    .select('id, spotify_track_id, added_at')
    .eq('room_id', roomId)
    .in('spotify_track_id', items.map(item => item.track.id));

  if (fetchError) {
    console.error('Track fetch error:', fetchError);
    return res.status(500).json({ error: 'Failed to fetch tracks from database' });
  }

  // 5) Get vote counts for all tracks in this room
  const trackIds = dbTracks.map(t => t.id);
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('track_id, vote')
    .in('track_id', trackIds);

  if (votesError) {
    console.error('Votes fetch error:', votesError);
    return res.status(500).json({ error: 'Failed to fetch votes' });
  }

  // 6) Calculate scores and create lookup map
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

  // 7) Combine Spotify metadata with database UUIDs and scores
  let tracks = items.map(item => {
    const dbData = trackScores[item.track.id];
    return {
      trackId: dbData?.trackId || null,    // UUID for voting
      spotifyId: item.track.id,            // Spotify ID for Web Playback SDK
      title: item.track.name,
      artist: item.track.artists.map(a => a.name).join(', '),
      albumArt: item.track.album.images[0]?.url,
      score: dbData?.score || 0,
      addedAt: dbData?.addedAt || new Date().toISOString(),
      duration: item.track.duration_ms,
      externalUrl: item.track.external_urls?.spotify,
      availableMarkets: item.track.available_markets?.length || 0,
      isLocal: item.track.is_local || false,
      isPlayable: item.track.is_playable !== false,
    };
  }).filter(track => track.trackId); // Only include tracks that exist in DB

  // 8) Handle sorting logic (existing logic + audio features)
  const sortMode = (req.query.sort || 'votes').toLowerCase();

  if (['tempo','energy','dance'].includes(sortMode)) {
    const features = await getAudioFeatures(tracks.map(t=>t.trackId), token);

    tracks.forEach(t => {
      const f = features[t.trackId];
      t.tempo        = f?.tempo;
      t.energy       = f?.energy;
      t.danceability = f?.danceability;
    });

    const key = sortMode === 'dance' ? 'danceability' : sortMode;
    tracks.sort((a,b) => (b[key] ?? 0) - (a[key] ?? 0));
  } else {
    // Sort by score (desc), then by added_at (asc)
    tracks.sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));
  }

  // 9) Include playable track count for frontend (now all tracks with Spotify IDs)
  const playableTracksCount = tracks.filter(t => t.spotifyId).length;

  res.json({ 
    room, 
    tracks,
    sort: sortMode,
    totalTracks: tracks.length,
    playableTracks: playableTracksCount,
  });
});

// Vote on a track - FIXED VERSION
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
    // FIXED: Use UPSERT instead of SELECT to handle first-time users
    console.log('🔍 Upserting user:', { spotify_id: user.id, display_name: user.display_name });
    
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
    console.log('✅ User ID resolved:', userId);

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

    console.log('🗳️ Processing vote:', { trackId, userId, vote });

    if (vote === 0) {
      // Remove existing vote
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
      // Upsert vote
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

// Test endpoint for debugging Spotify connection
router.get('/test-spotify/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const token = req.spotifyAccessToken;
  
  if (!token) {
    return res.status(401).json({ error: 'No Spotify token found' });
  }

  console.log(`🧪 Testing Spotify track: ${trackId}`);
  
  try {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      res.json({
        success: true,
        track: {
          id: data.id,
          name: data.name,
          artists: data.artists.map(a => a.name),
          album: data.album.name,
          duration_ms: data.duration_ms,
          available_markets: data.available_markets?.length || 0,
          is_playable: data.is_playable,
          external_urls: data.external_urls,
        },
        message: 'Track successfully fetched from Spotify'
      });
    } else {
      const errorText = await response.text();
      res.status(response.status).json({
        success: false,
        error: `Spotify API error: ${response.status}`,
        details: errorText
      });
    }
  } catch (error) {
    console.error('🚨 Spotify test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;