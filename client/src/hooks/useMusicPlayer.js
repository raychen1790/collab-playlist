// client/src/hooks/useMusicPlayer.js - Fixed to prevent rate limiting
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  
  // Add refs to prevent excessive API calls
  const lastTrackEndTime = useRef(0);
  const isChangingTracks = useRef(false);
  const trackEndDetectionRef = useRef(null);

  // Use Spotify Web Playback SDK
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

  // Debug logging
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

  // All tracks with Spotify IDs are playable
  const playableTracks = useMemo(() => {
    const filtered = tracks.filter(track => track.spotifyId);
    console.log('🎵 Playable tracks:', filtered.length, 'of', tracks.length);
    return filtered;
  }, [tracks]);

  // Current track object
  const currentTrack = useMemo(() => {
    // If we have Spotify player state, try to match it with our tracks
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
    
    // Fallback to queue-based current track
    const trackIndex = playQueue[currentQueueIndex];
    const queueTrack = trackIndex !== undefined ? playableTracks[trackIndex] : null;
    console.log('🔄 Using queue-based current track:', queueTrack?.title || 'None');
    return queueTrack;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

  // Initialize queues when playable tracks change
  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;
    
    const indices = playableTracks.map((_, index) => index);
    setOriginalQueue([...indices]);
    
    // Only set play queue if it's empty (don't override existing shuffle)
    if (playQueue.length === 0) {
      setPlayQueue([...indices]);
    }
    
    // Reset to first track if current index is out of bounds
    if (currentQueueIndex >= playableTracks.length) {
      setCurrentQueueIndex(0);
    }
    
    console.log('🔄 Queue initialized:', indices.length, 'tracks');
  }, [playableTracks.length]); // Only depend on length to avoid recreating queue unnecessarily

  // Enhanced weighted shuffle function
  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
    if (playableTracks.length === 0) return [];

    const trackIndices = playableTracks.map((_, index) => index);
    
    // Remove the excluded track if specified
    const availableIndices = excludeTrackIndex !== null 
      ? trackIndices.filter(index => index !== excludeTrackIndex)
      : [...trackIndices];

    if (availableIndices.length === 0) return excludeTrackIndex !== null ? [excludeTrackIndex] : [];

    const weights = availableIndices.map((trackIndex) => {
      const track = playableTracks[trackIndex];
      let weight = 1;
      
      // Base weight on score (votes)
      const normalizedVotes = Math.max(0, track.score + 5);
      weight *= Math.pow(normalizedVotes + 1, 1.2);

      // Adjust weight based on sort mode
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

    // 70% chance to start with a highly voted track (if any exist)
    const highVoteTracks = workingIndices.filter(i => playableTracks[i].score > 3);
    if (highVoteTracks.length > 0 && Math.random() < 0.7) {
      const randomHighVote = highVoteTracks[Math.floor(Math.random() * highVoteTracks.length)];
      const indexInWorking = workingIndices.indexOf(randomHighVote);
      shuffled.push(workingIndices[indexInWorking]);
      workingIndices.splice(indexInWorking, 1);
      workingWeights.splice(indexInWorking, 1);
    }

    // Weighted random selection for remaining tracks
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

    // If we excluded a track, add it at the beginning
    const finalQueue = excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
    
    console.log('🔀 Created weighted shuffle:', finalQueue.length, 'tracks');
    return finalQueue;
  }, [playableTracks, sortMode]);

  // Play function with rate limiting protection
  const play = useCallback(async (trackIndex = null) => {
    if (playableTracks.length === 0 || !spotifyReady || isChangingTracks.current) {
      console.log('❌ Cannot play: no tracks, Spotify not ready, or already changing tracks');
      return false;
    }

    // Set flag to prevent multiple simultaneous calls
    isChangingTracks.current = true;

    try {
      // If no specific track index provided and we have a current track, just resume
      if (trackIndex === null && currentTrack && !isPlaying) {
        console.log('▶️ Resuming current track');
        await toggleSpotifyPlay();
        return true;
      }
    
      // If no track index provided, use current queue position
      let targetTrackIndex = trackIndex !== null ? trackIndex : playQueue[currentQueueIndex];
      const targetTrack = playableTracks[targetTrackIndex];
      
      if (!targetTrack) {
        console.log('❌ Cannot play: no target track at index', targetTrackIndex);
        return false;
      }

      console.log('▶️ Playing track:', targetTrack.title, 'at track index', targetTrackIndex);

      // Add delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));

      // Play via Spotify Web Playback SDK
      const spotifyUri = `spotify:track:${targetTrack.spotifyId}`;
      const success = await playSpotifyTrack(spotifyUri);
      
      console.log('🎵 Playback result:', success ? 'SUCCESS' : 'FAILED');
      return success;
      
    } finally {
      // Always clear the flag
      setTimeout(() => {
        isChangingTracks.current = false;
      }, 500);
    }
  }, [playableTracks, spotifyReady, currentQueueIndex, playQueue, playSpotifyTrack, currentTrack, isPlaying, toggleSpotifyPlay]);

  // Pause function
  const pause = useCallback(async () => {
    if (spotifyReady && !isChangingTracks.current) {
      console.log('⏸️ Pausing playback');
      await toggleSpotifyPlay();
    }
  }, [spotifyReady, toggleSpotifyPlay]);

  // Fixed next function with rate limiting protection
  const next = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0 || isChangingTracks.current) {
      console.log('❌ Cannot go to next: no tracks, empty queue, or already changing');
      return;
    }

    console.log('⏭️ Next track - current queue index:', currentQueueIndex, 'queue length:', playQueue.length);
    
    let nextQueueIndex = currentQueueIndex + 1;
    
    // If we haven't reached the end of the queue
    if (nextQueueIndex < playQueue.length) {
      const nextTrackIndex = playQueue[nextQueueIndex];
      console.log('⏭️ Playing next track at queue index:', nextQueueIndex, 'track index:', nextTrackIndex);
      setCurrentQueueIndex(nextQueueIndex);
      await play(nextTrackIndex);
    } else {
      // End of queue - loop back to beginning
      console.log('⏭️ End of queue reached, looping back to start');
      setCurrentQueueIndex(0);
      await play(playQueue[0]);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  // Fixed previous function
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
      // Wrap to end of queue
      const lastQueueIndex = playQueue.length - 1;
      const lastTrackIndex = playQueue[lastQueueIndex];
      console.log('⏮️ Wrapping to last track at queue index:', lastQueueIndex, 'track index:', lastTrackIndex);
      setCurrentQueueIndex(lastQueueIndex);
      await play(lastTrackIndex);
    }
  }, [playableTracks.length, playQueue, currentQueueIndex, play]);

  // Fixed toggle shuffle function
  const toggleShuffle = useCallback(() => {
    console.log('🔀 Toggling shuffle from', shuffleMode, 'to', !shuffleMode);
    
    if (!shuffleMode) {
      // Turning shuffle ON
      const currentTrackIndex = playQueue[currentQueueIndex];
      console.log('🔀 Current track index:', currentTrackIndex);
      
      // Create shuffled queue excluding current track
      const shuffledQueue = createWeightedShuffle(currentTrackIndex);
      
      setPlayQueue(shuffledQueue);
      setCurrentQueueIndex(0); // Current track is now at position 0
      setShuffleMode(true);
      
      console.log('🔀 Shuffle enabled - new queue length:', shuffledQueue.length);
    } else {
      // Turning shuffle OFF
      const currentTrackIndex = playQueue[currentQueueIndex];
      console.log('🔀 Current track when turning off shuffle:', currentTrackIndex);
      
      // Find current track in original order and create queue starting from there
      const originalIndex = originalQueue.indexOf(currentTrackIndex);
      
      if (originalIndex >= 0) {
        // Create queue starting from current track position in original order
        const reorderedQueue = [
          ...originalQueue.slice(originalIndex),
          ...originalQueue.slice(0, originalIndex)
        ];
        
        setPlayQueue(reorderedQueue);
        setCurrentQueueIndex(0); // Current track is now at position 0
      } else {
        // Fallback: use original queue as-is
        setPlayQueue([...originalQueue]);
        setCurrentQueueIndex(originalIndex >= 0 ? originalIndex : 0);
      }
      
      setShuffleMode(false);
      console.log('🔀 Shuffle disabled - restored sequential order');
    }
  }, [shuffleMode, createWeightedShuffle, originalQueue, playQueue, currentQueueIndex]);

  // Play all function
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
    await play(firstTrackIndex);
  }, [playableTracks.length, shuffleMode, createWeightedShuffle, originalQueue, play]);

  // Helper functions
  const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
    const originalTrack = tracks[originalTrackIndex];
    if (!originalTrack?.spotifyId) return -1;
    
    return playableTracks.findIndex(track => track.trackId === originalTrack.trackId);
  }, [tracks, playableTracks]);

  const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
    const playableIndex = getPlayableTrackIndex(originalTrackIndex);
    if (playableIndex >= 0) {
      // Find this track in the current queue
      const queueIndex = playQueue.findIndex(index => index === playableIndex);
      if (queueIndex >= 0) {
        setCurrentQueueIndex(queueIndex);
        await play(playableIndex);
      } else {
        // Track not in current queue, just play it directly
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

  // Initialize queue on mount and when tracks change
  useEffect(() => {
    if (playableTracks.length > 0) {
      initializeQueue();
    }
  }, [playableTracks.length]); // Only re-run if the number of tracks changes

  // FIXED: Better track end detection with debouncing
  useEffect(() => {
    // Clear previous timeout
    if (trackEndDetectionRef.current) {
      clearTimeout(trackEndDetectionRef.current);
    }

    // Only detect track end if we have valid player state
    if (!playerState || !playerState.duration || playerState.duration === 0) {
      return;
    }

    const position = playerState.position || 0;
    const duration = playerState.duration;
    const remainingTime = duration - position;
    
    // Only advance if:
    // 1. Track is very close to the end (within 2 seconds)
    // 2. Track is not currently playing (ended)
    // 3. We haven't advanced recently (prevent double-triggering)
    const isNearEnd = remainingTime < 2000; // 2 seconds from end
    const trackEnded = !isPlaying && position > 0 && duration > 30000; // Only for tracks longer than 30s
    const shouldAdvance = (isNearEnd && !isPlaying) || trackEnded;
    const timeSinceLastEnd = Date.now() - lastTrackEndTime.current;
    
    if (shouldAdvance && timeSinceLastEnd > 1000) { // 5 second cooldown
      console.log('🔄 Track end detected:', {
        position,
        duration,
        remainingTime,
        isPlaying,
        timeSinceLastEnd
      });
      
      // Debounce the track change
      trackEndDetectionRef.current = setTimeout(() => {
        lastTrackEndTime.current = Date.now();
        next();
      }, 1000); // 1 second delay
    }

    // Cleanup
    return () => {
      if (trackEndDetectionRef.current) {
        clearTimeout(trackEndDetectionRef.current);
      }
    };
  }, [playerState?.position, playerState?.duration, isPlaying, next]);

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