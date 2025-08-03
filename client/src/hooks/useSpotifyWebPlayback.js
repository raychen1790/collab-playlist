// client/src/hooks/useSpotifyWebPlayback.js
import { useState, useEffect, useCallback, useRef } from 'react';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

export function useSpotifyWebPlayback() {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [playerState, setPlayerState] = useState(null);
  const [volume, setVolume] = useState(0.5);
  const [error, setError] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  
  const playerRef = useRef(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const positionUpdateIntervalRef = useRef(null);

  // Fetch access token from backend
  const fetchAccessToken = useCallback(async () => {
    try {
      const response = await fetch('http://127.0.0.1:4000/auth/token', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Successfully fetched access token');
        setAccessToken(data.access_token);
        return data.access_token;
      } else {
        const errorData = await response.json();
        console.error('❌ Failed to get access token:', response.status, errorData);
        
        if (errorData.reauth_required) {
          setError('Please re-authenticate with Spotify to get the required permissions');
        } else {
          setError(`Failed to get access token: ${errorData.error || 'Unknown error'}`);
        }
        return null;
      }
    } catch (err) {
      console.error('❌ Failed to fetch access token:', err);
      setError('Failed to get Spotify access token - please try logging in again');
      return null;
    }
  }, []);

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
        // Wait for Spotify to be available
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

  // Update player position periodically when playing
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
    }

    positionUpdateIntervalRef.current = setInterval(async () => {
      if (player && isActive) {
        try {
          const state = await player.getCurrentState();
          if (state && !state.paused) {
            setPlayerState(prevState => ({
              ...prevState,
              ...state,
              position: state.position
            }));
          }
        } catch (err) {
          console.error('Error updating position:', err);
        }
      }
    }, 1000); // Update every second
  }, [player, isActive]);

  const stopPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
      positionUpdateIntervalRef.current = null;
    }
  }, []);

  // Check if our device is the active device - make it independent
  const checkActiveDevice = useCallback(async (token = accessToken, deviceIdToCheck = deviceId) => {
    if (!token || !deviceIdToCheck) return false;

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const isOurDeviceActive = data.device?.id === deviceIdToCheck;
        setIsActive(isOurDeviceActive);
        
        // Start/stop position updates based on active state
        if (isOurDeviceActive && data.is_playing) {
          startPositionUpdates();
        } else {
          stopPositionUpdates();
        }
        
        return isOurDeviceActive;
      } else if (response.status === 204) {
        // No active device
        setIsActive(false);
        stopPositionUpdates();
        return false;
      } else {
        console.error('Failed to check active device:', response.status);
        return false;
      }
    } catch (err) {
      console.error('Error checking active device:', err);
    }
    return false;
  }, [startPositionUpdates, stopPositionUpdates]);

  // Initialize Spotify Player - remove dependencies that cause loops
  const initializePlayer = useCallback(async (token) => {
    try {
      const spotify = await loadSpotifyScript();
      
      const spotifyPlayer = new spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: (cb) => {
          cb(token);
        },
        volume: 0.5 // Use fixed volume instead of state
      });

      // Error handling
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

      // Playback status updates
      spotifyPlayer.addListener('player_state_changed', (state) => {
        console.log('Player state changed:', state);
        setPlayerState(state);
        
        // Start/stop position updates based on playback state
        if (state && !state.paused && isActive) {
          startPositionUpdates();
        } else {
          stopPositionUpdates();
        }
      });

      // Ready
      spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        
        // Check if we're already the active device
        setTimeout(() => {
          checkActiveDevice(token, device_id);
        }, 1000);
      });

      // Not Ready
      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        setIsReady(false);
        setIsActive(false);
        stopPositionUpdates();
      });

      // Connect to the player!
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
      
      // Retry logic
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        console.log(`Retrying initialization (${retryCountRef.current}/${maxRetries})...`);
        setTimeout(() => initializePlayer(token), 2000);
      }
    }
  }, [loadSpotifyScript, startPositionUpdates, stopPositionUpdates]);

  // Initialize on mount - ONLY run once
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const token = await fetchAccessToken();
      if (token && mounted) {
        await initializePlayer(token);
      }
    };

    init();

    return () => {
      mounted = false;
      stopPositionUpdates();
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, []); // Empty dependency array to run only once

  // Periodically check if we're still the active device - only when ready
  useEffect(() => {
    if (!isReady || !deviceId || !accessToken) return;

    const interval = setInterval(() => {
      checkActiveDevice(accessToken, deviceId);
    }, 10000); // Check every 10 seconds (less frequent)
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, accessToken]); // Only depend on values, not functions

  // Transfer playback to our device
  const transferPlayback = useCallback(async () => {
    if (!deviceId || !accessToken) {
      console.error('Cannot transfer playback: missing deviceId or accessToken');
      return false;
    }

    console.log('Attempting to transfer playback to device:', deviceId);

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false, // Don't start playing immediately
        }),
      });

      if (response.ok || response.status === 202) {
        console.log('Transfer playback request successful');
        
        // Wait a moment and then check if we're active
        setTimeout(async () => {
          const isActive = await checkActiveDevice(accessToken, deviceId);
          if (isActive) {
            console.log('Successfully transferred playback to our device');
          } else {
            console.log('Transfer request sent but device not yet active, checking again...');
            // Check again after a longer delay
            setTimeout(() => checkActiveDevice(accessToken, deviceId), 2000);
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
  }, [deviceId, accessToken]);

  // Play a specific Spotify URI
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId || !accessToken) {
      console.error('Player not ready or missing token/deviceId');
      return false;
    }

    // Ensure we're the active device first
    if (!isActive) {
      console.log('Device not active, attempting to transfer playback...');
      const transferred = await transferPlayback();
      if (!transferred) {
        return false;
      }
      
      // Wait a moment for the transfer to take effect
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [spotifyUri],
          position_ms: positionMs,
        }),
      });

      if (response.ok || response.status === 202) {
        console.log('Successfully started playback');
        // Start position updates
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
  }, [player, deviceId, accessToken, isActive, transferPlayback, startPositionUpdates]);

  // Player controls
  const togglePlay = useCallback(async () => {
    if (player) {
      await player.togglePlay();
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
      // Update the position immediately for better UX
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

  // Get current playback state
  const getCurrentState = useCallback(async () => {
    if (player) {
      return await player.getCurrentState();
    }
    return null;
  }, [player]);

  // Cleanup position updates on unmount
  useEffect(() => {
    return () => {
      stopPositionUpdates();
    };
  }, [stopPositionUpdates]);

  return {
    // State
    player,
    deviceId,
    isReady,
    isActive,
    playerState,
    volume,
    error,
    accessToken,
    
    // Actions
    playTrack,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume: setPlayerVolume,
    getCurrentState,
    transferPlayback,
    
    // Utils
    isPlaying: playerState && !playerState.paused,
    currentTrack: playerState?.track_window?.current_track,
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
  };
}