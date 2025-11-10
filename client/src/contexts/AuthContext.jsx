// client/src/contexts/AuthContext.jsx 
import { createContext, useState, useEffect, useCallback, useRef } from 'react';

export const AuthContext = createContext();

// Simplified rate limiter
class ApiRateLimiter {
  constructor() {
    this.lastRequest = 0;
    this.minInterval = 1000;
    this.rateLimitCooldown = 0;
  }

  async waitIfNeeded() {
    const now = Date.now();
    
    if (now < this.rateLimitCooldown) {
      const waitTime = this.rateLimitCooldown - now;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    const timeSinceLastRequest = now - this.lastRequest;
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequest = Date.now();
  }

  handleRateLimitError(retryAfter = 5) {
    this.rateLimitCooldown = Date.now() + (retryAfter * 1000);
  }
}

const apiRateLimiter = new ApiRateLimiter();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(null);
  
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  // Single source of truth for tokens
  const tokenRef = useRef({
    current: null,
    lastRefresh: 0,
    refreshPromise: null
  });

  const storeToken = useCallback((token, user) => {
    setAccessToken(token);
    setUser(user);
    
    tokenRef.current.current = token;
    tokenRef.current.lastRefresh = Date.now();
    
    if (token && user) {
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { token, user, timestamp: Date.now() }
      }));
    }
  }, []);

  const clearAuth = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    tokenRef.current = { current: null, lastRefresh: 0, refreshPromise: null };
    
    window.dispatchEvent(new CustomEvent('authStateChanged', {
      detail: { token: null, user: null, timestamp: Date.now() }
    }));
  }, []);

  const handleAuthError = useCallback((error, context) => {
    console.error(`🚨 Auth error in ${context}:`, error);
    
    if (error.status === 429) {
      apiRateLimiter.handleRateLimitError(5);
      return false;
    }
    
    if (error.status === 401) {
      console.log('🗑️ Clearing auth state due to 401');
      clearAuth();
      
      if (!window.location.pathname.includes('/login') && 
          !window.location.search.includes('auth_tokens')) {
        setTimeout(() => {
          window.location.href = `${API_URL}/auth/login`;
        }, 1000);
      }
      return true;
    }
    
    return false;
  }, [API_URL, clearAuth]);

  useEffect(() => {
    handleAuth();
  }, []);

  const handleAuth = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const encodedTokens = urlParams.get('auth_tokens');
      
      if (encodedTokens) {
        console.log('🔍 Processing URL tokens...');
        await handleUrlTokens(encodedTokens);
        window.history.replaceState({}, document.title, window.location.pathname);
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

      await checkExistingSession();
      
    } catch (err) {
      console.error('Auth handling error:', err);
      handleAuthError(err, 'handleAuth');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlTokens = async (encodedTokens) => {
    try {
      const tokenData = JSON.parse(decodeURIComponent(encodedTokens));
      
      if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
        console.log('🔍 Tokens expired, checking session...');
        await checkExistingSession();
        return;
      }

      // Store token immediately
      storeToken(tokenData.access_token, null);

      // Try to store on server and get user info
      try {
        await apiRateLimiter.waitIfNeeded();
        
        const storeResponse = await fetch(`${API_URL}/auth/store-tokens`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenData.access_token}`
          },
          body: JSON.stringify(tokenData),
          signal: AbortSignal.timeout(10000)
        });

        if (storeResponse.ok) {
          const data = await storeResponse.json();
          console.log('✅ Tokens stored successfully');
          storeToken(tokenData.access_token, data.user);
        } else if (storeResponse.status === 429) {
          apiRateLimiter.handleRateLimitError(5);
          await verifyTokenDirectly(tokenData.access_token);
        } else {
          console.error('Failed to store tokens:', storeResponse.status);
          await verifyTokenDirectly(tokenData.access_token);
        }
      } catch (storeError) {
        console.error('Store tokens error:', storeError);
        await verifyTokenDirectly(tokenData.access_token);
      }
    } catch (err) {
      console.error('Error handling URL tokens:', err);
      await checkExistingSession();
    }
  };

  const verifyTokenDirectly = async (token) => {
    try {
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const userData = await response.json();
        storeToken(token, userData);
        return true;
      } else if (response.status === 429) {
        // Still consider valid but rate limited
        storeToken(token, { display_name: 'User' });
        return true;
      }
      return false;
    } catch (err) {
      console.error('Direct token verification failed:', err);
      return false;
    }
  };

  const checkExistingSession = async (retryCount = 0) => {
    try {
      await apiRateLimiter.waitIfNeeded();
      
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.user) {
          const token = await getTokenFromServer();
          storeToken(token, data.user);
        } else {
          clearAuth();
        }
      } else if (response.status === 401) {
        clearAuth();
      } else if (response.status === 429) {
        apiRateLimiter.handleRateLimitError(5);
        
        if (retryCount < 2) {
          setTimeout(() => checkExistingSession(retryCount + 1), 5000);
        } else {
          clearAuth();
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('Session check error:', err);
      
      if (retryCount < 2 && (err.name === 'AbortError' || err.message.includes('fetch'))) {
        setTimeout(() => checkExistingSession(retryCount + 1), 2000 * (retryCount + 1));
      } else {
        clearAuth();
      }
    }
  };

  // Simplified token getter for the Web Playback SDK
  const getTokenFromServer = async () => {
    const cache = tokenRef.current;
    
    // Return cached token if recent 45 min
    if (cache.current && Date.now() - cache.lastRefresh < 45 * 60 * 1000) {
      return cache.current;
    }
    
    // Prevent multiple simultaneous requests
    if (cache.refreshPromise) {
      return await cache.refreshPromise;
    }
    
    cache.refreshPromise = (async () => {
      try {
        await apiRateLimiter.waitIfNeeded();
        
        const response = await fetch(`${API_URL}/auth/token`, {
          credentials: 'include',
          headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
          signal: AbortSignal.timeout(8000)
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.access_token) {
            cache.current = data.access_token;
            cache.lastRefresh = Date.now();
            setAccessToken(data.access_token);
            return data.access_token;
          }
        } else if (response.status === 429) {
          apiRateLimiter.handleRateLimitError(5);
          return accessToken; // Return current as fallback
        } else {
          throw new Error(`Token refresh failed: ${response.status}`);
        }
      } catch (err) {
        console.error('Token refresh error:', err);
        throw err;
      } finally {
        cache.refreshPromise = null;
      }
      
      return accessToken;
    })();
    
    return await cache.refreshPromise;
  };

  // Enhanced API request function
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

      await apiRateLimiter.waitIfNeeded();

      try {
        const response = await fetch(url, {
          ...config,
          signal: AbortSignal.timeout(30000)
        });
        
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || 5;
          apiRateLimiter.handleRateLimitError(parseInt(retryAfter));
          
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
            return makeRequest(token, attempt + 1);
          }
        }
        
        return response;
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timed out');
        }
        throw fetchError;
      }
    };

    try {
      let response = await makeRequest(accessToken);
      
      // If 401 and we have a token, try refreshing
      if (response.status === 401 && accessToken) {
        try {
          const freshToken = await getTokenFromServer();
          if (freshToken && freshToken !== accessToken) {
            response = await makeRequest(freshToken);
          }
        } catch (refreshError) {
          console.error('Token refresh failed in apiRequest:', refreshError);
        }
      }
      
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.reauth_required) {
          handleAuthError({ status: 401, message: 'reauth_required' }, 'apiRequest');
        }
      }
      
      return response;
    } catch (error) {
      console.error('API Request failed:', error);
      
      if (!navigator.onLine) {
        throw new Error('No internet connection');
      }
      throw error;
    }
  }, [API_URL, accessToken, handleAuthError]);

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearAuth();
    }
  };

  //Simplified getFreshToken for Web Playback SDK
  const getFreshToken = useCallback(async () => {
    try {
      // Always try to get the latest token from server
      const freshToken = await getTokenFromServer();
      return freshToken || accessToken; // Fallback to current token
    } catch (err) {
      console.error('Failed to get fresh token:', err);
      return accessToken; // Return current token as last resort
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