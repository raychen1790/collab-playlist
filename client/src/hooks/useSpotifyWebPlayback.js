// ========================================
// 1. FIXED useSpotifyWebPlayback.js - Fully aligned with auth system
// ========================================

// client/src/hooks/useSpotifyWebPlayback.js - FULLY ALIGNED VERSION
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
    
    if (now < this.globalCooldown) {
      const waitTime = this.globalCooldown - now;
      console.log(`⏳ Global rate limit cooldown: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const lastRequest = this.requests.get(key) || 0;
    const minInterval = key === '/me/player' ? 3000 : 1000;
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      console.log(`⏳ Endpoint rate limit for ${key}: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.set(key, Date.now());
  }

  handleRateLimitError() {
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

  // CRITICAL FIX: Token getter that EXACTLY matches your auth system
  const getValidTokenForSpotify = useCallback(async () => {
    console.log('🎵 Getting token for Spotify Web Playback...');
    
    try {
      // Method 1: Try getFreshToken from AuthContext first (this uses your /auth/token endpoint)
      const freshToken = await getFreshToken();
      if (freshToken) {
        console.log('✅ Got fresh token from AuthContext.getFreshToken()');
        tokenRef.current = freshToken;
        lastTokenRefresh.current = Date.now();
        return freshToken;
      }

      // Method 2: If that fails, try apiRequest to /auth/token directly
      console.log('🔄 getFreshToken failed, trying direct apiRequest...');
      const response = await apiRequest('/auth/token', { method: 'GET' });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          console.log('✅ Got token from direct /auth/token call');
          tokenRef.current = data.access_token;
          lastTokenRefresh.current = Date.now();
          return data.access_token;
        }
      }

      // Method 3: Last resort - use current accessToken if available
      if (accessToken) {
        console.log('⚠️ Using current accessToken as fallback');
        return accessToken;
      }

      throw new Error('No valid token available through any method');
    } catch (err) {
      console.error('❌ All token methods failed:', err);
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
          if (!err.message.includes('rate limit')) {
            console.error('Error getting current state:', err);
          }
        }
      }
    }, 8000);

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

  // CRITICAL FIX: Device checking that properly handles auth and 404 errors
  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      
      // Get fresh token using our auth system
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // Increased timeout
      
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
        // No active devices - this is normal
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
        return false;
      } else if (playerResponse.status === 404) {
        // CRITICAL: Handle 404 specifically - might be temporary Spotify issue
        console.log('⚠️ Got 404 when checking device - might be temporary Spotify issue');
        // Don't change active state on 404, just log it
        return isActive; // Return current state
      } else if (playerResponse.status === 429) {
        rateLimiter.handleRateLimitError();
        console.log('Device check rate limited');
        return isActive; // Return current state
      } else {
        console.error('Failed to check active device:', playerResponse.status);
        return isActive; // Return current state instead of false
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error checking active device:', err);
      }
      return isActive; // Return current state on error
    }
  }, [deviceId, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, isActive]);

  // CRITICAL FIX: Player initialization with robust error handling
  const initializePlayer = useCallback(async () => {
    try {
      console.log('🔄 Initializing Spotify Player...');
      const spotify = await loadSpotifyScript();
      
      // Verify auth system is working first
      try {
        const response = await apiRequest('/auth/me', { method: 'GET' });
        if (!response.ok) {
          throw new Error('Auth system not ready');
        }
        const authData = await response.json();
        if (!authData.user) {
          throw new Error('User not authenticated');
        }
        console.log('✅ Auth system verified, user:', authData.user.display_name);
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

      // Enhanced error handling with specific auth error handling
      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Failed to initialize:', message);
        setError(`Initialization error: ${message}`);
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Authentication error in Spotify Player:', message);
        setError(`Spotify authentication error: ${message}`);
        
        // Don't retry immediately on auth errors - might be a token issue
        setTimeout(async () => {
          console.log('🔄 Attempting to refresh auth after Spotify auth error...');
          try {
            // Force a fresh token
            await getValidTokenForSpotify();
            if (retryCountRef.current < maxRetries) {
              retryCountRef.current++;
              console.log(`Retrying after auth error (${retryCountRef.current}/${maxRetries})...`);
              setTimeout(() => initializePlayer(), 3000);
            }
          } catch (refreshErr) {
            setError('Authentication failed. Please refresh and try again.');
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
        }, 3000); // Increased delay
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
        setTimeout(() => initializePlayer(), 5000 * retryCountRef.current);
      } else {
        setError('Failed to initialize Spotify Player after multiple attempts. Please refresh the page.');
      }
    }
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice, apiRequest]);

  // Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && mounted) {
      console.log('🔍 Access token available, initializing player...');
      setTimeout(() => {
        if (mounted) {
          initializePlayer();
        }
      }, 2000); // Increased delay to ensure auth system is fully ready
    }

    return () => {
      mounted = false;
      stopPositionUpdates();
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, [accessToken, initializePlayer, stopPositionUpdates]);

  // Periodic device checking with better error handling
  useEffect(() => {
    if (!isReady || !deviceId) return;

    const interval = setInterval(() => {
      checkActiveDevice(deviceId);
    }, 20000); // Increased to 20 seconds to reduce load
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  // CRITICAL FIX: Enhanced transfer playback with 404 handling
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer playback: missing deviceId');
      return false;
    }

    console.log('🔄 Attempting to transfer playback to device:', deviceId);

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout
      
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
        
        // Wait and check multiple times
        let attempts = 0;
        const maxAttempts = 5;
        
        const checkTransfer = async () => {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          const isActive = await checkActiveDevice(deviceId);
          
          if (isActive) {
            console.log('✅ Successfully transferred playback to our device');
            return true;
          } else if (attempts < maxAttempts) {
            console.log(`⏳ Transfer attempt ${attempts}/${maxAttempts} - device not yet active`);
            return checkTransfer();
          } else {
            console.log('⚠️ Transfer request sent but device activation timeout');
            return false;
          }
        };
        
        setTimeout(() => checkTransfer(), 1000);
        return true;
      } else if (response.status === 404) {
        // CRITICAL: Handle 404 specifically - common with Spotify Web API
        console.error('❌ Transfer playback got 404 - device might not be recognized yet');
        const errorText = await response.text().catch(() => 'Device not found');
        setError('Device not found. Try refreshing the page or reauthorizing.');
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait a moment before trying again.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Failed to transfer playbook:', response.status, errorText);
        setError(`Failed to activate device: ${response.status} - ${errorText}`);
        return false;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error transferring playbook:', err);
        setError(`Error activating device: ${err.message}`);
      }
      return false;
    }
  }, [deviceId, getValidTokenForSpotify, checkActiveDevice]);

  // Enhanced playTrack with 404 handling
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId) {
      console.error('Player not ready or missing deviceId');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, attempting to transfer playback...');
      const transferred = await transferPlaybook();
      if (!transferred) {
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
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
        console.log('✅ Successfully started playbook');
        isPlayingRef.current = true;
        startPositionUpdates();
        return true;
      } else if (response.status === 404) {
        const errorText = await response.text().catch(() => 'Device not found');
        console.error('❌ Playbook got 404:', errorText);
        setError('Device not found. Please activate device first.');
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before playing another track.');
        return false;
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Failed to start playbook:', response.status, errorText);
        setError(`Playbook failed: ${response.status} - ${errorText}`);
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

  // Other controls remain the same
  const togglePlay = useCallback(async () => {
    if (!player) return;
    try {
      await rateLimiter.waitForRateLimit('togglePlay');
      await player.togglePlay();
      setTimeout(async () => {
        try {
          const state = await player.getCurrentState();
          if (state) {
            isPlayingRef.current = !state.paused;
          }
        } catch (err) {}
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

// ========================================
// 2. Additional Auth System Verification
// ========================================

/*
CRITICAL DEBUGGING STEPS:

1. Verify your production environment variables:
   - SPOTIFY_CLIENT_ID
   - SPOTIFY_CLIENT_SECRET  
   - REDIRECT_URI (must match exactly in Spotify app settings)
   - FRONTEND_URI

2. Check Spotify app settings:
   - Make sure your production domain is added to Redirect URIs
   - Verify you have all required scopes enabled
   - Confirm the app is not in development mode restrictions

3. Test the auth endpoints directly:
   - GET /auth/me should return user data
   - GET /auth/token should return valid token
   - Both should work with cookies AND Authorization headers

4. Monitor these logs specifically:
   - "Got fresh token from AuthContext.getFreshToken()"  
   - "Auth system verified, user: [username]"
   - "Transfer playback request successful"
   - Any 404 errors should now show more specific error messages

5. Common 404 causes in production:
   - Spotify app not approved for production use
   - Domain mismatch in redirect URIs
   - Token expired and refresh failed
   - Rate limiting causing temporary failures
   - CORS issues between frontend and backend domains

The enhanced error handling will now give you much more specific information about what's failing.
*/