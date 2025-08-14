// client/src/hooks/usePreviewMusicPlayer.js - Enhanced with Deezer Integration
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

// Deezer search utility with enhanced matching
const searchDeezerTrack = async (title, artist) => {
  try {
    // Clean up search terms for better matching
    const cleanTitle = title.replace(/[\(\)\[\]]/g, '').trim();
    const cleanArtist = artist.replace(/[\(\)\[\]]/g, '').trim();
    const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);
    
    const response = await fetch(`https://api.deezer.com/search?q=${query}&limit=5`, {
      signal: AbortSignal.timeout(8000)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        // Try to find the best match by comparing titles and artists
        const bestMatch = data.data.find(track => {
          const titleMatch = track.title.toLowerCase().includes(cleanTitle.toLowerCase()) ||
                            cleanTitle.toLowerCase().includes(track.title.toLowerCase());
          const artistMatch = track.artist?.name.toLowerCase().includes(cleanArtist.toLowerCase()) ||
                             cleanArtist.toLowerCase().includes(track.artist?.name.toLowerCase());
          return titleMatch && artistMatch;
        }) || data.data[0]; // Fallback to first result

        if (bestMatch && bestMatch.preview) {
          return {
            previewUrl: bestMatch.preview,
            deezerTitle: bestMatch.title,
            deezerArtist: bestMatch.artist?.name,
            duration: bestMatch.duration * 1000, // Convert to milliseconds
            albumArt: bestMatch.album?.cover_medium || bestMatch.album?.cover_small,
            deezerId: bestMatch.id
          };
        }
      }
    }
  } catch (error) {
    console.warn('Deezer search failed:', error.message);
  }
  return null;
};

