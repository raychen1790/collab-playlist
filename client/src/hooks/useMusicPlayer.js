// client/src/hooks/useMusicPlayer.js - FIXED VERSION
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  
  // FIXED: Better rate limiting and track end detection
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
    console.log('🎵 Playable tracks:', filtered.length, 'of', tracks.length);
    return filtered;
  }, [tracks]);

  const currentTrack = useMemo(() => {
    if (spotifyCurrentTrack && spotifyCurrentTrack.id) {
      const matchedTrack = playableTracks.find(track => 
        track.spotifyId === spotifyCurrentTrack.id
      );
      if (matchedTrack) {
        console.log('✅ Matched Spotify track with our data:', matchedTrack.title);
        return matchedTrack;
      } else {
        console.log('⚠️ Spotify track not found in our data:', spotifyCurrentTrack.name);
        return {
          title: spotifyCurrentTrack.name,
          artist: spotifyCurrentTrack.artists.map(a => a.name).join(', '),
          albumArt: spotifyCurrentTrack.album.images[0]?.url,
          spotifyId: spotifyCurrentTrack.id,
          trackId: null,
          score: 0
        };
      }
    }
    
    const trackIndex = playQueue[currentQueueIndex];
    const queueTrack = trackIndex !== undefined ? playableTracks[trackIndex] : null;
    console.log('🔄 Using queue-based current track:', queueTrack?.title || 'None');
    return queueTrack;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;
    
    const indices = playableTracks.map((_, index) => index);
    setOriginalQueue([...indices]);
    
    if (playQueue.length === 0) {
      setPlayQueue([...indices]);
    }
    
    if (currentQueueIndex >= playableTracks.length) {
      setCurrentQueueIndex(0);
    }
    
    console.log('🔄 Queue initialized:', indices.length, 'tracks');
  }, [playableTracks.length]);

  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
    if (playableTracks.length === 0) return [];

    const trackIndices = playableTracks.map((_, index) => index);
    
    const availableIndices = excludeTrackIndex !== null 
      ? trackIndices.filter(index => index !== excludeTrackIndex)
      : [...trackIndices];

    if (availableIndices.length === 0) return excludeTrackIndex !== null ? [excludeTrackIndex] : [];

    const weights = availableIndices.map((trackIndex) => {
      const track = playableTracks[trackIndex];
      let weight = 1;
      
      const normalizedVotes = Math.max(0, track.score + 5);
      weight *= Math.pow(normalizedVotes + 1, 1.2);

      if (sortMode === 'tempo' && track.tempo != null) {
        weight *= (track.tempo / 120) + 0.5;
      } else if (sortMode === 'energy' && track.energy != null) {
        weight *= track.energy + 0.2;
      } else if (sortMode === 'dance' && track.danceability != null) {
        weight *= track.danceability + 0.2;
      }

      return Math.max(0.1, weight);
    });

    const shuffled = [];
    const workingIndices = [...availableIndices];
    const workingWeights = [...weights];

    const highVoteTracks = workingIndices.filter(i => playableTracks[i].score > 3);
    if (highVoteTracks.length > 0 && Math.random() < 0.7) {
      const randomHighVote = highVoteTracks[Math.floor(Math.random() * highVoteTracks.length)];
      const indexInWorking = workingIndices.indexOf(randomHighVote);
      shuffled.push(workingIndices[indexInWorking]);
      workingIndices.splice(indexInWorking, 1);
      workingWeights.splice(indexInWorking, 1);
    }

    while (workingIndices.length > 0) {
      const totalWeight = workingWeights.reduce((sum, w) => sum + w, 0);
      let random = Math.random() * totalWeight;
      
      let selectedIndex = 0;
      for (let i = 0; i < workingWeights.length; i++) {
        random -= workingWeights[i];
        if (random <= 0) {
          selectedIndex = i;
          break;
        }
      }

      shuffled.push(workingIndices[selectedIndex]);
      workingIndices.splice(selectedIndex, 1);
      workingWeights.splice(selectedIndex, 1);
    }

    const finalQueue = excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
    
    console.log('🔀 Created weighted shuffle:', finalQueue.length, 'tracks');
    return finalQueue;
  }, [playableTracks, sortMode]);

  // FIXED: Improved play function with better error handling
  const play = useCallback(async (trackIndex = null) => {
    if (playableTracks.length === 0 || !spotifyReady || isChangingTracks.current) {
      console.log('❌ Cannot play: no tracks, Spotify not ready, or already changing tracks');
      return false;
    }

    isChangingTracks.current = true;

    try {
      // If no specific track index and we have a current track, just resume
      if (trackIndex === null && currentTrack && !isPlaying) {
        console.log('▶️ Resuming current track');
        await toggleSpotifyPlay();
        return true;
      }
    
      let targetTrackIndex = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
      const targetTrack = playableTracks[targetTrackIndex];
      
      if (!targetTrack) {
        console.log('❌ Cannot play: no target track at index', targetTrackIndex);
        return false;
      }

      console.log('▶️ Playing track:', targetTrack.title, 'at track index', targetTrackIndex);

      // FIXED: Ensure device is active before playing
      if (!spotifyActive) {
        console.log('🔄 Device not active, transferring playback...');
        await transferPlayback();
        // Wait for activation
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting

      const spotifyUri = `spotify:track:${targetTrack.spotifyId}`;
      const success = await playSpotifyTrack(spotifyUri);
      
      console.log('🎵 Playback result:', success ? 'SUCCESS' : 'FAILED');
      return success;
      
    } finally {
      setTimeout(() => {
        isChangingTracks.current = false;
      }, 1000);
    }
  }, [playableTracks, spotifyReady, spotifyActive, currentQueueIndex, playQueue, playSpotifyTrack, currentTrack, isPlaying, toggleSpotifyPlay, transferPlayback]);

  const pause = useCallback(async () => {
    if (spotifyReady && !isChangingTracks.current) {
      console.log('⏸️ Pausing playback');
      await toggleSpotifyPlay();
    }
  }, [spotifyReady, toggleSpotifyPlay]);

  // FIXED: Better next function with proper queue management
  const next = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0 || isChangingTracks.current) {
      console.log('❌ Cannot go to next: no tracks, empty queue, or already changing');
      return;
    }

    console.log('⏭️ Next track - current queue index:', currentQueueIndex, 'queue length:', playQueue.length);
    
    let nextQueueIndex = currentQueueIndex + 1;
    
    if (nextQueueIndex < playQueue.length) {
      const nextTrackIndex = playQueue[nextQueueIndex];
      console.log('⏭️ Playing next track at queue index:', nextQueueIndex, 'track index:', nextTrackIndex);
      setCurrentQueueIndex(nextQueueIndex);
      await play(nextTrackIndex);
    } else {
      console.log('⏭️ End of queue reached, looping back to start');
      setCurrentQueueIndex(0);
      await play(playQueue[0]);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  const previous = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0 || isChangingTracks.current) {
      console.log('❌ Cannot go to previous: no tracks, empty queue, or already changing');
      return;
    }

    console.log('⏮️ Previous track - current queue index:', currentQueueIndex);

    let prevQueueIndex = currentQueueIndex - 1;
    
    if (prevQueueIndex >= 0) {
      const prevTrackIndex = playQueue[prevQueueIndex];
      console.log('⏮️ Playing previous track at queue index:', prevQueueIndex, 'track index:', prevTrackIndex);
      setCurrentQueueIndex(prevQueueIndex);
      await play(prevTrackIndex);
    } else {
      const lastQueueIndex = playQueue.length - 1;
      const lastTrackIndex = playQueue[lastQueueIndex];
      console.log('⏮️ Wrapping to last track at queue index:', lastQueueIndex, 'track index:', lastTrackIndex);
      setCurrentQueueIndex(lastQueueIndex);
      await play(lastTrackIndex);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  const toggleShuffle = useCallback(() => {
    console.log('🔀 Toggling shuffle from', shuffleMode, 'to', !shuffleMode);
    
    if (!shuffleMode) {
      const currentTrackIndex = playQueue[currentQueueIndex];
      console.log('🔀 Current track index:', currentTrackIndex);
      
      const shuffledQueue = createWeightedShuffle(currentTrackIndex);
      
      setPlayQueue(shuffledQueue);
      setCurrentQueueIndex(0);
      setShuffleMode(true);
      
      console.log('🔀 Shuffle enabled - new queue length:', shuffledQueue.length);
    } else {
      const currentTrackIndex = playQueue[currentQueueIndex];
      console.log('🔀 Current track when turning off shuffle:', currentTrackIndex);
      
      const originalIndex = originalQueue.indexOf(currentTrackIndex);
      
      if (originalIndex >= 0) {
        const reorderedQueue = [
          ...originalQueue.slice(originalIndex),
          ...originalQueue.slice(0, originalIndex)
        ];
        
        setPlayQueue(reorderedQueue);
        setCurrentQueueIndex(0);
      } else {
        setPlayQueue([...originalQueue]);
        setCurrentQueueIndex(originalIndex >= 0 ? originalIndex : 0);
      }
      
      setShuffleMode(false);
      console.log('🔀 Shuffle disabled - restored sequential order');
    }
  }, [shuffleMode, createWeightedShuffle, originalQueue, playQueue, currentQueueIndex]);

  // FIXED: Better playAll function
  const playAll = useCallback(async () => {
    if (playableTracks.length === 0) return;
    
    console.log('🎵 Play All - shuffle mode:', shuffleMode);
    
    let queueToUse;
    if (shuffleMode) {
      queueToUse = createWeightedShuffle();
      setPlayQueue(queueToUse);
    } else {
      queueToUse = [...originalQueue];
      setPlayQueue(queueToUse);
    }
    
    const firstTrackIndex = queueToUse[0];
    console.log('🎵 Playing first track at index:', firstTrackIndex);
    setCurrentQueueIndex(0);
    
    // FIXED: Actually start playing the first track
    await play(firstTrackIndex);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, play]);

  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack?.spotifyId) return -1;
    
    return playableTracks.findIndex(track => track.trackId === originalTrack.trackId);
  }, [tracks, playableTracks]);

  const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex >= 0) {
      const queueIndex = playQueue.findIndex(index => index === playableIndex);
      if (queueIndex >= 0) {
        setCurrentQueueIndex(queueIndex);
        await play(playableIndex);
      } else {
        await play(playableIndex);
      }
    }
  }, [getPlayableTrackIndex, play, playQueue]);

  const playTrackFromQueue = useCallback(async (queueIndex) => {
    if (queueIndex >= 0 && queueIndex < playQueue.length) {
      const trackIndex = playQueue[queueIndex];
      setCurrentQueueIndex(queueIndex);
      await play(trackIndex);
    }
  }, [playQueue, play]);

  const isTrackCurrentlyPlaying = useCallback((originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex < 0) return false;
    
    const currentTrackIndex = playQueue[currentQueueIndex];
    return currentTrackIndex === playableIndex && isPlaying;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex, isPlaying]);

  const isTrackCurrent = useCallback((originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex < 0) return false;
    
    const currentTrackIndex = playQueue[currentQueueIndex];
    return currentTrackIndex === playableIndex;
  }, [getPlayableTrackIndex, playQueue, currentQueueIndex]);

  useEffect(() => {
    if (playableTracks.length > 0) {
      initializeQueue();
    }
  }, [playableTracks.length]);

  // FIXED: Improved track end detection with better logic
  useEffect(() => {
    if (trackEndDetectionRef.current) {
      clearTimeout(trackEndDetectionRef.current);
    }

    if (!playerState || !playerState.duration || playerState.duration === 0) {
      return;
    }

    const position = playerState.position || 0;
    const duration = playerState.duration;
    const remainingTime = duration - position;
    
    // Track end detection logic:
    // 1. Track is very close to end (within 1 second)
    // 2. Track has actually stopped playing
    // 3. We haven't processed this track end recently
    const isVeryNearEnd = remainingTime < 1000;
    const trackHasStopped = !isPlaying && position > 0;
    const timeSinceLastEnd = Date.now() - lastTrackEndTime.current;
    const currentSpotifyId = spotifyCurrentTrack?.id;
    
    // Prevent duplicate processing of the same track
    const isDifferentTrack = lastProcessedTrack.current !== currentSpotifyId;
    
    if ((isVeryNearEnd || trackHasStopped) && 
        timeSinceLastEnd > 2000 && 
        duration > 10000 && // Only for tracks longer than 10s
        isDifferentTrack) {
      
      console.log('🔄 Track end detected:', {
        position,
        duration,
        remainingTime,
        isPlaying,
        timeSinceLastEnd,
        currentSpotifyId
      });
      
      trackEndDetectionRef.current = setTimeout(() => {
        lastTrackEndTime.current = Date.now();
        lastProcessedTrack.current = currentSpotifyId;
        next();
      }, 500);
    }

    return () => {
      if (trackEndDetectionRef.current) {
        clearTimeout(trackEndDetectionRef.current);
      }
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
    seek,
    transferPlayback,
    
    // Computed values
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
    volume: playerState?.volume || 0.5,
  };
}