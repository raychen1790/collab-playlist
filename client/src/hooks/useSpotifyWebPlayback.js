// client/src/hooks/useSpotifyWebPlayback.js - FIXED VERSION with proper dual auth integration
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

// Rate limiting helpers
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.globalCooldown = 0;
  }

  async waitForRateLimit(endpoint) {
    const now = Date.now();
    const key = endpoint || 'global';
    
    // Check global cooldown (for 429 errors)
    if (now < this.globalCooldown) {
      const waitTime = this.globalCooldown - now;
      console.log(`⏳ Global rate limit cooldown: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Check endpoint-specific cooldown
    const lastRequest = this.requests.get(key) || 0;
    const minInterval = key === '/me/player' ? 3000 : 1000; // Longer for player endpoint
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      console.log(`⏳ Endpoint rate limit for ${key}: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.set(key, Date.now());
  }

  handleRateLimitError() {
    // Set a 5-second global cooldown after any 429 error
    this.globalCooldown = Date.now() + 5000;
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
  const tokenRef = useRef(null);
  const lastTokenRefresh = useRef(0);
  
  // Real-time position tracking
  const positionUpdateIntervalRef = useRef(null);
  const lastPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());
  const isPlayingRef = useRef(false);

  const { apiRequest, accessToken, getFreshToken } = useContext(AuthContext);

  // FIXED: Enhanced token getter that uses the dual auth system
  const getValidTokenForSpotify = useCallback(async () => {
    const now = Date.now();
    
    console.log('🎵 Getting token for Spotify Web Playback...');
    
    try {
      // First try to get a fresh token from the auth system
      const freshToken = await getFreshToken();
      if (freshToken) {
        console.log('✅ Got fresh token from AuthContext');
        tokenRef.current = freshToken;
        lastTokenRefresh.current = now;
        return freshToken;
      }

      // Fallback to using apiRequest to get token from backend
      const response = await apiRequest('/auth/token', {
        method: 'GET',
        headers: {
          'Authorization': accessToken ? `Bearer ${accessToken}` : undefined
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          console.log('✅ Got token from /auth/token endpoint');
          tokenRef.current = data.access_token;
          lastTokenRefresh.current = now;
          return data.access_token;
        }
      } else if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Token request failed with 401:', errorData);
        throw new Error('Authentication failed - please re-login');
      }

      throw new Error('No valid token available');
    } catch (err) {
      console.error('❌ Failed to get valid token for Spotify:', err);
      throw new Error(`Token error: ${err.message}`);
    }
  }, [getFreshToken, apiRequest, accessToken]);

  // Update token reference when accessToken changes
  useEffect(() => {
    if (accessToken) {
      tokenRef.current = accessToken;
      console.log('🔍 Token updated in Web Playback hook');
    }
  }, [accessToken]);

  // Load Spotify script with error handling
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

  // Enhanced position updates with better error handling
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
    }

    // Less frequent updates to avoid rate limiting
    positionUpdateIntervalRef.current = setInterval(async () => {
      if (player && isActive && isPlayingRef.current) {
        try {
          await rateLimiter.waitForRateLimit('getCurrentState');
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
          // Don't log errors for position updates to avoid spam
          if (!err.message.includes('rate limit')) {
            console.error('Error getting current state:', err);
          }
        }
      }
    }, 8000); // Increased to 8 seconds to avoid rate limiting

    // Smooth interpolation every 500ms (client-side only, no API calls)
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
    }, 500); // Smoother updates for UI

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

  // FIXED: Enhanced device checking that uses apiRequest for consistency
  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      
      // Use apiRequest for consistency with auth system
      const response = await apiRequest('/auth/me', { method: 'GET' });
      
      if (!response.ok) {
        console.error('Failed to verify auth before device check');
        return false;
      }

      // Now check the actual player state using direct Spotify API with fresh token
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const playerResponse = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (playerResponse.ok) {
        const data = await playerResponse.json();
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
      } else if (playerResponse.status === 204) {
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
        return false;
      } else if (playerResponse.status === 429) {
        rateLimiter.handleRateLimitError();
        console.log('Device check rate limited');
        return false;
      } else {
        console.error('Failed to check active device:', playerResponse.status);
        return false;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error checking active device:', err);
      }
      return false;
    }
  }, [deviceId, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, apiRequest]);

  // FIXED: Enhanced player initialization with proper auth integration
  const initializePlayer = useCallback(async () => {
    try {
      console.log('🔄 Initializing Spotify Player...');
      const spotify = await loadSpotifyScript();
      
      // Verify we can get a token before creating the player
      const initialToken = await getValidTokenForSpotify();
      console.log('✅ Got initial token for player initialization');

      const spotifyPlayer = new spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: async (cb) => {
          try {
            console.log('🔄 Spotify SDK requesting OAuth token...');
            // FIXED: Use the proper token getter that integrates with auth system
            const freshToken = await getValidTokenForSpotify();
            console.log('✅ Providing fresh token to Spotify SDK');
            cb(freshToken);
          } catch (err) {
            console.error('❌ Failed to get token for Spotify Player:', err);
            setError(`Authentication failed: ${err.message}`);
            cb(''); // Pass empty string to avoid SDK errors
          }
        },
        volume: 0.5
      });

      // Enhanced error handling
      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Failed to initialize:', message);
        setError(`Initialization error: ${message}`);
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Failed to authenticate:', message);
        setError(`Authentication error: ${message}`);
        
        // Clear error after showing it briefly and retry if possible
        setTimeout(() => {
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            console.log(`Retrying after auth error (${retryCountRef.current}/${maxRetries})...`);
            setTimeout(() => initializePlayer(), 3000);
          } else {
            setError('Authentication failed after multiple attempts. Please refresh and try again.');
          }
        }, 2000);
      });

      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('❌ Failed to validate Spotify account:', message);
        setError(`Account error: ${message}. Spotify Premium is required.`);
      });

      spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('❌ Playback error:', message);
        setError(`Playback error: ${message}`);
        // Clear playback errors after a short time
        setTimeout(() => setError(null), 5000);
      });

      // Enhanced state change handling
      spotifyPlayer.addListener('player_state_changed', (state) => {
        console.log('🎵 Player state changed:', state ? 'playing' : 'stopped');
        
        if (state) {
          const wasPlaying = isPlayingRef.current;
          const isNowPlaying = !state.paused;
          
          isPlayingRef.current = isNowPlaying;
          lastPositionRef.current = state.position;
          lastUpdateTimeRef.current = Date.now();
          
          setPlayerState(state);
          
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
        console.log('✅ Spotify Player Ready with Device ID:', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        
        // Check if device is active after a delay
        setTimeout(() => {
          checkActiveDevice(device_id);
        }, 2000);
      });

      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('❌ Spotify Player Not Ready:', device_id);
        setIsReady(false);
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
      });

      // Connect to Spotify
      const success = await spotifyPlayer.connect();
      
      if (success) {
        console.log('✅ Successfully connected to Spotify!');
        setPlayer(spotifyPlayer);
        playerRef.current = spotifyPlayer;
      } else {
        throw new Error('Failed to connect to Spotify Player');
      }

    } catch (err) {
      console.error('❌ Error initializing Spotify player:', err);
      setError(err.message);
      
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        console.log(`Retrying initialization (${retryCountRef.current}/${maxRetries})...`);
        setTimeout(() => initializePlayer(), 3000 * retryCountRef.current); // Exponential backoff
      } else {
        setError('Failed to initialize Spotify Player after multiple attempts. Please refresh the page.');
      }
    }
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice]);

  // Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && mounted) {
      console.log('🔍 Access token available, initializing player...');
      // Add a small delay to ensure everything is ready
      setTimeout(() => {
        if (mounted) {
          initializePlayer();
        }
      }, 1000);
    }

    return () => {
      mounted = false;
      stopPositionUpdates();
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, [accessToken, initializePlayer, stopPositionUpdates]);

  // Periodic device checking with rate limiting
  useEffect(() => {
    if (!isReady || !deviceId) return;

    const interval = setInterval(() => {
      checkActiveDevice(deviceId);
    }, 15000); // Reduced frequency to avoid rate limiting
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  // FIXED: Enhanced transfer playback with proper auth integration
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer playback: missing deviceId');
      return false;
    }

    console.log('🔄 Attempting to transfer playback to device:', deviceId);

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      
      // FIXED: Get token using the proper auth system
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
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
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 202) {
        console.log('✅ Transfer playback request successful');
        
        // Wait longer before checking
        setTimeout(async () => {
          const isActive = await checkActiveDevice(deviceId);
          if (isActive) {
            console.log('✅ Successfully transferred playback to our device');
          } else {
            console.log('⏳ Transfer request sent but device not yet active');
            // Check again after more time
            setTimeout(() => checkActiveDevice(deviceId), 3000);
          }
        }, 2000);
        
        return true;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait a moment before trying again.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Failed to transfer playback:', response.status, errorText);
        setError(`Failed to activate device: ${response.status} - ${errorText}`);
        return false;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error transferring playback:', err);
        setError(`Error activating device: ${err.message}`);
      }
      return false;
    }
  }, [deviceId, getValidTokenForSpotify, checkActiveDevice]);

  // FIXED: Enhanced playTrack with proper auth integration
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
      
      // Wait for device activation
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      
      // FIXED: Get token using the proper auth system
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
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
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 202) {
        console.log('✅ Successfully started playback');
        isPlayingRef.current = true;
        startPositionUpdates();
        return true;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before playing another track.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Failed to start playback:', response.status, errorText);
        setError(`Playback failed: ${response.status} - ${errorText}`);
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

  // Other player controls with rate limiting
  const togglePlay = useCallback(async () => {
    if (!player) return;

    try {
      await rateLimiter.waitForRateLimit('togglePlay');
      await player.togglePlay();
      
      // Update ref immediately for better UI response
      setTimeout(async () => {
        try {
          const state = await player.getCurrentState();
          if (state) {
            isPlayingRef.current = !state.paused;
          }
        } catch (err) {
          // Ignore errors for immediate state updates
        }
      }, 100);
    } catch (err) {
      console.error('Error toggling play:', err);
    }
  }, [player]);

  const nextTrack = useCallback(async () => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('nextTrack');
        await player.nextTrack();
      } catch (err) {
        console.error('Error skipping to next track:', err);
      }
    }
  }, [player]);

  const previousTrack = useCallback(async () => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('previousTrack');
        await player.previousTrack();
      } catch (err) {
        console.error('Error skipping to previous track:', err);
      }
    }
  }, [player]);

  const seek = useCallback(async (positionMs) => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('seek');
        await player.seek(positionMs);
        lastPositionRef.current = positionMs;
        lastUpdateTimeRef.current = Date.now();
        setPlayerState(prevState => ({
          ...prevState,
          position: positionMs
        }));
      } catch (err) {
        console.error('Error seeking:', err);
      }
    }
  }, [player]);

  const setPlayerVolume = useCallback(async (volume) => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('setVolume');
        await player.setVolume(volume);
        setVolume(volume);
      } catch (err) {
        console.error('Error setting volume:', err);
      }
    }
  }, [player]);

  const getCurrentState = useCallback(async () => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('getCurrentState');
        return await player.getCurrentState();
      } catch (err) {
        console.error('Error getting current state:', err);
        return null;
      }
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
    accessToken: tokenRef.current,
    
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