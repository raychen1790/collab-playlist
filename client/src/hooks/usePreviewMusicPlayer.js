// client/src/hooks/usePreviewMusicPlayer.js - Fixed Version with Reliable Deezer Integration
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSpotifyWebPlayback } from './useSpotifyWebPlayback.js';

const searchDeezerTrack = async (title, artist, apiRequest) => {
  try {
    const cleanTitle = title.replace(/[\(\)\[\]]/g, '').trim();
    const cleanArtist = artist.replace(/[\(\)\[\]]/g, '').trim();
    const query = `${cleanTitle} ${cleanArtist}`;
    
    console.log(`🎵 Searching backend proxy for: "${query}"`);
    const response = await apiRequest(`/api/deezer/search?q=${encodeURIComponent(query)}&limit=5`, {
      method: 'GET'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Backend returned ${data.data?.length || 0} results`);
      
      if (data.data && data.data.length > 0) {
        const bestMatch = data.data.find(track => {
          const titleMatch = track.title.toLowerCase().includes(cleanTitle.toLowerCase()) ||
                            cleanTitle.toLowerCase().includes(track.title.toLowerCase());
          const artistMatch = track.artist?.name.toLowerCase().includes(cleanArtist.toLowerCase()) ||
                             cleanArtist.toLowerCase().includes(track.artist?.name.toLowerCase());
          return titleMatch && artistMatch;
        }) || data.data[0];

        if (bestMatch && bestMatch.preview) {
          console.log(`🎯 Best match: "${bestMatch.title}" by ${bestMatch.artist?.name}`);
          return {
            previewUrl: bestMatch.preview,
            deezerTitle: bestMatch.title,
            deezerArtist: bestMatch.artist?.name,
            duration: bestMatch.duration * 1000,
            albumArt: bestMatch.album?.cover_medium || bestMatch.album?.cover_small,
            deezerId: bestMatch.id
          };
        }
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.error('Backend proxy error:', response.status, errorData);
    }
  } catch (error) {
    console.warn('Deezer search via backend failed:', error.message);
  }
  return null;
};

export function usePreviewMusicPlayer(tracks, sortMode, apiRequest) {
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
  const [previewCurrentTrackId, setPreviewCurrentTrackId] = useState(null);

  // Smooth, UI-facing progress
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const smoothBasePosRef = useRef(0);
  const smoothBaseTimeRef = useRef(0);

  // Audio element for preview playback
  const audioRef = useRef(null);
  const updateIntervalRef = useRef(null);
  
  // Cache for Deezer track data
  const deezerCacheRef = useRef(new Map());
  const failedSearchesRef = useRef(new Set());

  // Guards / heuristics
  const isChangingTracks = useRef(false);
  const lastProcessedTrack = useRef(null);
  const lastTrackEndAt = useRef(0);
  const prevTrackId = useRef(null);

  const END_THROTTLE_MS = 1200;
  const IGNORE_AFTER_USER_ACTION_MS = 1800;

  // User action tracking
  const userActionRef = useRef({
    pausedAt: 0,
    soughtAt: 0,
  });

  // 🔓 Audio unlock state & helper (ensures gesture-initiated playback works across browsers)
  const audioUnlockedRef = useRef(false);
  const SILENT_MP3 =
    "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  const ensureAudioUnlocked = useCallback(async () => {
    if (audioUnlockedRef.current || !audioRef.current) return true;
    const a = audioRef.current;
    try {
      a.src = SILENT_MP3;
      a.muted = true;
      const p = a.play();
      if (p?.then) await p.catch(() => {});
      a.pause();
      a.currentTime = 0;
      a.muted = false;
      a.src = "";
      audioUnlockedRef.current = true;
      return true;
    } catch (e) {
      console.warn("Audio unlock failed (will retry on next gesture)", e);
      return false;
    }
  }, []);

  // Preload helper for audio URLs
  const preloadAudioHref = useCallback((href) => {
    try {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'audio';
      link.href = href;
      document.head.appendChild(link);
      setTimeout(() => link.remove(), 15000);
    } catch {}
  }, []);

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

  // Derived states
  const isPlaying = previewMode ? previewIsPlaying : spotifyIsPlaying;
  const position = previewMode ? previewPosition : positionMs;
  const duration = previewMode ? 30000 : durationMs; // 30s for previews
  const volume = previewMode ? previewVolume : (playerState?.volume || 0.5);

  /* ----------------- derived lists with Deezer support ----------------- */
  const playableTracks = useMemo(() => {
    if (previewMode) {
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
  if (tracks.length === 0) return;
  
  // Create queue with ORIGINAL track indices (0, 1, 2, 3...)
  const originalIndices = tracks.map((_, i) => i);
  console.log(`🔧 Initializing queue with original indices:`, originalIndices);
  
  setOriginalQueue(originalIndices);
  if (playQueue.length === 0) {
    setPlayQueue(originalIndices);
  }
  if (currentQueueIndex >= originalIndices.length) {
    setCurrentQueueIndex(0);
  }
}, [tracks.length, playQueue.length, currentQueueIndex]);

  /* ----------------- preview mode audio setup with better event handling ----------------- */
  useEffect(() => {
    if (previewMode && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
      
      const audio = audioRef.current;
      
      audio.addEventListener('loadedmetadata', () => {
        console.log('Preview loaded, duration:', audio.duration);
      });
      
      audio.addEventListener('timeupdate', () => {
        if (previewMode) {
          setPreviewPosition(audio.currentTime * 1000);
        }
      });
      
      audio.addEventListener('ended', () => {
        console.log('Preview ended, going to next track');
        setPreviewIsPlaying(false);
        setPreviewPosition(0);
        if (playQueue.length > 1) {
          setTimeout(() => next(false), 200);
        }
      });
      
      audio.addEventListener('error', (e) => {
        console.error('Preview audio error:', e.target.error);
        setPreviewIsPlaying(false);
        setPreviewLoadingTrack(null);
        
        const currentTrackData = currentTrack;
        if (currentTrackData) {
          const cacheKey = `${currentTrackData.title}-${currentTrackData.artist}`.toLowerCase();
          failedSearchesRef.current.add(cacheKey);
          setTimeout(() => {
            failedSearchesRef.current.delete(cacheKey);
          }, 2 * 60 * 1000);
        }
      });
      
      audio.addEventListener('play', () => {
        console.log('Audio play event fired');
        setPreviewIsPlaying(true);
        setPreviewLoadingTrack(null);
      });
      
      audio.addEventListener('pause', () => {
        console.log('Audio pause event fired');
        setPreviewIsPlaying(false);
      });

      audio.addEventListener('loadstart', () => {
        console.log('Audio loading started');
      });

      audio.addEventListener('canplay', () => {
        console.log('Audio can start playing');
      });

      audio.addEventListener('waiting', () => {
        console.log('Audio is waiting for data');
      });

      audio.addEventListener('playing', () => {
        console.log('Audio is playing');
      });
    }
    
    return () => {
      if (audioRef.current) {
        console.log('Cleaning up audio element');
        audioRef.current.pause();
        audioRef.current.src = '';
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
      }
    };
  }, [previewMode]);

  /* ----------------- preload next previews when in preview mode ----------------- */
  const preloadUpcomingTracks = useCallback(async () => {
    if (!playableTracks.length || !playQueue.length) return;
    
    const preloadCount = previewMode ? 5 : 3;
    const indices = [];
    
    for (let i = -1; i <= preloadCount; i++) {
      const idx = (currentQueueIndex + i + playQueue.length) % playQueue.length;
      if (idx !== currentQueueIndex) indices.push(idx);
    }
    
    console.log(`🔄 Preloading ${indices.length} tracks...`);
    
    const preloadPromises = indices.map(async (qIdx) => {
      const idx = playQueue[qIdx];
      const t = playableTracks[idx];
      if (!t?.title || !t?.artist) return;
      
      const key = `${t.title}-${t.artist}`.toLowerCase();
      if (deezerCacheRef.current.has(key) || failedSearchesRef.current.has(key)) {
        return;
      }

      try {
        const data = await searchDeezerTrack(t.title, t.artist, apiRequest);
        if (data?.previewUrl) {
          deezerCacheRef.current.set(key, data);
          preloadAudioHref(data.previewUrl);
          console.log(`📦 Preloaded: ${t.title}`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to preload ${t.title}:`, error.message);
      }
    });
    
    Promise.allSettled(preloadPromises);
  }, [currentQueueIndex, playQueue, playableTracks, apiRequest, preloadAudioHref, previewMode]);

  useEffect(() => {
    preloadUpcomingTracks();
  }, [currentQueueIndex, playQueue.length, previewMode]);

  /* ----------------- shuffle helper ----------------- */
  const createWeightedShuffle = useCallback((excludeTrackIndex = null) => {
  if (tracks.length === 0) return [];
  
  // Work with original track indices
  const originalIndices = tracks.map((_, i) => i);
  const availableIndices = excludeTrackIndex !== null 
    ? originalIndices.filter(i => i !== excludeTrackIndex) 
    : [...originalIndices];
  
  if (!availableIndices.length) {
    return excludeTrackIndex !== null ? [excludeTrackIndex] : [];
  }

  // Filter to only playable tracks for weighting
  const playableOriginalIndices = availableIndices.filter(originalIdx => {
    const track = tracks[originalIdx];
    return previewMode ? (track.title && track.artist) : track.spotifyId;
  });

  if (playableOriginalIndices.length === 0) {
    return excludeTrackIndex !== null ? [excludeTrackIndex] : [];
  }

  const weights = playableOriginalIndices.map(originalIdx => {
    const track = tracks[originalIdx];
    let w = 1;
    const normalizedVotes = Math.max(0, (track.score ?? 0) + 5);
    w *= Math.pow(normalizedVotes + 1, 1.2);
    if (sortMode === 'tempo' && track.tempo != null) w *= (track.tempo / 120) + 0.5;
    else if (sortMode === 'energy' && track.energy != null) w *= track.energy + 0.2;
    else if (sortMode === 'dance' && track.danceability != null) w *= track.danceability + 0.2;
    return Math.max(0.1, w);
  });

  const shuffled = [];
  const workIdx = [...playableOriginalIndices];
  const workW = [...weights];

  // Prioritize high-voted tracks
  const highVoteIndices = workIdx.filter(originalIdx => (tracks[originalIdx].score ?? 0) > 3);
  if (highVoteIndices.length && Math.random() < 0.7) {
    const pick = highVoteIndices[Math.floor(Math.random() * highVoteIndices.length)];
    const j = workIdx.indexOf(pick);
    shuffled.push(workIdx[j]);
    workIdx.splice(j, 1); workW.splice(j, 1);
  }

  // Weighted shuffle of remaining tracks
  while (workIdx.length) {
    const total = workW.reduce((s, x) => s + x, 0);
    let r = Math.random() * total, k = 0;
    for (let i = 0; i < workW.length; i++) { 
      r -= workW[i]; 
      if (r <= 0) { k = i; break; } 
    }
    shuffled.push(workIdx[k]);
    workIdx.splice(k, 1); workW.splice(k, 1);
  }
  
  const result = excludeTrackIndex !== null ? [excludeTrackIndex, ...shuffled] : shuffled;
  console.log(`🔀 Shuffled queue (original indices):`, result.map(i => `${i}:${tracks[i]?.title}`));
  return result;
}, [tracks, sortMode, previewMode]);

  /* ----------------- Enhanced preview playback with immediate user-gesture play ----------------- */
