// client/src/contexts/AuthContext.jsx - IMPROVED VERSION with better rate limiting and error handling
import { createContext, useState, useEffect, useCallback, useRef } from 'react';

export const AuthContext = createContext();

// Simple rate limiter for API requests
class ApiRateLimiter {
  constructor() {
    this.lastRequest = 0;
    this.minInterval = 1000; // Minimum 1 second between API requests
    this.rateLimitCooldown = 0;
  }

  async waitIfNeeded() {
    const now = Date.now();
    
    // Check if we're in a rate limit cooldown
    if (now < this.rateLimitCooldown) {
      const waitTime = this.rateLimitCooldown - now;
      console.log(`⏳ API rate limit cooldown: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Ensure minimum interval between requests
    const timeSinceLastRequest = now - this.lastRequest;
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequest = Date.now();
  }

  handleRateLimitError(retryAfter = 5) {
    // Set cooldown based on Retry-After header or default to 5 seconds
    this.rateLimitCooldown = Date.now() + (retryAfter * 1000);
    console.log(`🚫 API rate limited - setting ${retryAfter}s cooldown`);
  }
}

const apiRateLimiter = new ApiRateLimiter();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(null);
  
  // Use environment variable for API URL, fallback to local dev
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  // Token caching
  const tokenCache = useRef({
    token: null,
    expiresAt: 0,
    refreshPromise: null
  });

  console.log('🔍 API_URL:', API_URL);

  const storeToken = useCallback((token, user) => {
    setAccessToken(token);
    setUser(user);
    
    // Cache token with estimated expiration (50 minutes for safety)
    if (token) {
      tokenCache.current = {
        token,
        expiresAt: Date.now() + (50 * 60 * 1000), // 50 minutes
        refreshPromise: null
      };
    } else {
      tokenCache.current = {
        token: null,
        expiresAt: 0,
        refreshPromise: null
      };
    }
    
    if (token && user) {
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { token, user, timestamp: Date.now() }
      }));
    }
  }, []);

  const clearAuth = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    tokenCache.current = {
      token: null,
      expiresAt: 0,
      refreshPromise: null
    };
    window.dispatchEvent(new CustomEvent('authStateChanged', {
      detail: { token: null, user: null, timestamp: Date.now() }
    }));
  }, []);

  const handleAuthError = useCallback((error, context) => {
    console.error(`🚨 Auth error in ${context}:`, error);
    
    if (error.status === 429) {
      apiRateLimiter.handleRateLimitError(5);
      return false; // Don't clear auth for rate limits
    }
    
    if (error.status === 401 || 
        error.message?.includes('401') || 
        error.message?.includes('unauthorized') ||
        error.message?.includes('reauth_required')) {
      console.log('🗑️ Clearing auth state due to unauthorized error');
      clearAuth();
      
      if (!window.location.pathname.includes('/login') && 
          !window.location.search.includes('auth_tokens') &&
          !window.location.search.includes('error=')) {
        console.log('🔄 Redirecting to re-authenticate');
        setTimeout(() => {
          window.location.href = `${API_URL}/auth/login`;
        }, 1000);
      }
      return true; // Auth was cleared
    }
    
    return false;
  }, [API_URL, clearAuth]);

  useEffect(() => {
    console.log('🔍 AuthContext initializing...');
    handleAuth();
  }, []);

  const handleAuth = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const encodedTokens = urlParams.get('auth_tokens');
      
      if (encodedTokens) {
        console.log('🔍 Found tokens in URL, processing...');
        await handleUrlTokens(encodedTokens);
        
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        
        setLoading(false);
        return;
      }

      const error = urlParams.get('error');
      if (error) {
        console.error('🔍 Auth error in URL:', error);
        clearAuth();
        setLoading(false);
        return;
      }

      console.log('🔍 Checking existing session...');
      await checkExistingSession();
      
    } catch (err) {
      handleAuthError(err, 'handleAuth');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlTokens = async (encodedTokens) => {
    try {
      const tokenData = JSON.parse(decodeURIComponent(encodedTokens));
      console.log('🔍 Decoded token data:', { 
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in
      });

      if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
        console.log('🔍 Tokens expired, falling back to regular auth');
        await checkExistingSession();
        return;
      }

      storeToken(tokenData.access_token, null);

      try {
        await apiRateLimiter.waitIfNeeded();
        
        const storeResponse = await fetch(`${API_URL}/auth/store-tokens`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenData.access_token}`
          },
          body: JSON.stringify({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in
          })
        });

