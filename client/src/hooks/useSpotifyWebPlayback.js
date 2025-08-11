// client/src/hooks/useSpotifyWebPlayback.js
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

// --- Utilities ---------------------------------------------------------------

// Cross-browser timeout signal (fallback if AbortSignal.timeout isn't supported)
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

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
    const minInterval = 1000; // 1s between same-endpoint calls
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.set(key, Date.now());
  }

  handleRateLimitError() {
    this.globalCooldown = Date.now() + 5000; // 5s cooldown
    console.log('🚫 Rate limited - setting 5s global cooldown');
  }
}

const rateLimiter = new RateLimiter();

// --- Hook --------------------------------------------------------------------

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

  const { accessToken, getFreshToken } = useContext(AuthContext);

  // === Token getter: return a fresh token; optional probe is best-effort only.
  const getValidTokenForSpotify = useCallback(async () => {
    console.log('🎵 Getting token for Spotify Web Playback...');
    try {
      const freshToken = await getFreshToken();
      if (!freshToken) throw new Error('No token from auth flow');

      // Optional: **best-effort** probe (never throw if it fails)
      try {
        await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${freshToken}` },
          signal: timeoutSignal(5000),
        });
      } catch {
        // ignore — scopes may not include user-read-private; SDK will still work if streaming scope is present
      }

      lastSuccessfulToken.current = freshToken;
      return freshToken;
    } catch (err) {
      console.error('❌ Token getter failed:', err);
      if (lastSuccessfulToken.current) {
        console.log('⚠️ Using last successful token as fallback');
        return lastSuccessfulToken.current;
      }
      throw new Error(`Token error: ${err.message}`);
    }
  }, [getFreshToken]);

  // === SDK loader with full cleanup & a firm timeout
  const loadSpotifyScript = useCallback(() => {
    return new Promise((resolve, reject) => {
      console.log('📦 Loading Spotify Web Playback SDK...');

      // Clean any existing SDK globals
      if (window.Spotify) {
        console.log('🧹 Cleaning up existing Spotify SDK...');
        delete window.Spotify;
        delete window.onSpotifyWebPlaybackSDKReady;
      }

      // Remove existing script
      const existingScript = document.querySelector('script[src*="spotify-player.js"]');
      if (existingScript) {
        console.log('🧹 Removing existing Spotify script...');
        existingScript.remove();
      }

      // Prepare the global callback *before* injecting
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('🎉 onSpotifyWebPlaybackSDKReady fired!');
        delete window.onSpotifyWebPlaybackSDKReady;
        if (window.Spotify?.Player) {
          console.log('✅ Spotify SDK ready');
          sdkLoadedRef.current = true;
          clearTimeout(loadTimeout);
          resolve(window.Spotify);
        } else {
          clearTimeout(loadTimeout);
          reject(new Error('Spotify SDK ready callback fired but no Player available'));
        }
      };

      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;

      const loadTimeout = setTimeout(() => {
        console.error('❌ Spotify SDK load timeout - callback never fired');
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Spotify SDK load timeout - callback never fired'));
      }, 20000);

      script.onerror = () => {
        console.error('❌ Failed to load Spotify Web Playback SDK script');
        clearTimeout(loadTimeout);
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Failed to load Spotify Web Playback SDK script'));
      };

      // We purposely do not resolve on onload; we wait for the global ready callback.
      document.head.appendChild(script);
    });
  }, []);

  // === Position tracking
  const startPositionUpdates = useCallback(() => {
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current.main);
      clearInterval(positionUpdateIntervalRef.current.smooth);
    }

    const mainInterval = setInterval(async () => {
      if (player && isActive && isPlayingRef.current) {
        try {
          const state = await player.getCurrentState();
          if (state && !state.paused) {
            lastPositionRef.current = state.position;
            lastUpdateTimeRef.current = Date.now();

            setPlayerState(prev => {
              // guard against null
              const base = prev ? { ...prev } : {};
              return { ...base, ...state, position: state.position };
            });
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

        setPlayerState(prev => {
          if (!prev) return prev;
          return { ...prev, position: interpolatedPosition };
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

  // === Wait for device registration
  const waitForDeviceRegistration = useCallback(async (id, maxWaitTime = 20000) => {
    if (!id) return false;
    console.log('🔄 Waiting for device registration...');
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        await rateLimiter.waitForRateLimit('/me/player/devices');
        const token = await getValidTokenForSpotify();

        const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
          headers: { Authorization: `Bearer ${token}` },
          signal: timeoutSignal(8000),
        });

        if (response.ok) {
          const data = await response.json();
          const ourDevice = data.devices?.find(d => d.id === id);
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

  // === Active device check
  const checkActiveDevice = useCallback(async (deviceIdToCheck = deviceId) => {
    if (!deviceIdToCheck) return false;

    try {
      await rateLimiter.waitForRateLimit('/me/player');
      const token = await getValidTokenForSpotify();

      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
        signal: timeoutSignal(10000),
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
      } else if (response.status === 404) {
        console.log('⚠️ 404 when checking device - device might not be registered');
        setIsActive(false);
        return false;
      } else if (response.status === 429) {
        rateLimiter.handleRateLimitError();
        return isActive; // keep current
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

  // === Player initialization
  const initializePlayer = useCallback(async () => {
    if (initializationInProgress.current) {
      console.log('🔄 Initialization already in progress, skipping');
      return;
    }
    initializationInProgress.current = true;

    try {
      console.log('🔄 Initializing Spotify Player...');

      // Secure context check (required by EME)
      const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
      if (!isSecure) {
        setError('Spotify Web Playback requires HTTPS or localhost.');
        initializationInProgress.current = false;
        return;
      }

      // Clean any existing player
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

      // Clear ready timeout
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

      // Quick auth smoke test (do not throw hard)
      try {
        await getValidTokenForSpotify();
        console.log('✅ Auth system working, token obtained');
      } catch (authErr) {
        console.error('❌ Auth system check failed:', authErr);
        setError('Authentication system not ready. Please refresh the page.');
        initializationInProgress.current = false;
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
            cb(''); // returning empty token will cause auth_error event
          }
        },
        volume: 0.5,
      });

      // Listeners (set up before connect)
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

      spotifyPlayer.addListener('ready', async ({ device_id }) => {
        console.log('🎉 Spotify Player Ready Event Fired! Device ID:', device_id);

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

      // Ready timeout with fallbacks
      readyTimeoutRef.current = setTimeout(async () => {
        console.error('❌ Ready event timeout - SDK connected but ready event never fired');

        try {
          // Fallback 1: internal id (may be undefined in some SDK versions)
          const fallbackDeviceId = spotifyPlayer._options?.id || spotifyPlayer.device_id;
          if (fallbackDeviceId) {
            console.log('🔍 Found fallback device ID:', fallbackDeviceId);
            setDeviceId(fallbackDeviceId);
            setIsReady(true);
            setError('Player ready (fallback detection)');
            initializationInProgress.current = false;
            setTimeout(() => checkActiveDevice(fallbackDeviceId), 3000);
            return;
          }

          // Fallback 2: connectivity test
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
      }, 30000);

      // Connect
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

  // Auto-initialize when we have an access token
  useEffect(() => {
    let mounted = true;

    if (accessToken && !player && !initializationInProgress.current && mounted) {
      console.log('🔍 Access token available, initializing player...');
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

  // === Transfer playback
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      console.error('Cannot transfer: missing deviceId');
      return false;
    }

    console.log('🔄 Transferring playback to device:', deviceId);

    try {
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
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
        signal: timeoutSignal(15000),
      });

      if (response.ok || response.status === 202) {
        console.log('✅ Transfer request successful');

        // Try a few times to see it become active
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          const active = await checkActiveDevice(deviceId);
          if (active) {
            console.log('✅ Device activated successfully');
            return true;
          }
        }

        console.log('⚠️ Transfer sent but device not yet active');
        return true;
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

  // === Playback controls
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!player || !deviceId) {
      setError('Player not ready. Please wait or refresh the page.');
      return false;
    }

    if (!isActive) {
      console.log('Device not active, transferring playback...');
      const transferred = await transferPlayback();
      if (!transferred) return false;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      const token = await getValidTokenForSpotify();

      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [spotifyUri],
          position_ms: positionMs,
        }),
        signal: timeoutSignal(15000),
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
    if (!player) return;
    try {
      await player.nextTrack();
    } catch (err) {
      console.error('Error skipping to next:', err);
      setError('Failed to skip track');
    }
  }, [player]);

  const previousTrack = useCallback(async () => {
    if (!player) return;
    try {
      await player.previousTrack();
    } catch (err) {
      console.error('Error going to previous:', err);
      setError('Failed to go to previous track');
    }
  }, [player]);

  const seek = useCallback(async (positionMs) => {
    if (!player) return;
    try {
      await player.seek(positionMs);
      lastPositionRef.current = positionMs;
      lastUpdateTimeRef.current = Date.now();
      setPlayerState(prev => {
        if (!prev) return prev;
        return { ...prev, position: positionMs };
      });
    } catch (err) {
      console.error('Error seeking:', err);
      setError('Failed to seek');
    }
  }, [player]);

  const setPlayerVolume = useCallback(async (v) => {
    if (!player) return;
    try {
      await player.setVolume(v);
      setVolume(v);
    } catch (err) {
      console.error('Error setting volume:', err);
      setError('Failed to set volume');
    }
  }, [player]);

  const getCurrentState = useCallback(async () => {
    if (!player) return null;
    try {
      return await player.getCurrentState();
    } catch (err) {
      console.error('Error getting state:', err);
      return null;
    }
  }, [player]);

  return {
    // state
    player,
    deviceId,
    isReady,
    isActive,
    playerState,
    volume,
    error,

    // controls
    playTrack,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume: setPlayerVolume,
    getCurrentState,
    transferPlayback,

    // derived
    isPlaying: !!(playerState && !playerState.paused),
    currentTrack: playerState?.track_window?.current_track,
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
  };
}