const playPreviewTrack = useCallback(async (playableTrackIndex, { userInitiated = false } = {}) => {
  console.log(`🎯 playPreviewTrack called with playable index: ${playableTrackIndex}, userInitiated: ${userInitiated}`);
  
  if (!audioRef.current || !playableTracks[playableTrackIndex]) {
    console.error('❌ No audio element or invalid playable track index');
    return false;
  }
  
  const track = playableTracks[playableTrackIndex];
  console.log(`🎵 Playing preview for: "${track.title}" by ${track.artist} (playable index: ${playableTrackIndex})`);
  
  // Rest of the function remains the same...
  const cacheKey = `${track.title}-${track.artist}`.toLowerCase();
  
  if (failedSearchesRef.current.has(cacheKey)) {
    console.log('⏭️ Skipping recently failed search for:', track.title);
    return false;
  }
  
  setPreviewLoadingTrack(track.trackId);
  setPreviewCurrentTrackId(track.trackId);
  isChangingTracks.current = true;
  
  try {
    const audio = audioRef.current;
    audio.pause();
    audio.currentTime = 0;
    setPreviewPosition(0);
    setPreviewIsPlaying(false);
    
    let previewUrl = null;
    let trackData = null;
    let source = 'unknown';

    // Cache first
    if (deezerCacheRef.current.has(cacheKey)) {
      trackData = deezerCacheRef.current.get(cacheKey);
      previewUrl = trackData.previewUrl;
      source = 'cache';
      console.log('📦 Using cached data for:', track.title);
    } else {
      // Try Spotify preview URL first
      if (track.previewUrl) {
        try {
          console.log('🎧 Testing Spotify preview URL...');
          const testResponse = await fetch(track.previewUrl, { 
            method: 'HEAD',
            signal: AbortSignal.timeout(3000)
          });
          if (testResponse.ok) {
            previewUrl = track.previewUrl;
            source = 'spotify';
            console.log('✅ Using Spotify preview for:', track.title);
          } else {
            console.log('❌ Spotify preview failed, status:', testResponse.status);
          }
        } catch (e) {
          console.log('❌ Spotify preview not accessible:', e.message);
        }
      }
      
      if (!previewUrl) {
        console.log('🔍 Searching Deezer for:', track.title, 'by', track.artist);
        trackData = await searchDeezerTrack(track.title, track.artist, apiRequest);
        
        if (trackData && trackData.previewUrl) {
          previewUrl = trackData.previewUrl;
          source = 'deezer';
          deezerCacheRef.current.set(cacheKey, trackData);
          console.log('✅ Found Deezer preview for:', track.title);
        }
      }
    }
    
    if (!previewUrl) {
      console.log('❌ No preview URL available for:', track.title);
      failedSearchesRef.current.add(cacheKey);
      setTimeout(() => {
        failedSearchesRef.current.delete(cacheKey);
      }, 5 * 60 * 1000);
      setPreviewLoadingTrack(null);
      return false;
    }
    
    console.log(`🎯 Loading preview URL: ${previewUrl.substring(0, 80)}...`);
    
    // Set up the audio source
    audio.src = previewUrl;
    audio.volume = previewVolume;
    audio.preload = 'auto';

    // Enhanced loading promise with better event handling
    const audioLoadPromise = new Promise((resolve, reject) => {
      let resolved = false;
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onCanPlayThrough);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('loadeddata', onLoadedData);
      };
      
      const onCanPlayThrough = () => {
        if (resolved) return;
        resolved = true;
        console.log('✅ Audio can play through, resolving');
        cleanup(); 
        resolve('canplaythrough');
      };
      
      const onCanPlay = () => {
        if (resolved) return;
        resolved = true;
        console.log('✅ Audio can play, resolving');
        cleanup(); 
        resolve('canplay');
      };
      
      const onLoadedData = () => {
        if (resolved) return;
        resolved = true;
        console.log('✅ Audio loaded data, resolving');
        cleanup(); 
        resolve('loadeddata');
      };
      
      const onError = (e) => {
        if (resolved) return;
        resolved = true;
        console.error('❌ Audio load error:', e.target?.error || e);
        cleanup(); 
        reject(new Error(`Audio load failed: ${e.target?.error?.message || 'Unknown error'}`));
      };
      
      audio.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('loadeddata', onLoadedData, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
      
      // Timeout
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Audio load timeout'));
      }, 10000);
    });
    
    console.log('⏳ Waiting for audio to load...');
    await audioLoadPromise;
    
    // Check if track changed while loading
    if (previewCurrentTrackId !== track.trackId) {
      console.log('⏭️ Track changed while loading, skipping play');
      return false;
    }
    
    // FIXED: Always attempt to play when userInitiated is true
    if (userInitiated) {
      try {
        console.log('▶️ User initiated - starting playback...');
        await audio.play();
        setPreviewIsPlaying(true);
        console.log(`✅ Successfully playing preview for: "${track.title}" from ${source}`);
        return true;
      } catch (playError) {
        console.warn('⚠️ Auto-play failed (browser policy?):', playError.message);
        setPreviewIsPlaying(false);
        return true; // Still successful load
      }
    } else {
      console.log('✅ Audio ready, waiting for user action');
      setPreviewIsPlaying(false);
      return true;
    }
      
  } catch (error) {
    console.error('💥 Failed to play preview:', error.message);
    setPreviewIsPlaying(false);
    setPreviewLoadingTrack(null);
    
    if (deezerCacheRef.current.has(cacheKey)) {
      console.log('🗑️ Removing failed preview from cache');
      deezerCacheRef.current.delete(cacheKey);
    }
    
    failedSearchesRef.current.add(cacheKey);
    setTimeout(() => {
      failedSearchesRef.current.delete(cacheKey);
    }, 2 * 60 * 1000);
    
    return false;
  } finally {
    setTimeout(() => {
      isChangingTracks.current = false;
      setPreviewLoadingTrack(null);
    }, 300);
  }
}, [playableTracks, previewVolume, apiRequest, previewCurrentTrackId]);

  const pausePreview = useCallback(() => {
    if (audioRef.current) {
      console.log('⏸️ Pausing preview');
      audioRef.current.pause();
      setPreviewIsPlaying(false);
      userActionRef.current.pausedAt = Date.now();
    }
  }, []);

  const resumePreview = useCallback(async () => {
    if (!audioRef.current?.src || audioRef.current.ended) {
      console.log('❌ Cannot resume preview - no audio source or audio ended');
      return false;
    }
    
    try {
      console.log('▶️ Resuming preview');
      await audioRef.current.play();
      setPreviewIsPlaying(true);
      return true;
    } catch (error) {
      console.error('❌ Failed to resume preview:', error.message);
      setPreviewIsPlaying(false);
      return false;
    }
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
    
    await new Promise(r => setTimeout(r, 500));
    return await playSpotifyTrack(uri);
  }, [spotifyReady, spotifyActive, activateAudio, transferPlayback, playableTracks, playSpotifyTrack]);

  /* ----------------- unified transport controls (user-gesture aware) ----------------- */
