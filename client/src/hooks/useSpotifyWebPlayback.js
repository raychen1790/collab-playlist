// client/src/hooks/useSpotifyWebPlayback.js - FIXED VERSION with better token handling
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

export function useSpotifyWebPlayback() {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [playerState, setPlayerState] = useState(null);
  const [volume, setVolume] = useState(0.5);
  const [error, setError] = useState(null);
  
  const playerRef = useRef(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const tokenRef = useRef(null); // FIXED: Store current token
  
  // FIXED: Real-time position tracking
  const positionUpdateIntervalRef = useRef(null);
  const lastPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());
  const isPlayingRef = useRef(false);

  // Use AuthContext for enhanced API requests and token management
  const { apiRequest, accessToken, getFreshToken } = useContext(AuthContext);

  // FIXED: Better token management
  useEffect(() => {
    if (accessToken) {
      tokenRef.current = accessToken;
      console.log('🔍 Token updated in Web Playback hook');
    }
  }, [accessToken]);

  // FIXED: Token getter that always returns a valid token
  const getValidToken = useCallback(async () => {
    // Try current token first
    if (tokenRef.current) {
      try {
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${tokenRef.current}` }
        });
        if (response.ok) {
          return tokenRef.current;
        }
      } catch (err) {
        console.log('Current token invalid, getting fresh one...');
      }
    }

    // Get fresh token from AuthContext
    try {
      const freshToken = await getFreshToken();
      if (freshToken) {
        tokenRef.current = freshToken;
        return freshToken;
      }
    } catch (err) {
      console.error('Failed to get fresh token:', err);
    }

    throw new Error('No valid token available');
  }, [getFreshToken]);

  // Load Spotify Web Playback SDK script
  const loadSpotifyScript = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (window.Spotify) {
        resolve(window.Spotify);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;

      script.onload = () => {
        const checkSpotify = () => {
          if (window.Spotify) {
            resolve(window.Spotify);
          } else {
            setTimeout(checkSpotify, 100);
          }
        };
        checkSpotify();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Spotify Web Playback SDK'));
      };

      document.head.appendChild(script);
    });
  }, []);

  // FIXED: Real-time position updates with proper interpolation
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
    }

    positionUpdateIntervalRef.current = setInterval(() => {
      if (player && isActive && isPlayingRef.current) {
        // Get actual state from Spotify every 5 seconds for accuracy
        player.getCurrentState().then(state => {
          if (state && !state.paused) {
            lastPositionRef.current = state.position;
            lastUpdateTimeRef.current = Date.now();
            
            setPlayerState(prevState => ({
              ...prevState,
              ...state,
              position: state.position
            }));
          }
        }).catch(err => {
          console.error('Error getting current state:', err);
        });
      }
    }, 5000); // Update from Spotify every 5 seconds

    // Smooth interpolation every 250ms
    const smoothInterval = setInterval(() => {
      if (isPlayingRef.current && playerState?.duration) {
        const now = Date.now();
        const timeSinceUpdate = now - lastUpdateTimeRef.current;
        const interpolatedPosition = Math.min(
          lastPositionRef.current + timeSinceUpdate,
          playerState.duration
        );
        
        setPlayerState(prevState => {
          if (prevState) {
            return {
              ...prevState,
              position: interpolatedPosition
            };
          }
          return prevState;
        });
      }
    }, 250);

    // Store both intervals for cleanup
    positionUpdateIntervalRef.current = {
      main: positionUpdateIntervalRef.current,
      smooth: smoothInterval
    };
  }, [player, isActive, playerState?.duration]);

  const stopPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      if (typeof positionUpdateIntervalRef.current === 'object') {
        clearInterval(positionUpdateIntervalRef.current.main);
        clearInterval(positionUpdateIntervalRef.current.smooth);
      } else {
        clearInterval(positionUpdateIntervalRef.current);
      }
      positionUpdateIntervalRef.current = null;
    }
  }, []);

  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      const token = await getValidToken();
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const isOurDeviceActive = data.device?.id === deviceIdToCheck;
        setIsActive(isOurDeviceActive);
        
        if (isOurDeviceActive && data.is_playing) {
          isPlayingRef.current = true;
          startPositionUpdates();
        } else {
          isPlayingRef.current = false;
          stopPositionUpdates();
        }
        
        return isOurDeviceActive;
      } else if (response.status === 204) {
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
        return false;
      } else {
        console.error('Failed to check active device:', response.status);
        return false;
      }
    } catch (err) {
      console.error('Error checking active device:', err);
      return false;
    }
  }, [deviceId, getValidToken, startPositionUpdates, stopPositionUpdates]);

  // FIXED: Initialize player with proper token handling
  const initializePlayer = useCallback(async () => {
    try {
      const spotify = await loadSpotifyScript();
      const token = await getValidToken();
      
      const spotifyPlayer = new spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: async (cb) => {
          try {
            // FIXED: Always get a fresh token when Spotify requests it
            const freshToken = await getValidToken();
            cb(freshToken);
          } catch (err) {
            console.error('Failed to get token for Spotify Player:', err);
            setError('Authentication failed. Please log in again.');
          }
        },
        volume: 0.5
      });

      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Failed to initialize:', message);
        setError(`Initialization error: ${message}`);
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Failed to authenticate:', message);
        if (message.includes('Invalid token') || message.includes('token scopes')) {
          setError(`Authentication error: Token doesn't have required permissions. Please re-login to Spotify.`);
        } else {
          setError(`Authentication error: ${message}`);
        }
      });

      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('❌ Failed to validate Spotify account:', message);
        setError(`Account error: ${message}. Note: Spotify Premium is required for Web Playback SDK.`);
      });

      spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('❌ Failed to perform playback:', message);
        setError(`Playback error: ${message}`);
      });

      // FIXED: Better state change handling
      spotifyPlayer.addListener('player_state_changed', (state) => {
        console.log('🎵 Player state changed:', state);
        
        if (state) {
          const wasPlaying = isPlayingRef.current;
          const isNowPlaying = !state.paused;
          
          isPlayingRef.current = isNowPlaying;
          lastPositionRef.current = state.position;
          lastUpdateTimeRef.current = Date.now();
          
          setPlayerState(state);
          
          // Start/stop position tracking based on play state
          if (isNowPlaying && !wasPlaying) {
            console.log('▶️ Starting position updates');
            startPositionUpdates();
          } else if (!isNowPlaying && wasPlaying) {
            console.log('⏸️ Stopping position updates');
            stopPositionUpdates();
          }
        } else {
          isPlayingRef.current = false;
          setPlayerState(null);
          stopPositionUpdates();
        }
      });

      spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        
        setTimeout(() => {
          checkActiveDevice(device_id);
        }, 1000);
      });

      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        setIsReady(false);
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
      });

      const success = await spotifyPlayer.connect();
      
      if (success) {
        console.log('Successfully connected to Spotify!');
        setPlayer(spotifyPlayer);
        playerRef.current = spotifyPlayer;
      } else {
        throw new Error('Failed to connect to Spotify');
      }

    } catch (err) {
      console.error('Error initializing Spotify player:', err);
      setError(err.message);
      
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        console.log(`Retrying initialization (${retryCountRef.current}/${maxRetries})...`);
        setTimeout(() => initializePlayer(), 2000);
      }
    }
  }, [loadSpotifyScript, getValidToken, startPositionUpdates, stopPositionUpdates, checkActiveDevice]);

  // FIXED: Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && mounted) {
      console.log('🔍 Access token available, initializing player...');
      initializePlayer();
    }

    return () => {
      mounted = false;
      stopPositionUpdates();
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, [accessToken, initializePlayer, stopPositionUpdates]);

  useEffect(() => {
    if (!isReady || !deviceId) return;

    const interval = setInterval(() => {
      checkActiveDevice(deviceId);
    }, 10000);
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer playback: missing deviceId');
      return false;
    }

    console.log('Attempting to transfer playback to device:', deviceId);

    try {
      const token = await getValidToken();
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });

      if (response.ok || response.status === 202) {
        console.log('Transfer playback request successful');
        
        setTimeout(async () => {
          const isActive = await checkActiveDevice(deviceId);
          if (isActive) {
            console.log('Successfully transferred playback to our device');
          } else {
            console.log('Transfer request sent but device not yet active, checking again...');
            setTimeout(() => checkActiveDevice(deviceId), 2000);
          }
        }, 1000);
        
        return true;
      } else {
        const errorText = await response.text();
        console.error('Failed to transfer playback:', response.status, errorText);
        setError(`Failed to transfer playback: ${response.status}`);
        return false;
      }
    } catch (err) {
      console.error('Error transferring playback:', err);
      setError(`Error transferring playback: ${err.message}`);
      return false;
    }
  }, [deviceId, getValidToken, checkActiveDevice]);

  // FIXED: Better playTrack function with improved token handling
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId) {
      console.error('Player not ready or missing deviceId');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, attempting to transfer playback...');
      const transferred = await transferPlayback();
      if (!transferred) {
        return false;
      }
      
      // Wait longer for device activation
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Add rate limiting protection
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const token = await getValidToken();
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [spotifyUri],
          position_ms: positionMs,
        }),
      });

      if (response.ok || response.status === 202) {
        console.log('Successfully started playback');
        isPlayingRef.current = true;
        startPositionUpdates();
        return true;
      } else {
        const errorText = await response.text();
        console.error('Failed to start playback:', response.status, errorText);
        setError(`Playback failed: ${response.status}`);
        return false;
      }
    } catch (err) {
      console.error('Error playing track:', err);
      setError(`Error playing track: ${err.message}`);
      return false;
    }
  }, [player, deviceId, isActive, transferPlayback, startPositionUpdates, getValidToken]);

  // FIXED: Proper toggle play function
  const togglePlay = useCallback(async () => {
    if (!player) return;

    try {
      await player.togglePlay();
      
      // Update ref immediately for better UI response
      const state = await player.getCurrentState();
      if (state) {
        isPlayingRef.current = !state.paused;
      }
    } catch (err) {
      console.error('Error toggling play:', err);
    }
  }, [player]);

  const nextTrack = useCallback(async () => {
    if (player) {
      await player.nextTrack();
    }
  }, [player]);

  const previousTrack = useCallback(async () => {
    if (player) {
      await player.previousTrack();
    }
  }, [player]);

  const seek = useCallback(async (positionMs) => {
    if (player) {
      await player.seek(positionMs);
      lastPositionRef.current = positionMs;
      lastUpdateTimeRef.current = Date.now();
      setPlayerState(prevState => ({
        ...prevState,
        position: positionMs
      }));
    }
  }, [player]);

  const setPlayerVolume = useCallback(async (volume) => {
    if (player) {
      await player.setVolume(volume);
      setVolume(volume);
    }
  }, [player]);

  const getCurrentState = useCallback(async () => {
    if (player) {
      return await player.getCurrentState();
    }
    return null;
  }, [player]);

  useEffect(() => {
    return () => {
      stopPositionUpdates();
    };
  }, [stopPositionUpdates]);

  return {
    player,
    deviceId,
    isReady,
    isActive,
    playerState,
    volume,
    error,
    accessToken: tokenRef.current, // FIXED: Return current token
    
    playTrack,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume: setPlayerVolume,
    getCurrentState,
    transferPlayback,
    
    // FIXED: More accurate playing state
    isPlaying: playerState && !playerState.paused,
    currentTrack: playerState?.track_window?.current_track,
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
  };
}