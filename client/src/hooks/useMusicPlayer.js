// client/src/hooks/useMusicPlayer.js
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);

  const lastTrackEndTime = useRef(0);
  const isChangingTracks = useRef(false);
  const trackEndDetectionRef = useRef(null);
  const lastProcessedTrack = useRef(null);

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
    seek,
    activateAudio, // exposed for UI
  } = useSpotifyWebPlayback();

  console.log('🎯 useMusicPlayer Debug:', {
    currentQueueIndex,
    playQueueLength: playQueue.length,
    tracksLength: tracks.length,
    spotifyCurrentTrack: spotifyCurrentTrack?.name,
    isPlaying,
    shuffleMode,
    currentTrackInQueue: playQueue[currentQueueIndex],
    position: playerState?.position,
    duration: playerState?.duration,
    isChangingTracks: isChangingTracks.current
  });

  const playableTracks = useMemo(() => {
    const filtered = tracks.filter(track => track.spotifyId);
    return filtered;
  }, [tracks]);

  const currentTrack = useMemo(() => {
    if (spotifyCurrentTrack && spotifyCurrentTrack.id) {
      const matchedTrack = playableTracks.find(t => t.spotifyId === spotifyCurrentTrack.id);
      if (matchedTrack) return matchedTrack;
      return {
        title: spotifyCurrentTrack.name,
        artist: spotifyCurrentTrack.artists.map(a => a.name).join(', '),
        albumArt: spotifyCurrentTrack.album.images[0]?.url,
        spotifyId: spotifyCurrentTrack.id,
        trackId: null,
        score: 0
      };
    }
    const trackIndex = playQueue[currentQueueIndex];
    return trackIndex !== undefined ? playableTracks[trackIndex] : null;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;
    const indices = playableTracks.map((_, i) => i);
    setOriginalQueue([...indices]);
    if (playQueue.length === 0) setPlayQueue([...indices]);
    if (currentQueueIndex >= playableTracks.length) setCurrentQueueIndex(0);
  }, [playableTracks.length]);

  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
    if (playableTracks.length === 0) return [];
    const trackIndices = playableTracks.map((_, i) => i);
    const available = excludeTrackIndex !== null
      ? trackIndices.filter(i => i !== excludeTrackIndex)
      : [...trackIndices];
    if (available.length === 0) return excludeTrackIndex !== null ? [excludeTrackIndex] : [];

    const weights = available.map(idx => {
      const t = playableTracks[idx];
      let w = 1;
      const normalizedVotes = Math.max(0, t.score + 5);
      w *= Math.pow(normalizedVotes + 1, 1.2);
      if (sortMode === 'tempo' && t.tempo != null) w *= (t.tempo / 120) + 0.5;
      else if (sortMode === 'energy' && t.energy != null) w *= t.energy + 0.2;
      else if (sortMode === 'dance' && t.danceability != null) w *= t.danceability + 0.2;
      return Math.max(0.1, w);
    });

    const shuffled = [];
    const workingIdx = [...available];
    const workingW = [...weights];

    const highVote = workingIdx.filter(i => playableTracks[i].score > 3);
    if (highVote.length > 0 && Math.random() < 0.7) {
      const r = highVote[Math.floor(Math.random() * highVote.length)];
      const j = workingIdx.indexOf(r);
      shuffled.push(workingIdx[j]);
      workingIdx.splice(j, 1);
      workingW.splice(j, 1);
    }

    while (workingIdx.length) {
      const total = workingW.reduce((s, x) => s + x, 0);
      let r = Math.random() * total;
      let k = 0;
      for (let i = 0; i < workingW.length; i++) {
        r -= workingW[i];
        if (r <= 0) { k = i; break; }
      }
      shuffled.push(workingIdx[k]);
      workingIdx.splice(k, 1);
      workingW.splice(k, 1);
    }

    return excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
  }, [playableTracks, sortMode]);

  const play = useCallback(async (trackIndex = null) => {
    if (playableTracks.length === 0 || !spotifyReady || isChangingTracks.current) return false;
    isChangingTracks.current = true;
    try {
      if (trackIndex === null && currentTrack && !isPlaying) {
        await toggleSpotifyPlay();
        return true;
      }
      const targetTrackIndex = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
      const target = playableTracks[targetTrackIndex];
      if (!target) return false;
      if (!spotifyActive) {
        await transferPlayback();
        await new Promise(r => setTimeout(r, 1000));
      }
      await new Promise(r => setTimeout(r, 250));
      const uri = `spotify:track:${target.spotifyId}`;
      const ok = await playSpotifyTrack(uri);
      return ok;
    } finally {
      setTimeout(() => { isChangingTracks.current = false; }, 750);
    }
  }, [playableTracks, spotifyReady, spotifyActive, currentTrack, isPlaying, playQueue, currentQueueIndex, toggleSpotifyPlay, transferPlayback, playSpotifyTrack]);

  const pause = useCallback(async () => {
    if (spotifyReady && !isChangingTracks.current) await toggleSpotifyPlay();
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
      const currentIdx = playQueue[currentQueueIndex];
      const shuffled = createWeightedShuffle(currentIdx);
      setPlayQueue(shuffled);
      setCurrentQueueIndex(0);
      setShuffleMode(true);
    } else {
      const currentIdx = playQueue[currentQueueIndex];
      const originalIndex = originalQueue.indexOf(currentIdx);
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
    setCurrentQueueIndex(0);
    await play(q[0]);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, play]);

  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack?.spotifyId) return -1;
    return playableTracks.findIndex(t => t.trackId === originalTrack.trackId);
  }, [tracks, playableTracks]);

  const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
    const idx = getPlayableTrackIndex(originalTrackIndex);
    if (idx >= 0) {
      const qIdx = playQueue.findIndex(i => i === idx);
      if (qIdx >= 0) setCurrentQueueIndex(qIdx);
      await play(idx);
    }
  }, [getPlayableTrackIndex, play, playQueue]);

  const playTrackFromQueue = useCallback(async (queueIndex) => {
    if (queueIndex >= 0 && queueIndex < playQueue.length) {
      setCurrentQueueIndex(queueIndex);
      await play(playQueue[queueIndex]);
    }
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

  useEffect(() => {
    if (playableTracks.length > 0) initializeQueue();
  }, [playableTracks.length, initializeQueue]);

  // Track end detection
  useEffect(() => {
    if (trackEndDetectionRef.current) clearTimeout(trackEndDetectionRef.current);
    if (!playerState || !playerState.duration) return;

    const position = playerState.position || 0;
    const duration = playerState.duration;
    const remaining = duration - position;

    const nearEnd = remaining < 1000;
    const stopped = !isPlaying && position > 0;
    const sinceLast = Date.now() - lastTrackEndTime.current;
    const sid = spotifyCurrentTrack?.id;
    const isNew = lastProcessedTrack.current !== sid;

    if ((nearEnd || stopped) && sinceLast > 2000 && duration > 10000 && isNew) {
      trackEndDetectionRef.current = setTimeout(() => {
        lastTrackEndTime.current = Date.now();
        lastProcessedTrack.current = sid;
        next();
      }, 500);
    }

    return () => {
      if (trackEndDetectionRef.current) clearTimeout(trackEndDetectionRef.current);
    };
  }, [playerState?.position, playerState?.duration, isPlaying, spotifyCurrentTrack?.id, next]);

  return {
    // State
    isPlaying,
    currentTrack,
    currentTrackIndex: currentQueueIndex,
    shuffleMode,
    playQueue,
    playableTracks,

    // Spotify state
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
    activateAudio,

    // Computed
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
    volume: playerState?.volume || 0.5,
  };
}