const play = useCallback(async (originalTrackIndex = null, userInitiated = false) => {
  console.log(`🎯 play() called with originalTrackIndex: ${originalTrackIndex}, userInitiated: ${userInitiated}`);
  
  if (!tracks.length || isChangingTracks.current) {
    console.log('❌ Cannot play - no tracks or already changing');
    return false;
  }
  
  // Get the track to play
  let trackToPlay;
  if (originalTrackIndex !== null) {
    trackToPlay = tracks[originalTrackIndex];
  } else {
    // Use current queue position
    const currentOriginalIndex = playQueue[currentQueueIndex];
    trackToPlay = tracks[currentOriginalIndex];
    originalTrackIndex = currentOriginalIndex;
  }
  
  if (!trackToPlay) {
    console.log('❌ No track to play');
    return false;
  }
  
  console.log(`🎵 Playing: "${trackToPlay.title}" by ${trackToPlay.artist} (original index: ${originalTrackIndex})`);
  
  if (previewMode) {
    if (userInitiated) await ensureAudioUnlocked();
    
    // Check if we can resume current track
    if (originalTrackIndex === null && currentTrack && !previewIsPlaying && audioRef.current?.src) {
      if (currentTrack.trackId === previewCurrentTrackId) {
        console.log('⏯️ Resuming current preview track');
        return await resumePreview();
      }
    }
    
    // Check if track is playable in preview mode
    if (!trackToPlay.title || !trackToPlay.artist) {
      console.log('❌ Track missing title/artist for preview');
      return false;
    }
    
    // Convert to playable track index for the preview function
    const playableTrackIndex = playableTracks.findIndex(pt => pt.trackId === trackToPlay.trackId);
    if (playableTrackIndex < 0) {
      console.log('❌ Track not found in playable tracks');
      return false;
    }
    
    console.log(`🎵 Converting to playable index ${playableTrackIndex} for preview playback`);
    const success = await playPreviewTrack(playableTrackIndex, { userInitiated });
    
    if (!success && userInitiated && playQueue.length > 1) {
      console.log('🔄 First track failed, trying next...');
      // Manually go to next track without calling next() to avoid circular dependency
      const nextQueueIdx = (currentQueueIndex + 1) % playQueue.length;
      const nextOriginalTrackIndex = playQueue[nextQueueIdx];
      setCurrentQueueIndex(nextQueueIdx);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Find playable index for next track
      const nextTrack = tracks[nextOriginalTrackIndex];
      const nextPlayableIndex = playableTracks.findIndex(pt => pt.trackId === nextTrack?.trackId);
      if (nextPlayableIndex >= 0) {
        return await playPreviewTrack(nextPlayableIndex, { userInitiated });
      }
    }
    
    return success;
  } else {
    // Spotify mode
    isChangingTracks.current = true;
    try {
      if (originalTrackIndex === null && currentTrack && !isPlaying) {
        await toggleSpotifyPlay();
        return true;
      }
      
      // For Spotify, we need the playable track index
      const playableTrackIndex = playableTracks.findIndex(pt => pt.trackId === trackToPlay.trackId);
      if (playableTrackIndex < 0) {
        console.log('❌ Track not found in playable tracks for Spotify');
        return false;
      }
      
      return await ensureSpotifyReady(playableTrackIndex);
    } finally {
      setTimeout(() => { isChangingTracks.current = false; }, 500);
    }
  }
}, [
  tracks,
  playQueue, 
  currentQueueIndex, 
  previewMode, 
  currentTrack, 
  previewIsPlaying,
  resumePreview, 
  playPreviewTrack, 
  toggleSpotifyPlay, 
  ensureSpotifyReady, 
  ensureAudioUnlocked,
  previewCurrentTrackId,
  isPlaying,
  playableTracks,
  next
]);

  // FIXED: Ensure queue index is properly updated before playing
