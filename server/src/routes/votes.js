import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { supabase } from '../utils/supabaseClient.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/rooms/:roomId/tracks/:trackId/vote
 * Body: { vote: 1 }   // +1, -1, or 0 (neutral/remove vote)
 */
router.post('/:roomId/tracks/:trackId/vote', async (req, res) => {
  const { roomId, trackId } = req.params;
  const { vote } = req.body;                // +1, -1, or 0
  if (![1, -1, 0].includes(vote))
    return res.status(400).json({ error: 'vote must be 1, -1, or 0' });

  const user = req.user;

  /* 1 get (or create) internal user id */
  const { data: rows, error: uErr } = await supabase
    .from('users')
    .upsert(
      { spotify_id: user.id, display_name: user.display_name },
      { onConflict: 'spotify_id', returning: 'representation' }
    )
    .select('id');
  if (uErr) return res.status(500).json({ error: uErr.message });
  const userId = rows[0].id;

  /* 2️ handle the vote */
  if (vote === 0) {
    // Remove the user's vote (neutral)
    const { error: deleteErr } = await supabase
      .from('votes')
      .delete()
      .eq('track_id', trackId)
      .eq('user_id', userId);
    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
  } else {
    // Upsert +1 or -1 vote
    const { error: vErr } = await supabase
      .from('votes')
      .upsert(
        { track_id: trackId, user_id: userId, vote },
        { onConflict: 'track_id,user_id' }
      );
    if (vErr) return res.status(500).json({ error: vErr.message });
  }

  /* 3️ get all tracks for this room */
  const { data: tracks, error: tErr } = await supabase
    .from('tracks')
    .select('id, spotify_track_id, added_at')
    .eq('room_id', roomId);

  if (tErr) return res.status(500).json({ error: tErr.message });

  /* 4️ get all votes for these tracks */
  const trackIds = tracks.map(t => t.id);
  const { data: votes, error: votesFetchErr } = await supabase
    .from('votes')
    .select('track_id, vote')
    .in('track_id', trackIds);

  if (votesFetchErr) return res.status(500).json({ error: votesFetchErr.message });

  /* 5️ calculate scores and format response */
  const result = tracks.map(track => {
    const trackVotes = votes?.filter(v => v.track_id === track.id) || [];
    const score = trackVotes.reduce((sum, v) => sum + v.vote, 0);
    
    return {
      trackId: track.id,
      spotifyId: track.spotify_track_id,
      score: score,
      addedAt: track.added_at,
    };
  }).sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));

  // For now, return just the voting result without full track metadata
  // The frontend will need to handle this differently
  return res.json({ 
    success: true,
    trackId: trackId,
    newScore: result.find(t => t.trackId === trackId)?.score || 0
  });
});

export default router;