// client/src/hooks/useSpotifyWebPlayback.js - Fixed with environment variable
import { useState, useEffect, useCallback, useRef } from 'react';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';
// Use environment variable instead of hardcoded localhost
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';

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
  const lastKnownPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());

  // Fetch access token from backend - now uses environment variable
  const fetchAccessToken = useCallback(async () => {
    console.log('🔍 Fetching token from:', `${API_URL}/auth/token`);
    
    try {
      const response = await fetch(`${API_URL}/auth/token`, {
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

  // ... rest of the hook remains the same
  // (keeping the rest unchanged for brevity, but apply the same pattern everywhere)

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

  // Update player position with interpolation for smooth progress bar
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
    }

    positionUpdateIntervalRef.current = setInterval(async () => {
      if (player && isActive) {
        try {
          const state = await player.getCurrentState();
          if (state && !state.paused) {
            lastKnownPositionRef.current = state.position;
            lastUpdateTimeRef.current = Date.now();
            
            setPlayerState(prevState => ({
              ...prevState,
              ...state,
              position: state.position
            }));
          } else if (state && state.paused) {
            setPlayerState(prevState => ({
              ...prevState,
              ...state
            }));
          }
        } catch (err) {
          console.error('Error updating position:', err);
        }
      }
    }, 1000);

    const smoothUpdateInterval = setInterval(() => {
      if (player && isActive && playerState && !playerState.paused) {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
        const interpolatedPosition = lastKnownPositionRef.current + timeSinceLastUpdate;
        
        if (playerState.duration && interpolatedPosition <= playerState.duration) {
          setPlayerState(prevState => ({
            ...prevState,
            position: interpolatedPosition
          }));
        }
      }
    }, 100);

    positionUpdateIntervalRef.current = {
      main: positionUpdateIntervalRef.current,
      smooth: smoothUpdateInterval
    };
  }, [player, isActive, playerState]);

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
        
        if (isOurDeviceActive && data.is_playing) {
          startPositionUpdates();
        } else {
          stopPositionUpdates();
        }
        
        return isOurDeviceActive;
      } else if (response.status === 204) {
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

  const initializePlayer = useCallback(async (token) => {
    try {
      const spotify = await loadSpotifyScript();
      
      const spotifyPlayer = new spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: (cb) => {
          cb(token);
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

      spotifyPlayer.addListener('player_state_changed', (state) => {
        console.log('Player state changed:', state);
        setPlayerState(state);
        
        if (state) {
          lastKnownPositionRef.current = state.position;
          lastUpdateTimeRef.current = Date.now();
        }
        
        if (state && !state.paused && isActive) {
          startPositionUpdates();
        } else {
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
          checkActiveDevice(token, device_id);
        }, 1000);
      });

      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        setIsReady(false);
        setIsActive(false);
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
        setTimeout(() => initializePlayer(token), 2000);
      }
    }
  }, [loadSpotifyScript, startPositionUpdates, stopPositionUpdates]);

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
  }, []);

  useEffect(() => {
    if (!isReady || !deviceId || !accessToken) return;

    const interval = setInterval(() => {
      checkActiveDevice(accessToken, deviceId);
    }, 10000);
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, accessToken]);

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
          play: false,
        }),
      });

      if (response.ok || response.status === 202) {
        console.log('Transfer playback request successful');
        
        setTimeout(async () => {
          const isActive = await checkActiveDevice(accessToken, deviceId);
          if (isActive) {
            console.log('Successfully transferred playback to our device');
          } else {
            console.log('Transfer request sent but device not yet active, checking again...');
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

  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId || !accessToken) {
      console.error('Player not ready or missing token/deviceId');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, attempting to transfer playback...');
      const transferred = await transferPlayback();
      if (!transferred) {
        return false;
      }
      
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
      lastKnownPositionRef.current = positionMs;
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
    accessToken,
    
    playTrack,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume: setPlayerVolume,
    getCurrentState,
    transferPlayback,
    
    isPlaying: playerState && !playerState.paused,
    currentTrack: playerState?.track_window?.current_track,
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
  };
}