// FIXED: next function
const next = useCallback(async (userInitiated = false) => {
  console.log('⏭️ next() called, userInitiated:', userInitiated);
  if (!tracks.length || !playQueue.length || isChangingTracks.current) {
    console.log('❌ Cannot go to next - no tracks or already changing');
    return;
  }
  
  const nextQueueIdx = (currentQueueIndex + 1) % playQueue.length;
  const nextOriginalTrackIndex = playQueue[nextQueueIdx];
  
  console.log(`⏭️ Moving from queue position ${currentQueueIndex} to ${nextQueueIdx}`);
  console.log(`⏭️ Next track: "${tracks[nextOriginalTrackIndex]?.title}"`);
  
  setCurrentQueueIndex(nextQueueIdx);
  await new Promise(resolve => setTimeout(resolve, 50));
  await play(nextOriginalTrackIndex, userInitiated);
}, [tracks, playQueue, currentQueueIndex, play]);


const previous = useCallback(async (userInitiated = false) => {
  console.log('⏮️ previous() called, userInitiated:', userInitiated);
  if (!tracks.length || !playQueue.length || isChangingTracks.current) {
    console.log('❌ Cannot go to previous - no tracks or already changing');
    return;
  }
  
  const prevQueueIdx = currentQueueIndex - 1;
  const targetQueueIdx = prevQueueIdx >= 0 ? prevQueueIdx : playQueue.length - 1;
  const targetOriginalTrackIndex = playQueue[targetQueueIdx];
  
  console.log(`⏮️ Moving from queue position ${currentQueueIndex} to ${targetQueueIdx}`);
  console.log(`⏮️ Previous track: "${tracks[targetOriginalTrackIndex]?.title}"`);
  
  setCurrentQueueIndex(targetQueueIdx);
  await new Promise(resolve => setTimeout(resolve, 50));
  await play(targetOriginalTrackIndex, userInitiated);
}, [tracks, playQueue, currentQueueIndex, play]);



