// server/src/routes/deezer.js - Deezer API proxy routes
import express from 'express';

const router = express.Router();

// Deezer search proxy endpoint
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    
    if (!q) {
      return res.status(400).json({ 
        error: 'Query parameter required',
        example: '/api/deezer/search?q=artist+song+title&limit=5'
      });
    }
    
    console.log(`🎵 Deezer search: "${q}" (limit: ${limit})`);
    
    const response = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${Math.min(parseInt(limit), 25)}`,
      {
        headers: {
          'User-Agent': 'CollabPlaylist/1.0',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    
    if (!response.ok) {
      console.error(`❌ Deezer API error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: 'Deezer API error',
        status: response.status,
        statusText: response.statusText
      });
    }
    
    const data = await response.json();
    
    // Log results for debugging
    console.log(`✅ Deezer found ${data.data?.length || 0} results for "${q}"`);
    
    // Add some basic filtering and enhancement
    if (data.data && Array.isArray(data.data)) {
      data.data = data.data.map(track => ({
        id: track.id,
        title: track.title,
        artist: {
          id: track.artist?.id,
          name: track.artist?.name
        },
        album: {
          id: track.album?.id,
          title: track.album?.title,
          cover_small: track.album?.cover_small,
          cover_medium: track.album?.cover_medium,
          cover_big: track.album?.cover_big
        },
        duration: track.duration,
        preview: track.preview,
        explicit_lyrics: track.explicit_lyrics,
        rank: track.rank
      })).filter(track => track.preview); // Only return tracks with preview URLs
    }
    
    res.json(data);
    
  } catch (error) {
    console.error('❌ Deezer proxy error:', error);
    
    if (error.name === 'AbortError') {
      return res.status(408).json({ 
        error: 'Deezer API request timeout',
        message: 'The request to Deezer took too long'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to search Deezer',
      message: error.message
    });
  }
});

// Optional: Get specific track details
router.get('/track/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ 
        error: 'Valid track ID required'
      });
    }
    
    console.log(`🎵 Fetching Deezer track: ${id}`);
    
    const response = await fetch(
      `https://api.deezer.com/track/${id}`,
      {
        headers: {
          'User-Agent': 'CollabPlaylist/1.0',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000)
      }
    );
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Deezer track not found',
        status: response.status
      });
    }
    
    const track = await response.json();
    
    // Return only the fields we need
    res.json({
      id: track.id,
      title: track.title,
      artist: {
        id: track.artist?.id,
        name: track.artist?.name
      },
      album: {
        id: track.album?.id,
        title: track.album?.title,
        cover_small: track.album?.cover_small,
        cover_medium: track.album?.cover_medium,
        cover_big: track.album?.cover_big
      },
      duration: track.duration,
      preview: track.preview,
      explicit_lyrics: track.explicit_lyrics,
      rank: track.rank
    });
    
  } catch (error) {
    console.error('❌ Deezer track fetch error:', error);
    
    if (error.name === 'AbortError') {
      return res.status(408).json({ 
        error: 'Deezer API request timeout'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch Deezer track',
      message: error.message
    });
  }
});

export default router;