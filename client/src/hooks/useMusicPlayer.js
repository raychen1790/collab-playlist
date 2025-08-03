// client/src/hooks/useMusicPlayer.js - Fixed Version
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

export function useMusicPlayer(tracks, sortMode) {
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0); // Renamed for clarity
  const [shuffleMode, setShuffleMode] = useState(false);
  const [playQueue, setPlayQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);

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
    position: playerState?.position,
    duration: playerState?.duration,
    shuffleMode,
    currentTrackInQueue: playQueue[currentQueueIndex]
  });

  // All tracks are now "playable" since we don't rely on preview URLs
  const playableTracks = useMemo(() => {
    const filtered = tracks.filter(track => track.spotifyId);
    console.log('🎵 Playable tracks:', filtered.length, 'of', tracks.length);
    return filtered;
  }, [tracks]);

  // Current track object - Get the actual track from the queue
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
        // Return a track object based on Spotify data
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
    console.log('🔄 Using queue-based current track:', queueTrack?.title || 'None', 'at queue index:', currentQueueIndex, 'track index:', trackIndex);
    return queueTrack;
  }, [playableTracks, currentQueueIndex, spotifyCurrentTrack, playQueue]);

  // Initialize queues when playable tracks change
  const initializeQueue = useCallback(() => {
    if (playableTracks.length === 0) return;
    
    const indices = playableTracks.map((_, index) => index);
    setOriginalQueue([...indices]);
    setPlayQueue([...indices]);
    
    // Reset to first track if current index is out of bounds
    if (currentQueueIndex >= playableTracks.length) {
      setCurrentQueueIndex(0);
    }
    
    console.log('🔄 Queue initialized:', indices.length, 'tracks');
  }, [playableTracks, currentQueueIndex]);

  // Enhanced weighted shuffle function
  const createWeightedShuffle = useCallback(() => {
    if (playableTracks.length === 0) return [];

    const trackIndices = playableTracks.map((_, index) => index);
    const weights = playableTracks.map((track) => {
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
    const availableIndices = [...trackIndices];
    const availableWeights = [...weights];

    const highVoteTracks = availableIndices.filter(i => playableTracks[i].score > 3);
    if (highVoteTracks.length > 0 && Math.random() < 0.7) {
      const randomHighVote = highVoteTracks[Math.floor(Math.random() * highVoteTracks.length)];
      const indexInAvailable = availableIndices.indexOf(randomHighVote);
      shuffled.push(availableIndices[indexInAvailable]);
      availableIndices.splice(indexInAvailable, 1);
      availableWeights.splice(indexInAvailable, 1);
    }

    while (availableIndices.length > 0) {
      const totalWeight = availableWeights.reduce((sum, w) => sum + w, 0);
      let random = Math.random() * totalWeight;
      
      let selectedIndex = 0;
      for (let i = 0; i < availableWeights.length; i++) {
        random -= availableWeights[i];
        if (random <= 0) {
          selectedIndex = i;
          break;
        }
      }

      shuffled.push(availableIndices[selectedIndex]);
      availableIndices.splice(selectedIndex, 1);
      availableWeights.splice(selectedIndex, 1);
    }

    console.log('🔀 Created weighted shuffle:', shuffled);
    return shuffled;
  }, [playableTracks, sortMode]);

  // Play function - Fixed to work with queue indices
  const play = useCallback(async (trackIndex = null) => {
    if (playableTracks.length === 0 || !spotifyReady) {
      console.log('❌ Cannot play: no tracks or Spotify not ready');
      return false;
    }

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

    // Initialize queue if it's empty
    if (playQueue.length === 0) {
      initializeQueue();
    }

    // Play via Spotify Web Playback SDK
    const spotifyUri = `spotify:track:${targetTrack.spotifyId}`;
    const success = await playSpotifyTrack(spotifyUri);
    
    console.log('🎵 Playback result:', success ? 'SUCCESS' : 'FAILED');
    return success;
  }, [playableTracks, spotifyReady, currentQueueIndex, playQueue, initializeQueue, playSpotifyTrack, currentTrack, isPlaying, toggleSpotifyPlay]);

  // Pause function
  const pause = useCallback(async () => {
    if (spotifyReady) {
      console.log('⏸️ Pausing playback');
      await toggleSpotifyPlay();
    }
  }, [spotifyReady, toggleSpotifyPlay]);

  // Next track function - Fixed to properly advance queue
  const next = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0) return;

    console.log('⏭️ Next track - current queue index:', currentQueueIndex, 'queue length:', playQueue.length);
    
    let nextQueueIndex = currentQueueIndex + 1;
    
    // If we haven't reached the end of the queue
    if (nextQueueIndex < playQueue.length) {
      const nextTrackIndex = playQueue[nextQueueIndex];
      console.log('⏭️ Playing next track at queue index:', nextQueueIndex, 'track index:', nextTrackIndex);
      setCurrentQueueIndex(nextQueueIndex);
      await play(nextTrackIndex);
    } else {
      // End of queue - handle repeat behavior
      console.log('⏭️ End of queue reached');
      if (shuffleMode) {
        // Create a fresh shuffle and start over
        const newShuffledQueue = createWeightedShuffle();
        setPlayQueue(newShuffledQueue);
        setCurrentQueueIndex(0);
        await play(newShuffledQueue[0]);
      } else {
        // Loop back to beginning of original queue
        setCurrentQueueIndex(0);
        await play(originalQueue[0]);
      }
    }
  }, [playableTracks, currentQueueIndex, playQueue, play, shuffleMode, createWeightedShuffle, originalQueue]);

  // Previous track function - Fixed to properly go back in queue
  const previous = useCallback(async () => {
    if (playableTracks.length === 0 || playQueue.length === 0) return;

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
  }, [playableTracks, currentQueueIndex, playQueue, play]);

  // Toggle shuffle function - Fixed to create queue starting with current track
  const toggleShuffle = useCallback(() => {
    console.log('🔀 Toggling shuffle from', shuffleMode, 'to', !shuffleMode);
    
    // Get the currently playing track
    const currentTrackIndex = playQueue[currentQueueIndex];
    const currentPlayableTrack = playableTracks[currentTrackIndex];
    
    if (!shuffleMode) {
      // Turning shuffle ON
      if (currentPlayableTrack) {
        // Create a shuffled queue but ensure current track is first
        const shuffledQueue = createWeightedShuffle();
        
        // Remove current track from shuffled queue if it exists
        const filteredShuffled = shuffledQueue.filter(index => 
          playableTracks[index]?.trackId !== currentPlayableTrack.trackId
        );
        
        // Create new queue starting with current track, followed by shuffled remaining tracks
        const newQueue = [currentTrackIndex, ...filteredShuffled];
        
        setPlayQueue(newQueue);
        setCurrentQueueIndex(0); // Current track is now at position 0
        setShuffleMode(true);
        
        console.log('🔀 Shuffle enabled - queue starts with current track, length:', newQueue.length);
      } else {
        // No current track, just use regular shuffle
        const shuffledQueue = createWeightedShuffle();
        setPlayQueue(shuffledQueue);
        setCurrentQueueIndex(0);
        setShuffleMode(true);
        console.log('🔀 Shuffle enabled - no current track, starting fresh');
      }
    } else {
      // Turning shuffle OFF
      if (currentPlayableTrack) {
        // Find where current track should be in original order
        const originalIndex = originalQueue.findIndex(index => 
          playableTracks[index]?.trackId === currentPlayableTrack.trackId
        );
        
        if (originalIndex >= 0) {
          // Create queue starting from current track position in original order
          const beforeCurrent = originalQueue.slice(0, originalIndex);
          const fromCurrent = originalQueue.slice(originalIndex);
          const newQueue = [...fromCurrent, ...beforeCurrent];
          
          setPlayQueue(newQueue);
          setCurrentQueueIndex(0); // Current track is now at position 0
          setShuffleMode(false);
          
          console.log('🔀 Shuffle disabled - queue starts with current track at original position');
        } else {
          // Fallback to original queue
          setPlayQueue([...originalQueue]);
          setCurrentQueueIndex(0);
          setShuffleMode(false);
        }
      } else {
        // No current track, use original queue
        setPlayQueue([...originalQueue]);
        setCurrentQueueIndex(0);
        setShuffleMode(false);
        console.log('🔀 Shuffle disabled - restored original queue');
      }
    }
  }, [shuffleMode, createWeightedShuffle, originalQueue, playableTracks, playQueue, currentQueueIndex]);

  // Play all function
  const playAll = useCallback(async () => {
    if (playableTracks.length === 0) return;
    
    console.log('🎵 Play All - shuffle mode:', shuffleMode);
    initializeQueue();
    
    // Use the appropriate queue
    let queueToUse;
    if (shuffleMode) {
      queueToUse = createWeightedShuffle();
      setPlayQueue(queueToUse);
    } else {
      queueToUse = [...originalQueue];
    }
    
    const firstTrackIndex = queueToUse[0];
    console.log('🎵 Playing first track at index:', firstTrackIndex);
    setCurrentQueueIndex(0);
    await play(firstTrackIndex);
  }, [playableTracks, initializeQueue, play, shuffleMode, createWeightedShuffle, originalQueue]);

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

  // Initialize queue on mount
  useEffect(() => {
    initializeQueue();
  }, [initializeQueue]);

  // Handle automatic track advancement
  useEffect(() => {
    if (playerState && playerState.position === 0 && playerState.duration > 0 && !isPlaying) {
      console.log('🔄 Track ended, playing next');
      next();
    }
  }, [playerState, isPlaying, next]);

  // Update queue when shuffle mode changes - Remove this effect to prevent loops
  // The toggleShuffle function now handles queue updates directly

  return {
    // State
    isPlaying,
    currentTrack,
    currentTrackIndex: currentQueueIndex, // For backward compatibility
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