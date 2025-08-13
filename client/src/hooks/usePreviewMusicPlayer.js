// client/src/hooks/usePreviewMusicPlayer.js
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

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

  // Smooth, UI-facing progress (these drive the scrubber)
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Smoothing model: position = basePos + (isPlaying ? now - baseTime : 0)
  const smoothBasePosRef = useRef(0);
  const smoothBaseTimeRef = useRef(0);

  // Audio element for preview playback
  const audioRef = useRef(null);
  const updateIntervalRef = useRef(null);

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

  /* ----------------- derived lists ----------------- */
  const playableTracks = useMemo(() => {
    return tracks.filter(t => previewMode ? t.previewUrl : t.spotifyId);
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
        next();
      });
      
      audio.addEventListener('error', (e) => {
        console.error('Preview audio error:', e);
        setPreviewIsPlaying(false);
      });
      
      audio.addEventListener('play', () => {
        setPreviewIsPlaying(true);
      });
      
      audio.addEventListener('pause', () => {
        setPreviewIsPlaying(false);
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

  /* ----------------- preview playback functions ----------------- */
  const playPreviewTrack = useCallback(async (trackIndex) => {
    if (!audioRef.current || !playableTracks[trackIndex]) return false;
    
    const track = playableTracks[trackIndex];
    if (!track.previewUrl) {
      console.log('No preview URL available for track:', track.title);
      return false;
    }
    
    const audio = audioRef.current;
    
    try {
      // Stop current audio
      audio.pause();
      audio.currentTime = 0;
      
      // Load new track
      audio.src = track.previewUrl;
      audio.volume = previewVolume;
      
      // Reset position
      setPreviewPosition(0);
      
      // Play the track
      await audio.play();
      setPreviewIsPlaying(true);
      
      console.log('Playing preview for:', track.title);
      return true;
      
    } catch (error) {
      console.error('Failed to play preview:', error);
      setPreviewIsPlaying(false);
      return false;
    }
  }, [playableTracks, previewVolume]);

  const pausePreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPreviewIsPlaying(false);
    }
  }, []);

  const resumePreview = useCallback(() => {
    if (audioRef.current && !audioRef.current.ended) {
      audioRef.current.play().then(() => {
        setPreviewIsPlaying(true);
      }).catch(console.error);
    }
  }, []);

  /* ----------------- unified transport controls ----------------- */
  const play = useCallback(async (trackIndex = null) => {
    if (!playableTracks.length) return false;
    
    const targetIndex = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
    
    if (previewMode) {
      if (trackIndex === null && currentTrack && !isPlaying) {
        // Resume current track
        resumePreview();
        return true;
      } else {
        // Play new track
        return await playPreviewTrack(targetIndex);
      }
    } else {
      // Spotify mode - use existing logic
      if (!spotifyReady || !playableTracks.length) return false;
      
      try {
        if (activateAudio) await activateAudio();
      } catch {}
      
      if (!spotifyActive) {
        await transferPlayback();
        await new Promise(r => setTimeout(r, 700));
      }

      const track = playableTracks[targetIndex];
      if (!track?.spotifyId) return false;
      
      const uri = `spotify:track:${track.spotifyId}`;
      return await playSpotifyTrack(uri);
    }
  }, [playableTracks, playQueue, currentQueueIndex, previewMode, currentTrack, isPlaying, resumePreview, playPreviewTrack, spotifyReady, spotifyActive, activateAudio, transferPlayback, playSpotifyTrack]);

  const pause = useCallback(async () => {
    if (previewMode) {
      pausePreview();
    } else {
      if (!spotifyReady) return;
      await toggleSpotifyPlay();
    }
  }, [previewMode, pausePreview, spotifyReady, toggleSpotifyPlay]);

  const next = useCallback(async () => {
    if (!playableTracks.length || !playQueue.length) return;
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
    if (!playableTracks.length || !playQueue.length) return;
    
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
    
    // Re-initialize queue with new playable tracks
    setTimeout(() => {
      initializeQueue();
    }, 100);
  }, [isPlaying, previewMode, pausePreview, toggleSpotifyPlay, initializeQueue]);

  /* ----------------- helpers for UI ----------------- */
  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack) return -1;
    
    const requiredField = previewMode ? 'previewUrl' : 'spotifyId';
    if (!originalTrack[requiredField]) return -1;
    
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

    // Controls
    seek,
    setVolume: handleVolumeChange,
    transferPlayback,

    // Computed
    position,
    duration,
    volume,
  };
}