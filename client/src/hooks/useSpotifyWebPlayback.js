// client/src/hooks/useSpotifyWebPlayback.js - COMPREHENSIVE FIX
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

// Simplified rate limiter focused on Spotify API limits
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.globalCooldown = 0;
  }

  async waitForRateLimit(endpoint) {
    const now = Date.now();
    
    if (now < this.globalCooldown) {
      const waitTime = this.globalCooldown - now;
      console.log(`⏳ Global rate limit cooldown: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const key = endpoint || 'global';
    const lastRequest = this.requests.get(key) || 0;
    const minInterval = 1000; // 1 second between requests
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.set(key, Date.now());
  }

  handleRateLimitError() {
    this.globalCooldown = Date.now() + 5000; // 5 second cooldown
    console.log('🚫 Rate limited - setting 5s global cooldown');
  }
}

const rateLimiter = new RateLimiter();

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
  const initializationInProgress = useRef(false);
  const lastSuccessfulToken = useRef(null);
  
  // Position tracking
  const positionUpdateIntervalRef = useRef(null);
  const lastPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());
  const isPlayingRef = useRef(false);

  const { apiRequest, accessToken, getFreshToken } = useContext(AuthContext);

  // CRITICAL FIX 1: Simplified token getter that prevents conflicts
  const getValidTokenForSpotify = useCallback(async () => {
    console.log('🎵 Getting token for Spotify Web Playback...');
    
    try {
      // Try getFreshToken first (this handles both header and cookie tokens)
      const freshToken = await getFreshToken();
      if (freshToken) {
        // Verify the token works with Spotify
        const testResponse = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${freshToken}` },
          signal: AbortSignal.timeout(5000)
        });
        
        if (testResponse.ok) {
          console.log('✅ Token verified with Spotify API');
          lastSuccessfulToken.current = freshToken;
          return freshToken;
        } else if (testResponse.status === 429) {
          console.log('⚠️ Rate limited but token should be valid');
          lastSuccessfulToken.current = freshToken;
          return freshToken;
        }
      }

      // Fallback to last successful token
      if (lastSuccessfulToken.current) {
        console.log('⚠️ Using last successful token as fallback');
        return lastSuccessfulToken.current;
      }

      throw new Error('No valid token available');
    } catch (err) {
      console.error('❌ Token getter failed:', err);
      throw new Error(`Token error: ${err.message}`);
    }
  }, [getFreshToken]);

  // Load Spotify script
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

  // Position tracking
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
    }

    const mainInterval = setInterval(async () => {
      if (player && isActive && isPlayingRef.current) {
        try {
          const state = await player.getCurrentState();
          if (state && !state.paused) {
            lastPositionRef.current = state.position;
            lastUpdateTimeRef.current = Date.now();
            
            setPlayerState(prevState => ({
              ...prevState,
              ...state,
              position: state.position
            }));
          }
        } catch (err) {
          console.error('Error getting current state:', err);
        }
      }
    }, 5000);

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
    }, 500);

    positionUpdateIntervalRef.current = { main: mainInterval, smooth: smoothInterval };
  }, [player, isActive, playerState?.duration]);

  const stopPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current.main);
      clearInterval(positionUpdateIntervalRef.current.smooth);
      positionUpdateIntervalRef.current = null;
    }
  }, []);

  // CRITICAL FIX 2: Wait for device registration with better error handling
  const waitForDeviceRegistration = useCallback(async (deviceId, maxWaitTime = 20000) => {
    console.log('🔄 Waiting for device registration...');
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        await rateLimiter.waitForRateLimit('/me/player/devices');
        const token = await getValidTokenForSpotify();
        
        const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
          const data = await response.json();
          const ourDevice = data.devices?.find(d => d.id === deviceId);
          
          if (ourDevice) {
            console.log('✅ Device registered:', ourDevice.name);
            return true;
          }
        } else if (response.status === 429) {
          rateLimiter.handleRateLimitError();
        }
        
        console.log('⏳ Device not yet registered, waiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (err) {
        console.error('Error checking device registration:', err);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('❌ Device registration timeout');
    return false;
  }, [getValidTokenForSpotify]);

  // CRITICAL FIX 3: Improved active device checking
  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      const token = await getValidTokenForSpotify();
      
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(10000)
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
        // No active devices
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
        return false;
      } else if (response.status === 404) {
        console.log('⚠️ Got 404 when checking device - device might not be registered');
        setIsActive(false);
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        return isActive; // Return current state
      } else {
        console.error('Failed to check active device:', response.status);
        return isActive;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error checking active device:', err);
      }
      return isActive;
    }
  }, [deviceId, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, isActive]);

  // CRITICAL FIX 4: Streamlined player initialization
  const initializePlayer = useCallback(async () => {
    if (initializationInProgress.current) {
      console.log('🔄 Initialization already in progress, skipping');
      return;
    }

    initializationInProgress.current = true;

    try {
      console.log('🔄 Initializing Spotify Player...');
      const spotify = await loadSpotifyScript();
      
      // Test auth system first
      try {
        const testToken = await getValidTokenForSpotify();
        console.log('✅ Auth system working, token obtained');
      } catch (authErr) {
        console.error('❌ Auth system check failed:', authErr);
        setError('Authentication system not ready. Please refresh the page.');
        return;
      }

      const spotifyPlayer = new spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: async (cb) => {
          try {
            console.log('🔄 Spotify SDK requesting OAuth token...');
            const freshToken = await getValidTokenForSpotify();
            console.log('✅ Providing token to Spotify SDK');
            cb(freshToken);
          } catch (err) {
            console.error('❌ Failed to get token for Spotify Player:', err);
            setError(`Authentication failed: ${err.message}`);
            cb('');
          }
        },
        volume: 0.5
      });

      // Error handling
      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Initialization error:', message);
        setError(`Initialization error: ${message}`);
        initializationInProgress.current = false;
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Authentication error:', message);
        setError(`Authentication error: ${message}`);
        
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          setTimeout(() => {
            initializationInProgress.current = false;
            initializePlayer();
          }, 3000);
        }
      });

      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('❌ Account error:', message);
        setError(`Account error: ${message}. Spotify Premium required.`);
        initializationInProgress.current = false;
      });

      spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('❌ Playback error:', message);
        setError(`Playback error: ${message}`);
        setTimeout(() => setError(null), 5000);
      });

      // State change handling
      spotifyPlayer.addListener('player_state_changed', (state) => {
        if (state) {
          const isNowPlaying = !state.paused;
          isPlayingRef.current = isNowPlaying;
          lastPositionRef.current = state.position;
          lastUpdateTimeRef.current = Date.now();
          
          setPlayerState(state);
          
          if (isNowPlaying) {
            startPositionUpdates();
          } else {
            stopPositionUpdates();
          }
        } else {
          isPlayingRef.current = false;
          setPlayerState(null);
          stopPositionUpdates();
        }
      });

      spotifyPlayer.addListener('ready', async ({ device_id }) => {
        console.log('✅ Spotify Player Ready with Device ID:', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        
        // Wait for device registration
        setTimeout(async () => {
          const isRegistered = await waitForDeviceRegistration(device_id);
          
          if (isRegistered) {
            console.log('✅ Device successfully registered');
            setTimeout(() => checkActiveDevice(device_id), 2000);
          } else {
            console.log('⚠️ Device registration timeout');
            setError('Device registration delayed. Try playing a track to activate.');
          }
        }, 2000);
      });

      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('❌ Device not ready:', device_id);
        setIsReady(false);
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
      });

      // Connect
      const success = await spotifyPlayer.connect();
      
      if (success) {
        console.log('✅ Successfully connected to Spotify!');
        setPlayer(spotifyPlayer);
        playerRef.current = spotifyPlayer;
      } else {
        throw new Error('Failed to connect to Spotify Player');
      }

    } catch (err) {
      console.error('❌ Error initializing player:', err);
      setError(err.message);
      
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        setTimeout(() => {
          initializationInProgress.current = false;
          initializePlayer();
        }, 5000 * retryCountRef.current);
      } else {
        setError('Failed to initialize after multiple attempts. Please refresh.');
      }
    } finally {
      initializationInProgress.current = false;
    }
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice, waitForDeviceRegistration]);

  // Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && !player && mounted) {
      console.log('🔍 Access token available, initializing player...');
      // Small delay to ensure auth is fully ready
      setTimeout(() => {
        if (mounted) {
          initializePlayer();
        }
      }, 2000);
    }

    return () => {
      mounted = false;
      stopPositionUpdates();
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, [accessToken, player, initializePlayer, stopPositionUpdates]);

  // Periodic device checking
  useEffect(() => {
    if (!isReady || !deviceId) return;

    const interval = setInterval(() => {
      checkActiveDevice(deviceId);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  // CRITICAL FIX 5: Improved transfer playback
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer: missing deviceId');
      return false;
    }

    console.log('🔄 Transferring playback to device:', deviceId);

    try {
      // Ensure device is registered
      const isRegistered = await waitForDeviceRegistration(deviceId, 10000);
      if (!isRegistered) {
        setError('Device not recognized by Spotify. Please refresh the page.');
        return false;
      }

      await rateLimiter.waitForRateLimit('/me/player');
      const token = await getValidTokenForSpotify();
      
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
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok || response.status === 202) {
        console.log('✅ Transfer request successful');
        
        // Check for activation multiple times
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          const isActive = await checkActiveDevice(deviceId);
          if (isActive) {
            console.log('✅ Device activated successfully');
            return true;
          }
        }
        
        console.log('⚠️ Transfer sent but device not yet active');
        return true; // Consider successful even if not immediately active
      } else if (response.status === 404) {
        const errorText = await response.text().catch(() => 'Device not found');
        console.error('❌ Transfer failed with 404:', errorText);
        setError('Device not found by Spotify. Try refreshing the page.');
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before trying again.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Transfer failed:', response.status, errorText);
        setError(`Failed to activate device: ${response.status}`);
        return false;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error transferring playback:', err);
        setError(`Error activating device: ${err.message}`);
      }
      return false;
    }
  }, [deviceId, getValidTokenForSpotify, checkActiveDevice, waitForDeviceRegistration]);

  // Play track with better error handling
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId) {
      setError('Player not ready. Please wait or refresh the page.');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, transferring playback...');
      const transferred = await transferPlayback();
      if (!transferred) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      const token = await getValidTokenForSpotify();
      
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
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok || response.status === 202) {
        console.log('✅ Playback started successfully');
        isPlayingRef.current = true;
        startPositionUpdates();
        setError(null);
        return true;
      } else if (response.status === 404) {
        const errorText = await response.text().catch(() => 'Device not found');
        console.error('❌ Playback failed with 404:', errorText);
        setError('Device not found. Please activate device or refresh.');
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before playing.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Playback failed:', response.status, errorText);
        setError(`Playback failed: ${response.status}`);
        return false;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error playing track:', err);
        setError(`Error playing track: ${err.message}`);
      }
      return false;
    }
  }, [player, deviceId, isActive, transferPlayback, startPositionUpdates, getValidTokenForSpotify]);

  // Other controls with error handling
  const togglePlay = useCallback(async () => {
    if (!player) {
      setError('Player not ready');
      return;
    }
    try {
      await player.togglePlay();
    } catch (err) {
      console.error('Error toggling play:', err);
      setError('Failed to toggle playback');
    }
  }, [player]);

  const nextTrack = useCallback(async () => {
    if (player) {
      try {
        await player.nextTrack();
      } catch (err) {
        console.error('Error skipping to next:', err);
        setError('Failed to skip track');
      }
    }
  }, [player]);

  const previousTrack = useCallback(async () => {
    if (player) {
      try {
        await player.previousTrack();
      } catch (err) {
        console.error('Error going to previous:', err);
        setError('Failed to go to previous track');
      }
    }
  }, [player]);

  const seek = useCallback(async (positionMs) => {
    if (player) {
      try {
        await player.seek(positionMs);
        lastPositionRef.current = positionMs;
        lastUpdateTimeRef.current = Date.now();
        setPlayerState(prevState => ({
          ...prevState,
          position: positionMs
        }));
      } catch (err) {
        console.error('Error seeking:', err);
        setError('Failed to seek');
      }
    }
  }, [player]);

  const setPlayerVolume = useCallback(async (volume) => {
    if (player) {
      try {
        await player.setVolume(volume);
        setVolume(volume);
      } catch (err) {
        console.error('Error setting volume:', err);
        setError('Failed to set volume');
      }
    }
  }, [player]);

  const getCurrentState = useCallback(async () => {
    if (player) {
      try {
        return await player.getCurrentState();
      } catch (err) {
        console.error('Error getting state:', err);
        return null;
      }
    }
    return null;
  }, [player]);

  return {
    player,
    deviceId,
    isReady,
    isActive,
    playerState,
    volume,
    error,
    
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