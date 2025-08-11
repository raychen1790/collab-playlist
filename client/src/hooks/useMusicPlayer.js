// client/src/hooks/useMusicPlayer.js
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);

  // Smooth, UI-facing progress (these drive the scrubber)
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Smoothing model: position = basePos + (isPlaying ? now - baseTime : 0)
  const smoothBasePosRef = useRef(0);
  const smoothBaseTimeRef = useRef(0);

  // Briefly pause RAF updates (one frame) during hard resets
  const suppressRafUntilRef = useRef(0);

  // Guards / heuristics
  const isChangingTracks = useRef(false);
  const lastProcessedTrack = useRef(null);
  const lastTrackEndAt = useRef(0);
  const prevSpotifyTrackId = useRef(null);

  // Ignore stale SDK positions right after a user action
  const userActionRef = useRef({
    pausedAt: 0,
    soughtAt: 0,
  });
  const ignoreSdkPositionUntilRef = useRef(0);

  const IGNORE_AFTER_USER_ACTION_MS = 1800; // for end-detection
  const IGNORE_SDK_AFTER_SEEK_MS   = 2200; // ignore stale SDK positions after seek
  const END_THROTTLE_MS            = 1200;

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
    activateAudio, // Safari/iOS activation
  } = useSpotifyWebPlayback();

  /* ----------------- derived lists ----------------- */
  const playableTracks = useMemo(() => tracks.filter(t => t.spotifyId), [tracks]);

  const currentTrack = useMemo(() => {
    if (spotifyCurrentTrack?.id) {
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
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

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

  /* ----------------- ensure ready & play ----------------- */
  const ensureReadyThenPlay = useCallback(async (targetTrackIndex) => {
    if (!spotifyReady) return false;
    try { if (activateAudio) await activateAudio(); } catch {}
    if (!spotifyActive) {
      await transferPlayback();
      await new Promise(r => setTimeout(r, 700));
    }

    // Hard reset scrubber to start for new song (no “descending”)
    suppressRafUntilRef.current = performance.now() + 100;
    setPositionMs(0);
    smoothBasePosRef.current = 0;
    smoothBaseTimeRef.current = performance.now();

    const track = playableTracks[targetTrackIndex];
    if (!track?.spotifyId) return false;
    const uri = `spotify:track:${track.spotifyId}`;
    const ok = await playSpotifyTrack(uri);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
    return await playSpotifyTrack(uri);
  }, [spotifyReady, spotifyActive, activateAudio, transferPlayback, playableTracks, playSpotifyTrack]);

  /* ----------------- transport ----------------- */
  const play = useCallback(async (trackIndex = null) => {
    if (!spotifyReady || !playableTracks.length || isChangingTracks.current) return false;
    isChangingTracks.current = true;
    try {
      if (trackIndex === null && currentTrack && !isPlaying) {
        await toggleSpotifyPlay();
        return true;
      }
      const target = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
      const ok = await ensureReadyThenPlay(target);
      return ok;
    } finally {
      setTimeout(() => { isChangingTracks.current = false; }, 500);
    }
  }, [spotifyReady, playableTracks.length, currentTrack, isPlaying, toggleSpotifyPlay, playQueue, currentQueueIndex, ensureReadyThenPlay]);

  const pause = useCallback(async () => {
    if (!spotifyReady || isChangingTracks.current) return;
    userActionRef.current.pausedAt = Date.now();
    await toggleSpotifyPlay();
  }, [spotifyReady, toggleSpotifyPlay]);

  const next = useCallback(async () => {
    if (!playableTracks.length || !playQueue.length || isChangingTracks.current) return;
    if (playQueue.length === 1) return; // don't appear to "restart" when only one track
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
    await ensureReadyThenPlay(first);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, ensureReadyThenPlay]);

  // Seek wrapper: jump UI instantly + ignore stale SDK for a short window
  const seek = useCallback(async (ms) => {
    userActionRef.current.soughtAt = Date.now();
    ignoreSdkPositionUntilRef.current = Date.now() + IGNORE_SDK_AFTER_SEEK_MS;

    // Instant UI jump
    setPositionMs(ms);
    smoothBasePosRef.current = ms;
    smoothBaseTimeRef.current = performance.now();

    await sdkSeek(ms);
  }, [sdkSeek]);

  /* ----------------- helpers for UI ----------------- */
  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack?.spotifyId) return -1;
    return playableTracks.findIndex(t => t.trackId === originalTrack.trackId);
  }, [tracks, playableTracks]);

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

  /* ----------------- progress sync & smoothing ----------------- */

  // Adopt SDK state as the authoritative base, but ignore stale positions
  useEffect(() => {
    if (!playerState) return;

    // Always accept duration
    const dur = playerState.duration || 0;
    if (dur !== durationMs) setDurationMs(dur);

    // Stale positions sometimes arrive a moment after a seek; ignore briefly
    const now = Date.now();
    if (now < ignoreSdkPositionUntilRef.current) return;

    const sdkPos = playerState.position || 0;

    // If SDK reports a big jump forward/back, adopt it as base
    const delta = Math.abs(sdkPos - positionMs);
    if (delta > 1200 || !isPlaying) {
      setPositionMs(sdkPos);
      smoothBasePosRef.current = sdkPos;
      smoothBaseTimeRef.current = performance.now();
    }
  }, [playerState?.position, playerState?.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // When play/pause toggles, keep the base aligned so RAF continues smoothly
  useEffect(() => {
    smoothBasePosRef.current = positionMs;
    smoothBaseTimeRef.current = performance.now();
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // RAF ticker: position = basePos + elapsed (while playing)
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const nowPerf = performance.now();
      if (nowPerf < suppressRafUntilRef.current) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (isPlaying && durationMs > 0) {
        const elapsed = nowPerf - smoothBaseTimeRef.current;
        const nextPos = Math.min(smoothBasePosRef.current + elapsed, durationMs);
        setPositionMs(nextPos);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, durationMs]);

  /* ----------------- end-of-track detection ----------------- */

  useEffect(() => {
    if (!durationMs) return;

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
      (isPlaying && nearEnd) ||
      (!isPlaying && durationMs > 10000 && remaining <= 250);

    if (shouldAdvance && !throttled && !alreadyHandled) {
      lastProcessedTrack.current = sid;
      lastTrackEndAt.current = Date.now();
      if (playQueue.length > 1) {
        setTimeout(() => { next(); }, 200);
      }
    }
  }, [isPlaying, durationMs, positionMs, spotifyCurrentTrack?.id, playQueue.length, next]);

  /* ----------------- keep queue index & UI reset on track change ----------------- */
  useEffect(() => {
    const sid = spotifyCurrentTrack?.id || null;
    if (!sid || sid === prevSpotifyTrackId.current) return;

    prevSpotifyTrackId.current = sid;

    // Hard reset scrubber to 0 immediately when a new track is reported
    suppressRafUntilRef.current = performance.now() + 100;
    setPositionMs(0);
    smoothBasePosRef.current = 0;
    smoothBaseTimeRef.current = performance.now();

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

    // Helpers
    isTrackCurrentlyPlaying,
    isTrackCurrent,

    // SDK actions
    setVolume,
    seek,
    transferPlayback,

    // Computed (smooth + instantaneous on seek/track change)
    position: positionMs,
    duration: durationMs,
    volume: playerState?.volume || 0.5,
  };
}