const toggleShuffle = useCallback(() => {
  console.log('🔀 toggleShuffle() called');
  if (!shuffleMode) {
    // Get current track's original index
    const currentOriginalIndex = playQueue[currentQueueIndex];
    const shuffledQueue = createWeightedShuffle(currentOriginalIndex);
    setPlayQueue(shuffledQueue);
    setCurrentQueueIndex(0); // Current track is now at position 0
    setShuffleMode(true);
    console.log('🔀 Shuffle ON - current track moved to front');
  } else {
    // Get current track's original index
    const currentOriginalIndex = playQueue[currentQueueIndex];
    
    // Find where current track should be in original order
    const originalPosition = originalQueue.indexOf(currentOriginalIndex);
    if (originalPosition >= 0) {
      // Reorder queue starting from current track
      const reorderedQueue = [
        ...originalQueue.slice(originalPosition),
        ...originalQueue.slice(0, originalPosition)
      ];
      setPlayQueue(reorderedQueue);
      setCurrentQueueIndex(0);
      console.log('🔀 Shuffle OFF - queue reordered from current track');
    } else {
      // Fallback to original order
      setPlayQueue([...originalQueue]);
      setCurrentQueueIndex(originalQueue.indexOf(currentOriginalIndex) || 0);
      console.log('🔀 Shuffle OFF - restored original order');
    }
    setShuffleMode(false);
  }
}, [shuffleMode, createWeightedShuffle, originalQueue, playQueue, currentQueueIndex]);