export function usePreviewMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  
  // Preview mode state
  const [previewMode, setPreviewMode] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [previewVolume, setPreviewVolume] = useState(0.5);
  const [previewIsPlaying, setPreviewIsPlaying] = useState(false);
  const [previewLoadingTrack, setPreviewLoadingTrack] = useState(null);

  // Smooth, UI-facing progress (these drive the scrubber)
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Smoothing model: position = basePos + (isPlaying ? now - baseTime : 0)
  const smoothBasePosRef = useRef(0);
  const smoothBaseTimeRef = useRef(0);

  // Audio element for preview playback
  const audioRef = useRef(null);
  const updateIntervalRef = useRef(null);
  
  // Cache for Deezer track data
  const deezerCacheRef = useRef(new Map());
  
  // Track the last failed search to avoid retrying immediately
  const failedSearchesRef = useRef(new Set());

  // Guards / heuristics
  const isChangingTracks = useRef(false);
  const lastProcessedTrack = useRef(null);
  const lastTrackEndAt = useRef(0);
  const prevTrackId = useRef(null);

  const END_THROTTLE_MS = 1200;
  const IGNORE_AFTER_USER_ACTION_MS = 1800;

  // User action tracking for better end detection
  const userActionRef = useRef({
    pausedAt: 0,
    soughtAt: 0,
  });

  // Spotify Web Playback SDK
  const {
    isReady: spotifyReady,
    isActive: spotifyActive,
    playerState,
    error: spotifyError,
    playTrack: playSpotifyTrack,
    togglePlay: toggleSpotifyPlay,
    nextTrack: nextSpotifyTrack,
    previousTrack: previousSpotifyTrack,
    isPlaying: spotifyIsPlaying,
    currentTrack: spotifyCurrentTrack,
    transferPlayback,
    setVolume,
    seek: sdkSeek,
    activateAudio,
  } = useSpotifyWebPlayback();

  // Derived states - switch between Spotify and preview mode
  const isPlaying = previewMode ? previewIsPlaying : spotifyIsPlaying;
  const position = previewMode ? previewPosition : positionMs;
  const duration = previewMode ? 30000 : durationMs; // 30s for previews
  const volume = previewMode ? previewVolume : (playerState?.volume || 0.5);

  /* ----------------- derived lists with Deezer support ----------------- */
  const playableTracks = useMemo(() => {
    if (previewMode) {
      // In preview mode, we consider all tracks playable since we'll search Deezer
      return tracks.filter(t => t.title && t.artist);
    } else {
      return tracks.filter(t => t.spotifyId);
    }
  }, [tracks, previewMode]);

  const currentTrack = useMemo(() => {
    if (!previewMode && spotifyCurrentTrack?.id) {
      const matched = playableTracks.find(t => t.spotifyId === spotifyCurrentTrack.id);
      if (matched) return matched;
      return {
        title: spotifyCurrentTrack.name,
        artist: spotifyCurrentTrack.artists?.map(a => a.name).join(', '),
        albumArt: spotifyCurrentTrack.album?.images?.[0]?.url,
        spotifyId: spotifyCurrentTrack.id,
        trackId: null,
        score: 0,
      };
    }
    const idx = playQueue[currentQueueIndex];
    return idx !== undefined ? playableTracks[idx] : null;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue, previewMode]);

  /* ----------------- queue init ----------------- */
  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;
    const idxs = playableTracks.map((_, i) => i);
    setOriginalQueue(idxs);
    if (playQueue.length === 0) setPlayQueue(idxs);
    if (currentQueueIndex >= idxs.length) setCurrentQueueIndex(0);
  }, [playableTracks.length, playQueue.length, currentQueueIndex]);

  useEffect(() => {
    if (playableTracks.length > 0) initializeQueue();
  }, [playableTracks.length, initializeQueue]);

  /* ----------------- preview mode audio setup ----------------- */
  useEffect(() => {
    if (previewMode && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'metadata';
      audioRef.current.crossOrigin = 'anonymous';
      
      const audio = audioRef.current;
      
      audio.addEventListener('loadedmetadata', () => {
        console.log('Preview loaded, duration:', audio.duration);
        setDurationMs(30000); // Force 30s duration for previews
      });
      
      audio.addEventListener('timeupdate', () => {
        setPreviewPosition(audio.currentTime * 1000);
      });
      
      audio.addEventListener('ended', () => {
        console.log('Preview ended, going to next track');
        setPreviewIsPlaying(false);
        if (playQueue.length > 1) {
          setTimeout(() => next(), 200);
        }
      });
      
      audio.addEventListener('error', (e) => {
        console.error('Preview audio error:', e);
        setPreviewIsPlaying(false);
        setPreviewLoadingTrack(null);
      });
      
      audio.addEventListener('play', () => {
        setPreviewIsPlaying(true);
        setPreviewLoadingTrack(null);
      });
      
      audio.addEventListener('pause', () => {
        setPreviewIsPlaying(false);
      });

      audio.addEventListener('loadstart', () => {
        console.log('Audio loading started');
      });

      audio.addEventListener('canplay', () => {
        console.log('Audio can start playing');
      });
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
      }
    };
  }, [previewMode]);

  /* ----------------- shuffle helper ----------------- */
  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
    if (playableTracks.length === 0) return [];
    const idxs = playableTracks.map((_, i) => i);
    const avail = excludeTrackIndex !== null ? idxs.filter(i => i !== excludeTrackIndex) : [...idxs];
    if (!avail.length) return excludeTrackIndex !== null ? [excludeTrackIndex] : [];

    const weights = avail.map(i => {
      const t = playableTracks[i];
      let w = 1;
      const normalizedVotes = Math.max(0, (t.score ?? 0) + 5);
      w *= Math.pow(normalizedVotes + 1, 1.2);
      if (sortMode === 'tempo' && t.tempo != null) w *= (t.tempo / 120) + 0.5;
      else if (sortMode === 'energy' && t.energy != null) w *= t.energy + 0.2;
      else if (sortMode === 'dance' && t.danceability != null) w *= t.danceability + 0.2;
      return Math.max(0.1, w);
    });

    const shuffled = [];
    const workIdx = [...avail];
    const workW = [...weights];

    const highVote = workIdx.filter(i => (playableTracks[i].score ?? 0) > 3);
    if (highVote.length && Math.random() < 0.7) {
      const pick = highVote[Math.floor(Math.random() * highVote.length)];
      const j = workIdx.indexOf(pick);
      shuffled.push(workIdx[j]);
      workIdx.splice(j, 1); workW.splice(j, 1);
    }

    while (workIdx.length) {
      const total = workW.reduce((s, x) => s + x, 0);
      let r = Math.random() * total, k = 0;
      for (let i = 0; i < workW.length; i++) { r -= workW[i]; if (r <= 0) { k = i; break; } }
      shuffled.push(workIdx[k]);
      workIdx.splice(k, 1); workW.splice(k, 1);
    }
    return excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
  }, [playableTracks, sortMode]);

  /* ----------------- Enhanced preview playback with Deezer ----------------- */
  const playPreviewTrack = useCallback(async (trackIndex) => {
    if (!audioRef.current || !playableTracks[trackIndex]) return false;
    
    const track = playableTracks[trackIndex];
    const cacheKey = `${track.title}-${track.artist}`.toLowerCase();
    
    // Prevent retry of recently failed searches
    if (failedSearchesRef.current.has(cacheKey)) {
      console.log('Skipping recently failed search for:', track.title);
      return false;
    }
    
    setPreviewLoadingTrack(track.trackId);
    isChangingTracks.current = true;
    
    try {
      // Stop current audio
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPreviewPosition(0);
      
      let previewUrl = null;
      let trackData = null;
      let source = 'unknown';

      // Check cache first
      if (deezerCacheRef.current.has(cacheKey)) {
        trackData = deezerCacheRef.current.get(cacheKey);
        previewUrl = trackData.previewUrl;
        source = 'cache';
        console.log('Using cached data for:', track.title);
      } else {
        // Try Spotify preview URL first (if available and working)
        if (track.previewUrl) {
          try {
            // Test if Spotify preview URL is accessible
            const testResponse = await fetch(track.previewUrl, { 
              method: 'HEAD',
              signal: AbortSignal.timeout(3000)
            });
            if (testResponse.ok) {
              previewUrl = track.previewUrl;
              source = 'spotify';
              console.log('Using Spotify preview for:', track.title);
            }
          } catch (e) {
            console.log('Spotify preview not accessible, trying Deezer...');
          }
        }
        
        // If no Spotify preview or it failed, search Deezer
        if (!previewUrl) {
          console.log('Searching Deezer for:', track.title, 'by', track.artist);
          trackData = await searchDeezerTrack(track.title, track.artist);
          
          if (trackData && trackData.previewUrl) {
            previewUrl = trackData.previewUrl;
            source = 'deezer';
            // Cache the Deezer result
            deezerCacheRef.current.set(cacheKey, trackData);
            console.log('Found Deezer preview for:', track.title);
          }
        }
      }
      
      if (!previewUrl) {
        console.log('No preview URL available for:', track.title);
        failedSearchesRef.current.add(cacheKey);
        // Clear failed search after 5 minutes
        setTimeout(() => {
          failedSearchesRef.current.delete(cacheKey);
        }, 5 * 60 * 1000);
        setPreviewLoadingTrack(null);
        return false;
      }
      
      const audio = audioRef.current;
      audio.src = previewUrl;
      audio.volume = previewVolume;
      
      // Wait for the audio to be ready
      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = (e) => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          console.error('Audio load error:', e);
          reject(e);
        };
        
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('error', onError);
        
        // Timeout after 15 seconds
        setTimeout(() => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          reject(new Error('Audio load timeout'));
        }, 15000);
      });
      
      // Play the track
      await audio.play();
      setPreviewIsPlaying(true);
      setPreviewLoadingTrack(null);
      
      console.log(`✅ Playing preview for: "${track.title}" from ${source}`);
      return true;
      
    } catch (error) {
      console.error('Failed to play preview:', error);
      setPreviewIsPlaying(false);
      setPreviewLoadingTrack(null);
      
      // If this was a cached URL that failed, remove it from cache
      if (deezerCacheRef.current.has(cacheKey)) {
        console.log('Removing failed preview from cache');
        deezerCacheRef.current.delete(cacheKey);
      }
      
      // Mark as failed to prevent immediate retries
      failedSearchesRef.current.add(cacheKey);
      setTimeout(() => {
        failedSearchesRef.current.delete(cacheKey);
      }, 2 * 60 * 1000); // Retry after 2 minutes
      
      return false;
    } finally {
      setTimeout(() => {
        isChangingTracks.current = false;
      }, 500);
    }
  }, [playableTracks, previewVolume]);

  const pausePreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPreviewIsPlaying(false);
      userActionRef.current.pausedAt = Date.now();
    }
  }, []);

  const resumePreview = useCallback(async () => {
    if (audioRef.current && !audioRef.current.ended) {
      try {
        await audioRef.current.play();
        setPreviewIsPlaying(true);
        return true;
      } catch (error) {
        console.error('Failed to resume preview:', error);
        return false;
      }
    }
    return false;
  }, []);

  /* ----------------- Spotify mode helpers ----------------- */
  const ensureSpotifyReady = useCallback(async (targetTrackIndex) => {
    if (!spotifyReady) return false;
    
    try { 
      if (activateAudio) await activateAudio(); 
    } catch {}
    
    if (!spotifyActive) {
      await transferPlayback();
      await new Promise(r => setTimeout(r, 700));
    }

    const track = playableTracks[targetTrackIndex];
    if (!track?.spotifyId) return false;
    
    const uri = `spotify:track:${track.spotifyId}`;
    const ok = await playSpotifyTrack(uri);
    if (ok) return true;
    
    // Retry once
    await new Promise(r => setTimeout(r, 500));
    return await playSpotifyTrack(uri);
  }, [spotifyReady, spotifyActive, activateAudio, transferPlayback, playableTracks, playSpotifyTrack]);

  /* ----------------- unified transport controls ----------------- */
  const play = useCallback(async (trackIndex = null) => {
    if (!playableTracks.length || isChangingTracks.current) return false;
    
    const targetIndex = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
    
    if (previewMode) {
      if (trackIndex === null && currentTrack && !isPlaying) {
        // Resume current track
        return await resumePreview();
      } else {
        // Play new track
        return await playPreviewTrack(targetIndex);
      }
    } else {
      // Spotify mode
      isChangingTracks.current = true;
      try {
        if (trackIndex === null && currentTrack && !isPlaying) {
          await toggleSpotifyPlay();
          return true;
        }
        return await ensureSpotifyReady(targetIndex);
      } finally {
        setTimeout(() => { isChangingTracks.current = false; }, 500);
      }
    }
  }, [playableTracks, playQueue, currentQueueIndex, previewMode, currentTrack, isPlaying, resumePreview, playPreviewTrack, toggleSpotifyPlay, ensureSpotifyReady]);

  const pause = useCallback(async () => {
    if (previewMode) {
      pausePreview();
    } else {
      if (!spotifyReady || isChangingTracks.current) return;
      userActionRef.current.pausedAt = Date.now();
      await toggleSpotifyPlay();
    }
  }, [previewMode, pausePreview, spotifyReady, toggleSpotifyPlay]);

  const next = useCallback(async () => {
    if (!playableTracks.length || !playQueue.length || isChangingTracks.current) return;
    if (playQueue.length === 1) return;
    
    const nextIdx = currentQueueIndex + 1;
    if (nextIdx < playQueue.length) {
      setCurrentQueueIndex(nextIdx);
      await play(playQueue[nextIdx]);
    } else {
      setCurrentQueueIndex(0);
      await play(playQueue[0]);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  const previous = useCallback(async () => {
    if (!playableTracks.length || !playQueue.length || isChangingTracks.current) return;
    
    const prevIdx = currentQueueIndex - 1;
    if (prevIdx >= 0) {
      setCurrentQueueIndex(prevIdx);
      await play(playQueue[prevIdx]);
    } else {
      const lastIdx = playQueue.length - 1;
      setCurrentQueueIndex(lastIdx);
      await play(playQueue[lastIdx]);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  const toggleShuffle = useCallback(() => {
    if (!shuffleMode) {
      const curIdx = playQueue[currentQueueIndex];
      setPlayQueue(createWeightedShuffle(curIdx));
      setCurrentQueueIndex(0);
      setShuffleMode(true);
    } else {
      const curIdx = playQueue[currentQueueIndex];
      const origIdx = originalQueue.indexOf(curIdx);
      if (origIdx >= 0) {
        const reordered = [...originalQueue.slice(origIdx), ...originalQueue.slice(0, origIdx)];
        setPlayQueue(reordered);
        setCurrentQueueIndex(0);
      } else {
        setPlayQueue([...originalQueue]);
        setCurrentQueueIndex(0);
      }
      setShuffleMode(false);
    }
  }, [shuffleMode, createWeightedShuffle, originalQueue, playQueue, currentQueueIndex]);

  const playAll = useCallback(async () => {
    if (!playableTracks.length) return;
    
    let q;
    if (shuffleMode) {
      q = createWeightedShuffle();
      setPlayQueue(q);
    } else {
      q = [...originalQueue];
      setPlayQueue(q);
    }
    const first = q[0];
    setCurrentQueueIndex(0);
    await play(first);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, play]);

  // Seek function - handles both preview and Spotify
  const seek = useCallback(async (ms) => {
    userActionRef.current.soughtAt = Date.now();
    
    if (previewMode && audioRef.current) {
      const seekTime = Math.max(0, Math.min(30, ms / 1000)); // Clamp to 30s
      audioRef.current.currentTime = seekTime;
      setPreviewPosition(ms);
    } else if (!previewMode) {
      setPositionMs(ms);
      smoothBasePosRef.current = ms;
      smoothBaseTimeRef.current = performance.now();
      await sdkSeek(ms);
    }
  }, [previewMode, sdkSeek]);

  // Volume control
  const handleVolumeChange = useCallback((newVolume) => {
    if (previewMode) {
      setPreviewVolume(newVolume);
      if (audioRef.current) {
        audioRef.current.volume = newVolume;
      }
    } else {
      setVolume(newVolume);
    }
  }, [previewMode, setVolume]);

  // Toggle between preview and full Spotify mode
  const togglePreviewMode = useCallback((enabled) => {
    // Pause current playback
    if (isPlaying) {
      if (previewMode) {
        pausePreview();
      } else {
        toggleSpotifyPlay();
      }
    }
    
    setPreviewMode(enabled);
    setPreviewPosition(0);
    setPositionMs(0);
    setPreviewLoadingTrack(null);
    
    // Re-initialize queue with new playable tracks
    setTimeout(() => {
      initializeQueue();
    }, 100);
  }, [isPlaying, previewMode, pausePreview, toggleSpotifyPlay, initializeQueue]);

  /* ----------------- helpers for UI ----------------- */
  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack) return -1;
    
    if (previewMode) {
      // In preview mode, check if track has title and artist (for Deezer search)
      if (!originalTrack.title || !originalTrack.artist) return -1;
    } else {
      // In Spotify mode, check for Spotify ID
      if (!originalTrack.spotifyId) return -1;
    }
    
    return playableTracks.findIndex(t => t.trackId === originalTrack.trackId);
  }, [tracks, playableTracks, previewMode]);

  const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
    const idx = getPlayableTrackIndex(originalTrackIndex);
    if (idx < 0) return;
    const qIdx = playQueue.findIndex(i => i === idx);
    if (qIdx >= 0) setCurrentQueueIndex(qIdx);
    await play(idx);
  }, [getPlayableTrackIndex, play, playQueue]);

  const playTrackFromQueue = useCallback(async (queueIndex) => {
    if (queueIndex < 0 || queueIndex >= playQueue.length) return;
    setCurrentQueueIndex(queueIndex);
    await play(playQueue[queueIndex]);
  }, [playQueue, play]);

  const isTrackCurrentlyPlaying = useCallback((originalTrackIndex) => {
    const idx = getPlayableTrackIndex(originalTrackIndex);
    if (idx < 0) return false;
    const cur = playQueue[currentQueueIndex];
    return cur === idx && isPlaying;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex, isPlaying]);

  const isTrackCurrent = useCallback((originalTrackIndex) => {
    const idx = getPlayableTrackIndex(originalTrackIndex);
    if (idx < 0) return false;
    const cur = playQueue[currentQueueIndex];
    return cur === idx;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex]);

  const isTrackLoading = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack || !previewMode) return false;
    return previewLoadingTrack === originalTrack.trackId;
  }, [tracks, previewMode, previewLoadingTrack]);

  /* ----------------- Spotify progress sync (when not in preview mode) ----------------- */
  useEffect(() => {
    if (previewMode || !playerState) return;

    const dur = playerState.duration || 0;
    if (dur !== durationMs) setDurationMs(dur);

    const sdkPos = playerState.position || 0;
    const delta = Math.abs(sdkPos - positionMs);
    if (delta > 1200 || !spotifyIsPlaying) {
      setPositionMs(sdkPos);
      smoothBasePosRef.current = sdkPos;
      smoothBaseTimeRef.current = performance.now();
    }
  }, [playerState, previewMode, durationMs, positionMs, spotifyIsPlaying]);

  // When play/pause toggles in Spotify mode, keep the base aligned
  useEffect(() => {
    if (!previewMode) {
      smoothBasePosRef.current = positionMs;
      smoothBaseTimeRef.current = performance.now();
    }
  }, [spotifyIsPlaying, previewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // RAF ticker for Spotify mode
  useEffect(() => {
    if (previewMode) return;
    
    let rafId = 0;
    const tick = () => {
      if (spotifyIsPlaying && durationMs > 0) {
        const elapsed = performance.now() - smoothBaseTimeRef.current;
        const nextPos = Math.min(smoothBasePosRef.current + elapsed, durationMs);
        setPositionMs(nextPos);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [spotifyIsPlaying, durationMs, previewMode]);

  /* ----------------- end-of-track detection for Spotify mode ----------------- */
  useEffect(() => {
    if (previewMode || !durationMs) return;

    const sid = spotifyCurrentTrack?.id || null;
    if (!sid) return;

    const remaining = durationMs - positionMs;
    const nearEnd = durationMs > 10000 && remaining <= 900;

    const justPaused = Date.now() - userActionRef.current.pausedAt < IGNORE_AFTER_USER_ACTION_MS;
    const justSought = Date.now() - userActionRef.current.soughtAt < IGNORE_AFTER_USER_ACTION_MS;
    if (justPaused || justSought) return;

    const throttled = Date.now() - lastTrackEndAt.current < END_THROTTLE_MS;
    const alreadyHandled = lastProcessedTrack.current === sid;

    const shouldAdvance =
      (spotifyIsPlaying && nearEnd) ||
      (!spotifyIsPlaying && durationMs > 10000 && remaining <= 250);

    if (shouldAdvance && !throttled && !alreadyHandled) {
      lastProcessedTrack.current = sid;
      lastTrackEndAt.current = Date.now();
      if (playQueue.length > 1) {
        setTimeout(() => { next(); }, 200);
      }
    }
  }, [spotifyIsPlaying, durationMs, positionMs, spotifyCurrentTrack?.id, playQueue.length, next, previewMode]);

  /* ----------------- track change detection for Spotify mode ----------------- */
  useEffect(() => {
    if (previewMode) return;
    
    const sid = spotifyCurrentTrack?.id || null;
    if (!sid || sid === prevTrackId.current) return;

    prevTrackId.current = sid;

    // Reset progress when track changes in Spotify mode
    setPositionMs(0);
    smoothBasePosRef.current = 0;
    smoothBaseTimeRef.current = performance.now();

    const idxInPlayable = playableTracks.findIndex(t => t.spotifyId === sid);
    if (idxInPlayable >= 0) {
      const qIdx = playQueue.findIndex(i => i === idxInPlayable);
      if (qIdx >= 0) setCurrentQueueIndex(qIdx);
    }
  }, [spotifyCurrentTrack?.id, playableTracks, playQueue, previewMode]);

  /* ----------------- return API ----------------- */
  return {
    // State
    isPlaying,
    currentTrack,
    currentTrackIndex: currentQueueIndex,
    shuffleMode,
    playQueue,
    playableTracks,

    // Mode state
    previewMode,
    previewUrl: currentTrack?.previewUrl || null,
    isLoadingPreview: !!previewLoadingTrack,

    // Spotify Web Playback SDK state
    spotifyReady,
    spotifyActive,
    spotifyError,
    playerState,

    // Actions
    play,
    pause,
    next,
    previous,
    toggleShuffle,
    playAll,
    playTrackByOriginalIndex,
    playTrackFromQueue,
    getPlayableTrackIndex,

    // Mode switching
    togglePreviewMode,

    // Helpers
    isTrackCurrentlyPlaying,
    isTrackCurrent,
    isTrackLoading,

    // Controls
    seek,
    setVolume: handleVolumeChange,
    transferPlayback,

    // Computed
    position,
    duration,
    volume,

    // Cache stats for debugging
    deezerCacheSize: deezerCacheRef.current.size,
  };
}