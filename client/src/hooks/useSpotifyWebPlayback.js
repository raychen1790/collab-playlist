// client/src/hooks/useSpotifyWebPlayback.js - FIXED VERSION
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
  const readyTimeoutRef = useRef(null);
  const sdkLoadedRef = useRef(false);
  
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

  // CRITICAL FIX: Completely rewrite SDK loading to avoid conflicts
  const loadSpotifyScript = useCallback(() => {
    return new Promise((resolve, reject) => {
      console.log('📦 Loading Spotify Web Playback SDK...');
      
      // IMPORTANT: Clean up any existing SDK state first
      if (window.Spotify) {
        console.log('🧹 Cleaning up existing Spotify SDK...');
        delete window.Spotify;
        delete window.onSpotifyWebPlaybackSDKReady;
      }

      // Remove existing script if present
      const existingScript = document.querySelector('script[src*="spotify-player.js"]');
      if (existingScript) {
        console.log('🧹 Removing existing Spotify script...');
        existingScript.remove();
      }

      // Set up the global callback BEFORE loading the script
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('🎉 onSpotifyWebPlaybackSDKReady fired!');
        
        // Clean up the global callback
        delete window.onSpotifyWebPlaybackSDKReady;
        
        if (window.Spotify?.Player) {
          console.log('✅ Spotify SDK ready');
          sdkLoadedRef.current = true;
          resolve(window.Spotify);
        } else {
          console.error('❌ Spotify SDK ready callback fired but no Player available');
          reject(new Error('Spotify SDK ready callback fired but no Player available'));
        }
      };

      // Create and load the script
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;

      let loadTimeout = setTimeout(() => {
        console.error('❌ Spotify SDK load timeout - callback never fired');
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Spotify SDK load timeout - callback never fired'));
      }, 20000); // 20 second timeout

      script.onload = () => {
        console.log('📦 Spotify script loaded, waiting for SDK ready callback...');
        // Don't resolve here - wait for onSpotifyWebPlaybackSDKReady
      };

      script.onerror = () => {
        console.error('❌ Failed to load Spotify Web Playback SDK script');
        clearTimeout(loadTimeout);
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Failed to load Spotify Web Playback SDK script'));
      };

      // Handle successful callback
      const originalResolve = resolve;
      resolve = (...args) => {
        clearTimeout(loadTimeout);
        originalResolve(...args);
      };

      // Handle error callback
      const originalReject = reject;
      reject = (...args) => {
        clearTimeout(loadTimeout);
        delete window.onSpotifyWebPlaybackSDKReady;
        originalReject(...args);
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

  // CRITICAL FIX 4: Enhanced player initialization with proper cleanup
  const initializePlayer = useCallback(async () => {
    if (initializationInProgress.current) {
      console.log('🔄 Initialization already in progress, skipping');
      return;
    }

    initializationInProgress.current = true;

    try {
      console.log('🔄 Initializing Spotify Player...');
      
      // Clean up any existing player first
      if (playerRef.current) {
        console.log('🧹 Cleaning up existing player...');
        try {
          await playerRef.current.disconnect();
        } catch (e) {
          console.log('Note: Error disconnecting old player (expected):', e.message);
        }
        playerRef.current = null;
        setPlayer(null);
      }
      
      // Clear any existing ready timeout
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }

      // Reset state
      setIsReady(false);
      setIsActive(false);
      setDeviceId(null);
      setPlayerState(null);
      stopPositionUpdates();
      
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

      console.log('🎵 Creating new Spotify Player instance...');
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

      // CRITICAL FIX: Set up event listeners BEFORE connecting
      console.log('📝 Setting up event listeners...');

      // Error handling
      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Initialization error:', message);
        setError(`Initialization error: ${message}`);
        initializationInProgress.current = false;
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Authentication error:', message);
        setError(`Authentication error: ${message}`);
        
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          console.log(`🔄 Retrying authentication (${retryCountRef.current}/${maxRetries})...`);
          setTimeout(() => {
            initializationInProgress.current = false;
            initializePlayer();
          }, 3000);
        } else {
          initializationInProgress.current = false;
        }
      });

      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('❌ Account error:', message);
        setError(`Account error: ${message}. Spotify Premium required.`);
        initializationInProgress.current = false;
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
      });

      spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('❌ Playback error:', message);
        setError(`Playback error: ${message}`);
        setTimeout(() => setError(null), 5000);
      });

      // State change handling
      spotifyPlayer.addListener('player_state_changed', (state) => {
        console.log('🎵 Player state changed:', state ? 'has state' : 'no state');
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

      // CRITICAL FIX: Enhanced ready event handler with more robust detection
      spotifyPlayer.addListener('ready', async ({ device_id }) => {
        console.log('🎉 Spotify Player Ready Event Fired! Device ID:', device_id);
        
        // Clear ready timeout
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
        
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        initializationInProgress.current = false;
        
        console.log('📱 Device registered, waiting for Spotify to recognize it...');
        
        // Wait a bit, then check registration
        setTimeout(async () => {
          const isRegistered = await waitForDeviceRegistration(device_id);
          
          if (isRegistered) {
            console.log('✅ Device successfully registered and recognized by Spotify');
            setTimeout(() => checkActiveDevice(device_id), 2000);
          } else {
            console.log('⚠️ Device registration timeout - may need manual activation');
            setError('Device registered but not yet active. Try playing a track to activate.');
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

      // CRITICAL FIX: Enhanced ready timeout with fallback detection
      readyTimeoutRef.current = setTimeout(async () => {
        console.error('❌ Ready event timeout - SDK connected but ready event never fired');
        
        // Try alternative detection methods
        try {
          // Method 1: Check if player has internal device ID
          if (spotifyPlayer._options?.id || spotifyPlayer.device_id) {
            const fallbackDeviceId = spotifyPlayer._options?.id || spotifyPlayer.device_id;
            console.log('🔍 Found fallback device ID:', fallbackDeviceId);
            
            setDeviceId(fallbackDeviceId);
            setIsReady(true);
            setError('Player ready (fallback detection)');
            initializationInProgress.current = false;
            
            setTimeout(() => checkActiveDevice(fallbackDeviceId), 3000);
            return;
          }
          
          // Method 2: Try to get current state as a connectivity test
          const testState = await spotifyPlayer.getCurrentState();
          if (testState !== null) {
            console.log('🔍 Player appears functional despite no ready event');
            setIsReady(true);
            setError('Player connected (state detection)');
            initializationInProgress.current = false;
            return;
          }
        } catch (fallbackError) {
          console.log('Fallback detection failed:', fallbackError.message);
        }
        
        setError('Player connection timeout. Please refresh and try again.');
        initializationInProgress.current = false;
      }, 30000); // 30 second timeout

      // Connect to Spotify
      console.log('🔗 Connecting to Spotify Web Playback SDK...');
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
        console.log(`🔄 Retrying initialization (${retryCountRef.current}/${maxRetries})...`);
        setTimeout(() => {
          initializationInProgress.current = false;
          initializePlayer();
        }, 5000 * retryCountRef.current);
      } else {
        setError('Failed to initialize after multiple attempts. Please refresh.');
        initializationInProgress.current = false;
      }
    }
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice, waitForDeviceRegistration]);

  // Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && !player && !initializationInProgress.current && mounted) {
      console.log('🔍 Access token available, initializing player...');
      // Small delay to ensure auth is fully ready
      setTimeout(() => {
        if (mounted && !initializationInProgress.current) {
          initializePlayer();
        }
      }, 2000);
    }

    return () => {
      mounted = false;
      stopPositionUpdates();
      
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      
      if (playerRef.current) {
        console.log('🔌 Disconnecting player...');
        playerRef.current.disconnect().catch(e => {
          console.log('Note: Disconnect error (expected):', e.message);
        });
      }
      
      // Clean up SDK state
      if (window.onSpotifyWebPlaybackSDKReady) {
        delete window.onSpotifyWebPlaybackSDKReady;
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