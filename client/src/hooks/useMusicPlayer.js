// client/src/hooks/useMusicPlayer.js
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);

  // Smooth progress
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Guards
  const lastTrackEndTime = useRef(0);
  const isChangingTracks = useRef(false);
  const trackEndDetectionRef = useRef(null);
  const lastProcessedTrack = useRef(null);
  const prevSpotifyTrackId = useRef(null);

  // Ignore end-detection right after user actions
  const userActionRef = useRef({ pausedAt: 0, soughtAt: 0 });
  const IGNORE_AFTER_USER_ACTION_MS = 1500;

  const {
    isReady: spotifyReady,
    isActive: spotifyActive,
    playerState,
    error: spotifyError,
    playTrack: playSpotifyTrack,
    togglePlay: toggleSpotifyPlay,
    nextTrack: nextSpotifyTrack,
    previousTrack: previousSpotifyTrack,
    isPlaying,
    currentTrack: spotifyCurrentTrack,
    transferPlayback,
    setVolume,
    seek: sdkSeek,
    // exposed by the web playback hook for Safari/iOS
    activateAudio,
  } = useSpotifyWebPlayback();

  // ===== Debug =====
  // console.log('🎯 useMusicPlayer Debug:', {
  //   currentQueueIndex,
  //   playQueueLength: playQueue.length,
  //   tracksLength: tracks.length,
  //   spotifyCurrentTrack: spotifyCurrentTrack?.name,
  //   isPlaying,
  //   shuffleMode,
  //   currentTrackInQueue: playQueue[currentQueueIndex],
  //   positionMs,
  //   durationMs,
  //   isChangingTracks: isChangingTracks.current
  // });

  /* ----------------- derived lists ----------------- */
  const playableTracks = useMemo(() => {
    return tracks.filter(t => t.spotifyId);
  }, [tracks]);

  const currentTrack = useMemo(() => {
    // Prefer the SDK's notion of the current track when available
    if (spotifyCurrentTrack && spotifyCurrentTrack.id) {
      const matched = playableTracks.find(t => t.spotifyId === spotifyCurrentTrack.id);
      if (matched) return matched;
      // Fallback "synthetic" track for UI cohesion
      return {
        title: spotifyCurrentTrack.name,
        artist: spotifyCurrentTrack.artists?.map(a => a.name).join(', '),
        albumArt: spotifyCurrentTrack.album?.images?.[0]?.url,
        spotifyId: spotifyCurrentTrack.id,
        trackId: null,
        score: 0,
      };
    }
    // Otherwise fall back to our queue
    const idx = playQueue[currentQueueIndex];
    return idx !== undefined ? playableTracks[idx] : null;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

  /* ----------------- queue init ----------------- */
  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;

    const indices = playableTracks.map((_, i) => i);
    setOriginalQueue(indices);

    if (playQueue.length === 0) setPlayQueue(indices);

    if (currentQueueIndex >= indices.length) setCurrentQueueIndex(0);
  }, [playableTracks.length, playQueue.length, currentQueueIndex]);

  useEffect(() => {
    if (playableTracks.length > 0) initializeQueue();
  }, [playableTracks.length, initializeQueue]);

  /* ----------------- shuffle helper ----------------- */
  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
    if (playableTracks.length === 0) return [];

    const idxs = playableTracks.map((_, i) => i);
    const avail = excludeTrackIndex !== null ? idxs.filter(i => i !== excludeTrackIndex) : [...idxs];
    if (avail.length === 0) return excludeTrackIndex !== null ? [excludeTrackIndex] : [];

    const weights = avail.map((i) => {
      const t = playableTracks[i];
      let w = 1;

      // vote weight
      const normalizedVotes = Math.max(0, (t.score ?? 0) + 5);
      w *= Math.pow(normalizedVotes + 1, 1.2);

      // sort-mode nudges
      if (sortMode === 'tempo' && t.tempo != null) {
        w *= (t.tempo / 120) + 0.5;
      } else if (sortMode === 'energy' && t.energy != null) {
        w *= t.energy + 0.2;
      } else if (sortMode === 'dance' && t.danceability != null) {
        w *= t.danceability + 0.2;
      }

      return Math.max(0.1, w);
    });

    const shuffled = [];
    const workIdx = [...avail];
    const workW = [...weights];

    // Bias toward a highly upvoted track occasionally
    const highVote = workIdx.filter(i => (playableTracks[i].score ?? 0) > 3);
    if (highVote.length && Math.random() < 0.7) {
      const pick = highVote[Math.floor(Math.random() * highVote.length)];
      const j = workIdx.indexOf(pick);
      shuffled.push(workIdx[j]);
      workIdx.splice(j, 1);
      workW.splice(j, 1);
    }

    while (workIdx.length) {
      const total = workW.reduce((s, x) => s + x, 0);
      let r = Math.random() * total;
      let k = 0;
      for (let i = 0; i < workW.length; i++) {
        r -= workW[i];
        if (r <= 0) { k = i; break; }
      }
      shuffled.push(workIdx[k]);
      workIdx.splice(k, 1);
      workW.splice(k, 1);
    }

    return excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
  }, [playableTracks, sortMode]);

  /* ----------------- play / pause / transport ----------------- */

  // Helper: make sure audio is activated (Safari), transfer to our device if needed, then play
  const ensureReadyThenPlay = useCallback(async (targetTrackIndex) => {
    if (!spotifyReady) return false;

    try { if (typeof activateAudio === 'function') await activateAudio(); } catch {}

    // If device isn’t active yet, transfer and wait briefly
    if (!spotifyActive) {
      await transferPlayback();
      await new Promise(r => setTimeout(r, 800));
    }

    // Kick playback
    const track = playableTracks[targetTrackIndex];
    if (!track?.spotifyId) return false;

    const uri = `spotify:track:${track.spotifyId}`;
    const ok = await playSpotifyTrack(uri);
    if (ok) return true;

    // Retry once after a short wait (helps right after transfer)
    await new Promise(r => setTimeout(r, 600));
    return await playSpotifyTrack(uri);
  }, [spotifyReady, spotifyActive, activateAudio, transferPlayback, playableTracks, playSpotifyTrack]);

  const play = useCallback(async (trackIndex = null) => {
    if (!spotifyReady || playableTracks.length === 0 || isChangingTracks.current) return false;

    isChangingTracks.current = true;
    try {
      // Resume if we already have a track selected
      if (trackIndex === null && currentTrack && !isPlaying) {
        await toggleSpotifyPlay();
        return true;
      }

      const targetTrackIndex =
        trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];

      const ok = await ensureReadyThenPlay(targetTrackIndex);
      return ok;
    } finally {
      setTimeout(() => { isChangingTracks.current = false; }, 600);
    }
  }, [spotifyReady, playableTracks.length, currentTrack, isPlaying, toggleSpotifyPlay, playQueue, currentQueueIndex, ensureReadyThenPlay]);

  const pause = useCallback(async () => {
    if (!spotifyReady || isChangingTracks.current) return;
    userActionRef.current.pausedAt = Date.now();
    await toggleSpotifyPlay();
  }, [spotifyReady, toggleSpotifyPlay]);

  const next = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0 || isChangingTracks.current) return;
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
    if (playableTracks.length === 0 || playQueue.length === 0 || isChangingTracks.current) return;
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
      const shuffled = createWeightedShuffle(curIdx);
      setPlayQueue(shuffled);
      setCurrentQueueIndex(0);
      setShuffleMode(true);
    } else {
      const curIdx = playQueue[currentQueueIndex];
      const originalIndex = originalQueue.indexOf(curIdx);

      if (originalIndex >= 0) {
        const reordered = [
          ...originalQueue.slice(originalIndex),
          ...originalQueue.slice(0, originalIndex),
        ];
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
    if (playableTracks.length === 0) return;

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
    await ensureReadyThenPlay(first);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, ensureReadyThenPlay]);

  // Wrap seek so we can suppress false "track end" after manual seeks
  const seek = useCallback(async (ms) => {
    userActionRef.current.soughtAt = Date.now();
    await sdkSeek(ms);
  }, [sdkSeek]);

  /* ----------------- helpers for UI ----------------- */
  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack?.spotifyId) return -1;
    return playableTracks.findIndex(t => t.trackId === originalTrack.trackId);
  }, [tracks, playableTracks]);

  const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex < 0) return;
    const qIdx = playQueue.findIndex(i => i === playableIndex);
    if (qIdx >= 0) setCurrentQueueIndex(qIdx);
    await play(playableIndex);
  }, [getPlayableTrackIndex, play, playQueue]);

  const playTrackFromQueue = useCallback(async (queueIndex) => {
    if (queueIndex < 0 || queueIndex >= playQueue.length) return;
    setCurrentQueueIndex(queueIndex);
    await play(playQueue[queueIndex]);
  }, [playQueue, play]);

  const isTrackCurrentlyPlaying = useCallback((originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex < 0) return false;
    const cur = playQueue[currentQueueIndex];
    return cur === playableIndex && isPlaying;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex, isPlaying]);

  const isTrackCurrent = useCallback((originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex < 0) return false;
    const cur = playQueue[currentQueueIndex];
    return cur === playableIndex;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex]);

  /* ----------------- progress sync & smoothing ----------------- */

  // Keep our local position/duration in sync with SDK state
  useEffect(() => {
    if (!playerState) return;
    setDurationMs(playerState.duration || 0);
    // Accept SDK position when it jumps significantly or on pause/resume
    setPositionMs(playerState.position || 0);
  }, [playerState?.position, playerState?.duration]);

  // Smoothly increment position while playing (between SDK updates)
  useEffect(() => {
    let rafId = 0;
    let last = 0;

    const tick = (ts) => {
      if (!last) last = ts;
      const dt = ts - last;
      last = ts;

      setPositionMs(prev => {
        if (!isPlaying || durationMs === 0) return prev;
        const next = Math.min(prev + dt, durationMs);
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    if (isPlaying && durationMs > 0) {
      rafId = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying, durationMs]);

  /* ----------------- track end detection (robust) ----------------- */

  // Only advance when the track is actually reaching its end while playing.
  // Ignore recent user pauses/seeks to prevent false positives.
  useEffect(() => {
    if (trackEndDetectionRef.current) {
      clearTimeout(trackEndDetectionRef.current);
    }
    if (!playerState || !durationMs) return;

    const position = positionMs;
    const remaining = durationMs - position;

    const recentlyPaused = Date.now() - userActionRef.current.pausedAt < IGNORE_AFTER_USER_ACTION_MS;
    const recentlySought = Date.now() - userActionRef.current.soughtAt < IGNORE_AFTER_USER_ACTION_MS;

    // Don't auto-advance on manual pause/seek
    if (recentlyPaused || recentlySought) return;

    // Only consider end-of-track when actually playing
    const nearEnd = durationMs > 10000 && remaining <= 1200; // >10s tracks, last ~1.2s

    // Also avoid double-triggering for the same track id
    const sid = spotifyCurrentTrack?.id || null;
    const sameAsLast = lastProcessedTrack.current === sid;

    if (isPlaying && nearEnd && sid && !sameAsLast) {
      trackEndDetectionRef.current = setTimeout(() => {
        lastTrackEndTime.current = Date.now();
        lastProcessedTrack.current = sid;
        next();
      }, 700);
    }

    return () => {
      if (trackEndDetectionRef.current) {
        clearTimeout(trackEndDetectionRef.current);
      }
    };
  }, [isPlaying, durationMs, positionMs, spotifyCurrentTrack?.id, next, playerState]);

  /* ----------------- keep queue index in sync with SDK ----------------- */

  useEffect(() => {
    const sid = spotifyCurrentTrack?.id || null;
    if (!sid || sid === prevSpotifyTrackId.current) return;

    prevSpotifyTrackId.current = sid;

    const idxInPlayable = playableTracks.findIndex(t => t.spotifyId === sid);
    if (idxInPlayable >= 0) {
      const qIdx = playQueue.findIndex(i => i === idxInPlayable);
      if (qIdx >= 0) setCurrentQueueIndex(qIdx);
    }
  }, [spotifyCurrentTrack?.id, playableTracks, playQueue]);

  /* ----------------- return API ----------------- */
  return {
    // State
    isPlaying,
    currentTrack,
    currentTrackIndex: currentQueueIndex,
    shuffleMode,
    playQueue,
    playableTracks,

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

    // Track state helpers
    isTrackCurrentlyPlaying,
    isTrackCurrent,

    // Spotify Web Playback SDK actions
    setVolume,
    seek,            // wrapped to mark user seek
    transferPlayback,

    // Computed values (smooth)
    position: positionMs,
    duration: durationMs,
    volume: playerState?.volume || 0.5,
  };
}