        if (storeResponse.ok) {
          const data = await storeResponse.json();
          console.log('🔍 Tokens stored successfully:', data.user?.display_name);
          storeToken(tokenData.access_token, data.user);
        } else if (storeResponse.status === 429) {
          const retryAfter = storeResponse.headers.get('Retry-After') || 5;
          apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
          console.log('Store tokens rate limited, but token is valid');
          await verifyToken(tokenData.access_token);
        } else {
          const errorData = await storeResponse.json().catch(() => ({}));
          console.error('🔍 Failed to store tokens:', storeResponse.status, errorData);
          await verifyToken(tokenData.access_token);
        }
      } catch (storeError) {
        console.error('🔍 Store tokens request failed:', storeError);
        await verifyToken(tokenData.access_token);
      }
    } catch (err) {
      console.error('🔍 Error handling URL tokens:', err);
      await checkExistingSession();
    }
  };

  const verifyToken = async (token) => {
    try {
      await apiRateLimiter.waitIfNeeded();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const userData = await response.json();
        storeToken(token, userData);
        return true;
      } else if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 5;
        apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
        // Still consider token valid for now
        storeToken(token, { display_name: 'User' });
        return true;
      }
      return false;
    } catch (err) {
      console.error('Token verification failed:', err);
      return false;
    }
  };

  const checkExistingSession = async (retryCount = 0) => {
    try {
      console.log(`🔍 Fetching from: ${API_URL}/auth/me (attempt ${retryCount + 1})`);
      
      await apiRateLimiter.waitIfNeeded();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      console.log('🔍 Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('🔍 Response data:', data);
        
        if (data.user) {
          const token = await getStoredToken();
          storeToken(token, data.user);
        } else {
          clearAuth();
        }
      } else if (response.status === 401) {
        console.log('🔍 401 response - user not authenticated');
        clearAuth();
      } else if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 5;
        apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
        
        if (retryCount < 2) {
          console.log(`🔄 Rate limited, retrying session check in ${retryAfter}s...`);
          setTimeout(() => checkExistingSession(retryCount + 1), retryAfter * 1000);
        } else {
          console.log('🔍 Too many rate limits, proceeding without auth');
          clearAuth();
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('🔍 Session check error:', err);
      
      if (retryCount < 2 && (err.name === 'AbortError' || err.message.includes('fetch'))) {
        console.log(`🔄 Retrying session check (${retryCount + 1}/3)...`);
        setTimeout(() => checkExistingSession(retryCount + 1), 2000 * (retryCount + 1));
      } else {
        clearAuth();
      }
    }
  };

  // Enhanced token getter with caching and rate limiting
  const getStoredToken = async () => {
    const now = Date.now();
    const cache = tokenCache.current;
    
    // Return cached token if it's still valid
    if (cache.token && now < cache.expiresAt) {
      return cache.token;
    }
    
    // If there's already a refresh in progress, wait for it
    if (cache.refreshPromise) {
      return await cache.refreshPromise;
    }
    
    // Start token refresh
    cache.refreshPromise = (async () => {
      try {
        await apiRateLimiter.waitIfNeeded();
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(`${API_URL}/auth/token`, {
          credentials: 'include',
          headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          if (data.access_token) {
            console.log('🔄 Got fresh token from server');
            const newToken = data.access_token;
            
            // Update cache
            tokenCache.current = {
              token: newToken,
              expiresAt: now + (50 * 60 * 1000), // 50 minutes
              refreshPromise: null
            };
            
            setAccessToken(newToken);
            return newToken;
          }
        } else if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || 5;
          apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
          // Return current token as fallback
          return accessToken;
        } else {
          console.error('Failed to get stored token:', response.status);
          throw new Error(`Token refresh failed: ${response.status}`);
        }
      } catch (err) {
        console.error('Failed to refresh token:', err);
        cache.refreshPromise = null;
        throw err;
      } finally {
        cache.refreshPromise = null;
      }
    })();
    
    return await cache.refreshPromise || accessToken;
  };

  // Enhanced API request function with better rate limiting
  const apiRequest = useCallback(async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
    
    const makeRequest = async (token = null, attempt = 1) => {
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const config = {
        ...options,
        headers,
        credentials: 'include',
      };

      console.log(`🌐 API Request: ${options.method || 'GET'} ${url} (attempt ${attempt})`, {
        hasToken: !!token,
        hasCredentials: true,
      });

      await apiRateLimiter.waitIfNeeded();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          ...config,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || 5;
          apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
          
          if (attempt < 3) {
            console.log(`🔄 Rate limited, retrying in ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
            return makeRequest(token, attempt + 1);
          } else {
            throw new Error(`Rate limited after ${attempt} attempts`);
          }
        }
        
        return response;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    };

    try {
      // First attempt with current token
      let response = await makeRequest(accessToken);
      
      // If we get 401 and we have an access token, try to refresh
      if (response.status === 401 && accessToken) {
        console.log('🔄 401 error with existing token, attempting refresh...');
        try {
          const freshToken = await getStoredToken();
          if (freshToken && freshToken !== accessToken) {
            response = await makeRequest(freshToken);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          // Continue with original response
        }
      }
      
      // Handle auth errors
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.reauth_required) {
          console.log('🔄 Re-authentication required');
          handleAuthError({ status: 401, message: 'reauth_required' }, 'apiRequest');
        }
      }
      
      return response;
    } catch (error) {
      console.error('🚨 API Request failed:', error);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      } else if (!navigator.onLine) {
        throw new Error('No internet connection');
      } else {
        throw error;
      }
    }
  }, [API_URL, accessToken, handleAuthError]);

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', {
        method: 'POST'
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearAuth();
    }
  };

  // Enhanced getFreshToken for Web Playback SDK
  const getFreshToken = useCallback(async () => {
    const now = Date.now();
    const cache = tokenCache.current;
    
    // If we have a cached valid token, return it
    if (cache.token && now < cache.expiresAt) {
      return cache.token;
    }
    
    // If current accessToken is recent, validate it first
    if (accessToken && now < cache.expiresAt) {
      try {
        await apiRateLimiter.waitIfNeeded();
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (response.ok) {
          return accessToken;
        } else if (response.status === 429) {
          // Rate limited but token might still be valid
          return accessToken;
        }
      } catch (err) {
        console.log('Token validation failed, getting fresh token...', err.message);
      }
    }
    
    // Get fresh token from server
    try {
      return await getStoredToken();
    } catch (err) {
      console.error('Failed to get fresh token:', err);
      return accessToken; // Fallback to current token
    }
  }, [accessToken]);

  const value = {
    user,
    setUser,
    loading,
    accessToken,
    logout,
    apiRequest,
    getFreshToken,
    forceReauth: () => {
      console.log('🔄 Force re-authentication triggered');
      clearAuth();
      window.location.href = `${API_URL}/auth/login`;
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}