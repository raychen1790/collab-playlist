// client/src/hooks/useSpotifyWebPlayback.js - COMPREHENSIVE FIX
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

// Enhanced rate limiting helpers
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
    const minInterval = key === '/me/player' ? 5000 : 1000; // Increased player check interval
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      console.log(`⏳ Endpoint rate limit for ${key}: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.set(key, Date.now());
  }

  handleRateLimitError() {
    this.globalCooldown = Date.now() + 10000; // Increased to 10s
    console.log('🚫 Rate limited - setting 10s global cooldown');
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
  const deviceRegistrationAttempts = useRef(0);
  const maxDeviceRegistrationAttempts = 5;
  
  // Real-time position tracking
  const positionUpdateIntervalRef = useRef(null);
  const lastPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());
  const isPlayingRef = useRef(false);

  const { apiRequest, accessToken, getFreshToken } = useContext(AuthContext);

  // CRITICAL FIX: Enhanced token getter with better error handling
  const getValidTokenForSpotify = useCallback(async () => {
    console.log('🎵 Getting token for Spotify Web Playback...');
    
    try {
      // Check if current token is still valid and not too old
      if (tokenRef.current && Date.now() - lastTokenRefresh.current < 45 * 60 * 1000) {
        console.log('✅ Using cached token (still valid)');
        return tokenRef.current;
      }

      // Method 1: Try getFreshToken from AuthContext first
      const freshToken = await getFreshToken();
      if (freshToken && freshToken !== tokenRef.current) {
        console.log('✅ Got fresh token from AuthContext.getFreshToken()');
        tokenRef.current = freshToken;
        lastTokenRefresh.current = Date.now();
        return freshToken;
      }

      // Method 2: If that fails, try apiRequest to /auth/token directly
      console.log('🔄 getFreshToken returned same token, trying direct apiRequest...');
      const response = await apiRequest('/auth/token', { method: 'GET' });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token && data.access_token !== tokenRef.current) {
          console.log('✅ Got new token from direct /auth/token call');
          tokenRef.current = data.access_token;
          lastTokenRefresh.current = Date.now();
          return data.access_token;
        }
      }

      // Method 3: Use current accessToken if available
      if (accessToken) {
        console.log('⚠️ Using current accessToken as fallback');
        tokenRef.current = accessToken;
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

  // Position tracking (unchanged)
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
    }, 10000); // Increased interval

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

  // CRITICAL FIX: Enhanced device registration check
  const waitForDeviceRegistration = useCallback(async (deviceId, maxWaitTime = 30000) => {
    console.log('🔄 Waiting for device to be registered with Spotify...');
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        await rateLimiter.waitForRateLimit('/me/player/devices');
        const token = await getValidTokenForSpotify();
        
        const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const ourDevice = data.devices?.find(d => d.id === deviceId);
          
          if (ourDevice) {
            console.log('✅ Device found in Spotify devices list:', ourDevice.name);
            return true;
          }
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

  // CRITICAL FIX: Enhanced device checking with better 404 handling
  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
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
        console.log('⚠️ Got 404 when checking device - device might not be registered yet');
        
        // Try to check if device is in the devices list
        try {
          await rateLimiter.waitForRateLimit('/me/player/devices');
          const devicesResponse = await fetch('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (devicesResponse.ok) {
            const devicesData = await devicesResponse.json();
            const ourDevice = devicesData.devices?.find(d => d.id === deviceIdToCheck);
            
            if (ourDevice) {
              console.log('✅ Device exists in devices list but not active');
              setIsActive(false);
              return false;
            } else {
              console.log('❌ Device not found in devices list - might need re-initialization');
              deviceRegistrationAttempts.current++;
              
              if (deviceRegistrationAttempts.current >= maxDeviceRegistrationAttempts) {
                setError('Device not recognized by Spotify. Please refresh the page.');
                return false;
              }
            }
          }
        } catch (devicesError) {
          console.error('Error checking devices list:', devicesError);
        }
        
        return false;
      } else if (playerResponse.status === 429) {
        rateLimiter.handleRateLimitError();
        console.log('Device check rate limited');
        return isActive;
      } else {
        console.error('Failed to check active device:', playerResponse.status);
        return isActive;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error checking active device:', err);
      }
      return isActive;
    }
  }, [deviceId, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, isActive]);

  // CRITICAL FIX: Enhanced player initialization with device registration verification
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
            cb('');
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
        console.error('❌ Authentication error in Spotify Player:', message);
        setError(`Spotify authentication error: ${message}`);
        
        setTimeout(async () => {
          console.log('🔄 Attempting to refresh auth after Spotify auth error...');
          try {
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

      spotifyPlayer.addListener('ready', async ({ device_id }) => {
        console.log('✅ Spotify Player Ready with Device ID:', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;
        deviceRegistrationAttempts.current = 0;
        
        // CRITICAL FIX: Wait for device to be properly registered
        console.log('🔄 Waiting for device registration...');
        const isRegistered = await waitForDeviceRegistration(device_id);
        
        if (isRegistered) {
          console.log('✅ Device successfully registered with Spotify');
          // Check if device is active after a delay
          setTimeout(() => {
            checkActiveDevice(device_id);
          }, 3000);
        } else {
          console.log('⚠️ Device registration timeout - will retry on user interaction');
          setError('Device registration delayed. Try playing a track to activate.');
        }
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
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice, apiRequest, waitForDeviceRegistration]);

  // Initialize when we have access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && mounted) {
      console.log('🔍 Access token available, initializing player...');
      setTimeout(() => {
        if (mounted) {
          initializePlayer();
        }
      }, 3000); // Increased delay for better stability
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
    }, 30000); // Increased to 30 seconds
    
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  // CRITICAL FIX: Enhanced transfer playback with device registration check
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer playback: missing deviceId');
      return false;
    }

    console.log('🔄 Attempting to transfer playback to device:', deviceId);

    try {
      // First, ensure device is registered
      const isRegistered = await waitForDeviceRegistration(deviceId, 10000);
      if (!isRegistered) {
        console.log('❌ Device not registered, cannot transfer playback');
        setError('Device not recognized by Spotify. Please refresh the page.');
        return false;
      }

      await rateLimiter.waitForRateLimit('/me/player');
      
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // Increased timeout
      
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
        
        // Wait and check multiple times with exponential backoff
        let attempts = 0;
        const maxAttempts = 6;
        
        const checkTransfer = async () => {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential delay
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
        const errorText = await response.text().catch(() => 'Device not found');
        console.error('❌ Transfer playback got 404:', errorText);
        setError('Device not recognized by Spotify. Try refreshing the page.');
        
        // Reset device registration attempts to trigger re-check
        deviceRegistrationAttempts.current = 0;
        return false;
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
  }, [deviceId, getValidTokenForSpotify, checkActiveDevice, waitForDeviceRegistration]);

  // Enhanced playTrack with better device management
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId) {
      console.error('Player not ready or missing deviceId');
      setError('Player not ready. Please wait or refresh the page.');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, attempting to transfer playback...');
      const transferred = await transferPlayback();
      if (!transferred) {
        return false;
      }
      
      // Wait longer for transfer to complete
      await new Promise(resolve => setTimeout(resolve, 6000));
    }

    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      
      const token = await getValidTokenForSpotify();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
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
        setError(null); // Clear any previous errors
        return true;
      } else if (response.status === 404) {
        const errorText = await response.text().catch(() => 'Device not found');
        console.error('❌ Playback got 404:', errorText);
        setError('Device not found. Please activate device first or refresh the page.');
        return false;
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

  // Other controls remain the same but with better error handling
  const togglePlay = useCallback(async () => {
    if (!player) {
      setError('Player not ready');
      return;
    }
    try {
      await rateLimiter.waitForRateLimit('togglePlay');
      await player.togglePlay();
      setTimeout(async () => {
        try {
          const state = await player.getCurrentState();
          if (state) {
            isPlayingRef.current = !state.paused;
          }
        } catch (err) {
          console.error('Error getting state after toggle:', err);
        }
      }, 100);
    } catch (err) {
      console.error('Error toggling play:', err);
      setError('Failed to toggle playback');
    }
  }, [player]);

  const nextTrack = useCallback(async () => {
    if (player) {
      try {
        await rateLimiter.waitForRateLimit('nextTrack');
        await player.nextTrack();
      } catch (err) {
        console.error('Error skipping to next track:', err);
        setError('Failed to skip track');
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
        setError('Failed to go to previous track');
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
        setError('Failed to seek');
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
        setError('Failed to set volume');
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