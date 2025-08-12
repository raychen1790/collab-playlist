// client/src/hooks/useSpotifyWebPlayback.js
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

const SPOTIFY_PLAYER_NAME = 'PlaylistVotes Player';

// Cross-browser timeout signal
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// Simple rate limiter
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.globalCooldown = 0;
  }
  async waitForRateLimit(endpoint) {
    const now = Date.now();
    if (now < this.globalCooldown) {
      await new Promise(r => setTimeout(r, this.globalCooldown - now));
    }
    const key = endpoint || 'global';
    const last = this.requests.get(key) || 0;
    const minInterval = 1000;
    const delta = now - last;
    if (delta < minInterval) await new Promise(r => setTimeout(r, minInterval - delta));
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
  const initializationInProgress = useRef(false);
  const lastSuccessfulToken = useRef(null);
  const readyTimeoutRef = useRef(null);
  const sdkLoadedRef = useRef(false);
  const initTimerRef = useRef(null);

  // position tracking refs
  const positionUpdateIntervalRef = useRef(null);
  const lastPositionRef = useRef(0);
  const lastUpdateTimeRef = useRef(Date.now());
  const isPlayingRef = useRef(false);

  const { accessToken, getFreshToken } = useContext(AuthContext);

  // Token getter (best-effort probe, never blocks)
  const getValidTokenForSpotify = useCallback(async () => {
    console.log('🎵 Getting token for Spotify Web Playback...');
    try {
      const freshToken = await getFreshToken();
      if (!freshToken) throw new Error('No token from auth flow');
      try {
        await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${freshToken}` },
          signal: timeoutSignal(5000),
        });
      } catch {/* ignore */}
      lastSuccessfulToken.current = freshToken;
      return freshToken;
    } catch (err) {
      console.error('❌ Token getter failed:', err);
      if (lastSuccessfulToken.current) return lastSuccessfulToken.current;
      throw new Error(`Token error: ${err.message}`);
    }
  }, [getFreshToken]);

  // Load SDK
  const loadSpotifyScript = useCallback(() => {
    return new Promise((resolve, reject) => {
      console.log('📦 Loading Spotify Web Playback SDK...');
      if (window.Spotify) {
        delete window.Spotify;
        delete window.onSpotifyWebPlaybackSDKReady;
      }
      const existing = document.querySelector('script[src*="spotify-player.js"]');
      if (existing) existing.remove();

      window.onSpotifyWebPlaybackSDKReady = () => {
        delete window.onSpotifyWebPlaybackSDKReady;
        if (window.Spotify?.Player) {
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
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Spotify SDK load timeout - callback never fired'));
      }, 20000);

      script.onerror = () => {
        clearTimeout(loadTimeout);
        delete window.onSpotifyWebPlaybackSDKReady;
        reject(new Error('Failed to load Spotify Web Playback SDK script'));
      };

      document.head.appendChild(script);
    });
  }, []);

  // Position tracking
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
              const base = prev ? { ...prev } : {};
              return { ...base, ...state, position: state.position };
            });
          }
        } catch (e) {
          console.error('Error getting current state:', e);
        }
      }
    }, 5000);

    const smoothInterval = setInterval(() => {
      if (isPlayingRef.current && playerState?.duration) {
        const now = Date.now();
        const dt = now - lastUpdateTimeRef.current;
        const pos = Math.min(lastPositionRef.current + dt, playerState.duration);
        setPlayerState(prev => (prev ? { ...prev, position: pos } : prev));
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

  // Device registration wait
  const waitForDeviceRegistration = useCallback(async (id, maxWaitTime = 20000) => {
    if (!id) return false;
    console.log('🔄 Waiting for device registration...');
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      try {
        await rateLimiter.waitForRateLimit('/me/player/devices');
        const token = await getValidTokenForSpotify();
        const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
          headers: { Authorization: `Bearer ${token}` },
          signal: timeoutSignal(8000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.devices?.some(d => d.id === id)) {
            console.log('✅ Device registered');
            return true;
          }
        } else if (resp.status === 429) {
          rateLimiter.handleRateLimitError();
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log('❌ Device registration timeout');
    return false;
  }, [getValidTokenForSpotify]);

  // Active device check
  const checkActiveDevice = useCallback(async (id = deviceId) => {
    if (!id) return false;
    try {
      await rateLimiter.waitForRateLimit('/me/player');
      const token = await getValidTokenForSpotify();
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
        signal: timeoutSignal(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const active = data.device?.id === id;
        setIsActive(active);
        if (active && data.is_playing) {
          isPlayingRef.current = true;
          startPositionUpdates();
        } else {
          isPlayingRef.current = false;
          stopPositionUpdates();
        }
        return active;
      } else if (resp.status === 204) {
        setIsActive(false);
        isPlayingRef.current = false;
        stopPositionUpdates();
        return false;
      } else if (resp.status === 404) {
        setIsActive(false);
        return false;
      } else if (resp.status === 429) {
        rateLimiter.handleRateLimitError();
        return isActive;
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error checking active device:', e);
    }
    return isActive;
  }, [deviceId, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, isActive]);

  // Initialize player
  const initializePlayer = useCallback(async () => {
    if (initializationInProgress.current) {
      console.log('🔄 Initialization already in progress, skipping');
      return;
    }
    console.log('🔄 Initializing Spotify Player...');

    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    if (!isSecure) {
      setError('Spotify Web Playback requires HTTPS or localhost.');
      return;
    }

    // Cleanup previous instance if any
    if (playerRef.current) {
      try { await playerRef.current.disconnect(); } catch {}
      playerRef.current = null;
      setPlayer(null);
    }

    // reset state
    setIsReady(false);
    setIsActive(false);
    setDeviceId(null);
    setPlayerState(null);
    stopPositionUpdates();

    initializationInProgress.current = true;

    try {
      const spotify = await loadSpotifyScript();

      try {
        await getValidTokenForSpotify();
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
            cb(await getValidTokenForSpotify());
          } catch (err) {
            console.error('❌ Failed to get token for Spotify Player:', err);
            setError(`Authentication failed: ${err.message}`);
            cb('');
          }
        },
        volume: 0.5,
      });

      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('❌ Initialization error:', message);
        setError(`Initialization error: ${message}`);
      });
      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('❌ Authentication error:', message);
        setError(`Authentication error: ${message}`);
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          setTimeout(() => initializePlayer(), 3000);
        }
      });
      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('❌ Account error:', message);
        setError(`Account error: ${message}. Spotify Premium required.`);
      });
      spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('❌ Playback error:', message);
        setError(`Playback error: ${message}`);
        setTimeout(() => setError(null), 5000);
      });

      spotifyPlayer.addListener('player_state_changed', (state) => {
        if (state) {
          const isNowPlaying = !state.paused;
          isPlayingRef.current = isNowPlaying;
          lastPositionRef.current = state.position;
          lastUpdateTimeRef.current = Date.now();
          setPlayerState(state);
          if (isNowPlaying) startPositionUpdates();
          else stopPositionUpdates();
        } else {
          isPlayingRef.current = false;
          setPlayerState(null);
          stopPositionUpdates();
        }
      });

      spotifyPlayer.addListener('ready', async ({ device_id }) => {
        console.log('🎉 Spotify Player Ready! Device ID:', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
        retryCountRef.current = 0;

        setTimeout(async () => {
          const reg = await waitForDeviceRegistration(device_id);
          if (reg) {
            setTimeout(() => checkActiveDevice(device_id), 2000);
          } else {
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

      readyTimeoutRef.current = setTimeout(async () => {
        console.error('❌ Ready event timeout');
        try {
          const fallbackId = spotifyPlayer._options?.id || spotifyPlayer.device_id;
          if (fallbackId) {
            setDeviceId(fallbackId);
            setIsReady(true);
            setError(null);
            setTimeout(() => checkActiveDevice(fallbackId), 3000);
            return;
          }
          const test = await spotifyPlayer.getCurrentState();
          if (test !== null) {
            setIsReady(true);
            setError(null);
            return;
          }
        } catch (err) {
    console.log('❌ Fallback detection failed:', err);
  }
        console.error('❌ Player connection timeout - all methods failed');
  setError('Player connection timeout. Please refresh and try again.');
}, 30000);

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
        setTimeout(() => initializePlayer(), 5000 * retryCountRef.current);
      } else {
        setError('Failed to initialize after multiple attempts. Please refresh.');
      }
    } finally {
      initializationInProgress.current = false;
    }
  }, [loadSpotifyScript, getValidTokenForSpotify, startPositionUpdates, stopPositionUpdates, checkActiveDevice, waitForDeviceRegistration]);

  // Init effect (NO disconnect in cleanup; no `player` dep)
  useEffect(() => {
    if (accessToken && !playerRef.current && !initializationInProgress.current) {
      console.log('🔍 Access token available, initializing player...');
      initTimerRef.current = setTimeout(() => {
        if (!playerRef.current && !initializationInProgress.current) initializePlayer();
      }, 500);
    }
    // on token change, just clear pending init timer
    return () => {
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [accessToken, initializePlayer]);

  // Unmount-only cleanup (prevents loop on state changes)
  useEffect(() => {
    return () => {
      initializationInProgress.current = false;
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
      stopPositionUpdates();
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      if (playerRef.current) {
        console.log('🔌 Disconnecting player...');
        playerRef.current.disconnect().catch(() => {});
        playerRef.current = null;
      }
      if (window.onSpotifyWebPlaybackSDKReady) {
        delete window.onSpotifyWebPlaybackSDKReady;
      }
    };
  }, [stopPositionUpdates]);

  // Periodic device checking
  useEffect(() => {
    if (!isReady || !deviceId) return;
    const interval = setInterval(() => {
      checkActiveDevice(deviceId);
    }, 30000);
    return () => clearInterval(interval);
  }, [isReady, deviceId, checkActiveDevice]);

  // Transfer playback
  const transferPlayback = useCallback(async () => {
    if (!deviceId) return false;
    console.log('🔄 Transferring playback to device:', deviceId);
    try {
      const reg = await waitForDeviceRegistration(deviceId, 10000);
      if (!reg) {
        setError('Device not recognized by Spotify. Please refresh the page.');
        return false;
      }
      await rateLimiter.waitForRateLimit('/me/player');
      const token = await getValidTokenForSpotify();
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
        signal: timeoutSignal(15000),
      });
      if (resp.ok || resp.status === 202) {
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
          if (await checkActiveDevice(deviceId)) return true;
        }
        return true;
      } else if (resp.status === 404) {
        setError('Device not found by Spotify. Try refreshing the page.');
        return false;
      } else if (resp.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before trying again.');
        return false;
      }
      setError(`Failed to activate device: ${resp.status}`);
    } catch (e) {
      if (e.name !== 'AbortError') setError(`Error activating device: ${e.message}`);
    }
    return false;
  }, [deviceId, getValidTokenForSpotify, checkActiveDevice, waitForDeviceRegistration]);

  // Playback controls
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!playerRef.current || !deviceId) {
      setError('Player not ready. Please wait or refresh the page.');
      return false;
    }
    if (!isActive) {
      const transferred = await transferPlayback();
      if (!transferred) return false;
      await new Promise(r => setTimeout(r, 1000));
    }
    try {
      await rateLimiter.waitForRateLimit('/me/player/play');
      const token = await getValidTokenForSpotify();
      const resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [spotifyUri], position_ms: positionMs }),
        signal: timeoutSignal(15000),
      });
      if (resp.ok || resp.status === 202) {
        isPlayingRef.current = true;
        startPositionUpdates();
        setError(null);
        return true;
      } else if (resp.status === 404) {
        setError('Device not found. Please activate device or refresh.');
      } else if (resp.status === 429) {
        rateLimiter.handleRateLimitError();
        setError('Rate limited. Please wait before playing.');
      } else {
        setError(`Playback failed: ${resp.status}`);
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(`Error playing track: ${e.message}`);
    }
    return false;
  }, [deviceId, isActive, transferPlayback, startPositionUpdates, getValidTokenForSpotify]);

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) { setError('Player not ready'); return; }
    try { await playerRef.current.togglePlay(); }
    catch (e) { setError('Failed to toggle playback'); }
  }, []);

  const nextTrack = useCallback(async () => {
    if (!playerRef.current) return;
    try { await playerRef.current.nextTrack(); }
    catch { setError('Failed to skip track'); }
  }, []);
  const previousTrack = useCallback(async () => {
    if (!playerRef.current) return;
    try { await playerRef.current.previousTrack(); }
    catch { setError('Failed to go to previous track'); }
  }, []);
  const seek = useCallback(async (pos) => {
    if (!playerRef.current) return;
    try {
      await playerRef.current.seek(pos);
      lastPositionRef.current = pos;
      lastUpdateTimeRef.current = Date.now();
      setPlayerState(prev => (prev ? { ...prev, position: pos } : prev));
    } catch { setError('Failed to seek'); }
  }, []);
  const setPlayerVolume = useCallback(async (v) => {
    if (!playerRef.current) return;
    try { await playerRef.current.setVolume(v); setVolume(v); }
    catch { setError('Failed to set volume'); }
  }, []);
  const getCurrentState = useCallback(async () => {
    if (!playerRef.current) return null;
    try { return await playerRef.current.getCurrentState(); }
    catch { return null; }
  }, []);

  // User-gesture activation (Safari/iOS)
  const activateAudio = useCallback(async () => {
    try {
      if (!playerRef.current?.activateElement) return false;
      await playerRef.current.activateElement();
      console.log('🔊 Audio element activated');
      return true;
    } catch (e) {
      console.log('⚠️ Failed to activate audio element:', e);
      return false;
    }
  }, []);

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
    activateAudio,

    isPlaying: !!(playerState && !playerState.paused),
    currentTrack: playerState?.track_window?.current_track,
    position: playerState?.position || 0,
    duration: playerState?.duration || 0,
  };
}