const playAll = useCallback(async () => {
  console.log(`🎵 playAll() called, previewMode: ${previewMode}`);
  if (!tracks.length) {
    console.log('❌ No tracks available');
    return;
  }
  
  let newQueue;
  if (shuffleMode) {
    newQueue = createWeightedShuffle();
  } else {
    newQueue = [...originalQueue];
  }
  
  if (newQueue.length === 0) {
    console.log('❌ No playable tracks in queue');
    return;
  }
  
  console.log(`🎵 Setting up queue with ${newQueue.length} tracks`);
  console.log(`🎵 First track: "${tracks[newQueue[0]]?.title}"`);
  
  setPlayQueue(newQueue);
  setCurrentQueueIndex(0);
  
  await new Promise(resolve => setTimeout(resolve, 50));
  const success = await play(newQueue[0], true);
  
  if (!success && newQueue.length > 1) {
    console.log('❌ First track failed, trying next...');
    setCurrentQueueIndex(1);
    await new Promise(resolve => setTimeout(resolve, 50));
    await play(newQueue[1], true);
  }
}, [tracks, shuffleMode, createWeightedShuffle, originalQueue, play, previewMode]);


// Seek function
const seek = useCallback(async (ms) => {
  userActionRef.current.soughtAt = Date.now();
  
  if (previewMode && audioRef.current) {
    const seekTime = Math.max(0, Math.min(30, ms / 1000));
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
  console.log(`🔄 togglePreviewMode(${enabled})`);
  
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
  setPreviewCurrentTrackId(null);
  
  setTimeout(() => {
    initializeQueue();
  }, 100);
}, [isPlaying, previewMode, pausePreview, toggleSpotifyPlay, initializeQueue]);

/* ----------------- helpers for UI ----------------- */
const getPlayableTrackIndex = useCallback((originalTrackIndex) => {
  const originalTrack = tracks[originalTrackIndex];
  if (!originalTrack) return -1;
  
  if (previewMode) {
    if (!originalTrack.title || !originalTrack.artist) return -1;
  } else {
    if (!originalTrack.spotifyId) return -1;
  }
  return playableTracks.findIndex(t => t.trackId === originalTrack.trackId);
}, [tracks, playableTracks, previewMode]);

const playTrackByOriginalIndex = useCallback(async (originalTrackIndex) => {
  console.log(`🎯 playTrackByOriginalIndex(${originalTrackIndex}) - "${tracks[originalTrackIndex]?.title}"`);
  
  const track = tracks[originalTrackIndex];
  if (!track) {
    console.log('❌ Track not found');
    return;
  }
  
  // Check if track is playable
  const isPlayable = previewMode ? (track.title && track.artist) : track.spotifyId;
  if (!isPlayable) {
    console.log('❌ Track not playable in current mode');
    return;
  }
  
  // Find this track in current queue
  const queueIdx = playQueue.findIndex(i => i === originalTrackIndex);
  if (queueIdx >= 0) {
    console.log(`🎯 Found track in queue at position ${queueIdx}`);
    setCurrentQueueIndex(queueIdx);
  } else {
    console.log('🔄 Track not in queue, adding to front');
    // Add to front of queue
    const newQueue = [originalTrackIndex, ...playQueue.filter(i => i !== originalTrackIndex)];
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
  }
  
  await new Promise(resolve => setTimeout(resolve, 50));
  await play(originalTrackIndex, true);
}, [tracks, previewMode, playQueue, play]);

const playTrackFromQueue = useCallback(async (queueIndex) => {
  console.log(`🎯 playTrackFromQueue(${queueIndex})`);
  if (queueIndex < 0 || queueIndex >= playQueue.length) {
    console.log('❌ Invalid queue index');
    return;
  }
  setCurrentQueueIndex(queueIndex);
  await new Promise(resolve => setTimeout(resolve, 10));
  await play(playQueue[queueIndex], true); // user initiated
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