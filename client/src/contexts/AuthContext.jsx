// client/src/contexts/AuthContext.jsx - FIXED VERSION with better error handling
import { createContext, useState, useEffect, useCallback } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(null);
  
  // Use environment variable for API URL, fallback to local dev
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  console.log('🔍 API_URL:', API_URL);

  // FIXED: Better error handling and retry logic
  const handleAuthError = useCallback((error, context) => {
    console.error(`🚨 Auth error in ${context}:`, error);
    
    // Only clear auth state for certain error types
    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      console.log('🗑️ Clearing auth state due to unauthorized error');
      setUser(null);
      setAccessToken(null);
      
      // Redirect to login if we're not already there
      if (!window.location.pathname.includes('/login') && !window.location.search.includes('auth_tokens')) {
        console.log('🔄 Redirecting to re-authenticate');
        window.location.href = `${API_URL}/auth/login`;
      }
    }
  }, [API_URL]);

  useEffect(() => {
    console.log('🔍 AuthContext initializing...');
    handleAuth();
  }, []);

  const handleAuth = async () => {
    try {
      // Check if we have tokens in the URL (from OAuth callback)
      const urlParams = new URLSearchParams(window.location.search);
      const encodedTokens = urlParams.get('auth_tokens');
      
      if (encodedTokens) {
        console.log('🔍 Found tokens in URL, processing...');
        await handleUrlTokens(encodedTokens);
        
        // Clean up the URL
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        
        setLoading(false);
        return;
      }

      // Check for error in URL
      const error = urlParams.get('error');
      if (error) {
        console.error('🔍 Auth error in URL:', error);
        setUser(null);
        setAccessToken(null);
        setLoading(false);
        return;
      }

      // No URL tokens, try regular cookie-based auth
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

      // Check if tokens are expired
      if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
        console.log('🔍 Tokens expired, falling back to regular auth');
        await checkExistingSession();
        return;
      }

      // Store tokens in memory for immediate use
      setAccessToken(tokenData.access_token);

      // Store tokens on backend with better error handling
      try {
        const storeResponse = await fetch(`${API_URL}/auth/store-tokens`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
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
          setUser(data.user);
        } else {
          const errorData = await storeResponse.json();
          console.error('🔍 Failed to store tokens:', storeResponse.status, errorData);
          // Still try to verify the token directly
          await verifyToken(tokenData.access_token);
        }
      } catch (storeError) {
        console.error('🔍 Store tokens request failed:', storeError);
        // Fallback to direct token verification
        await verifyToken(tokenData.access_token);
      }
    } catch (err) {
      console.error('🔍 Error handling URL tokens:', err);
      await checkExistingSession();
    }
  };

  const verifyToken = async (token) => {
    try {
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setAccessToken(token);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Token verification failed:', err);
      return false;
    }
  };

  // FIXED: Better session checking with retry logic
  const checkExistingSession = async (retryCount = 0) => {
    try {
      console.log(`🔍 Fetching from: ${API_URL}/auth/me (attempt ${retryCount + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
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
          setUser(data.user);
          // Try to get a fresh token for API calls
          await getStoredToken();
        } else {
          setUser(null);
          setAccessToken(null);
        }
      } else if (response.status === 401) {
        console.log('🔍 401 response - user not authenticated');
        setUser(null);
        setAccessToken(null);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('🔍 Session check error:', err);
      
      // Retry logic for network errors
      if (retryCount < 2 && (err.name === 'AbortError' || err.message.includes('fetch'))) {
        console.log(`🔄 Retrying session check (${retryCount + 1}/3)...`);
        setTimeout(() => checkExistingSession(retryCount + 1), 1000 * (retryCount + 1));
      } else {
        setUser(null);
        setAccessToken(null);
      }
    }
  };

  const getStoredToken = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${API_URL}/auth/token`, {
        credentials: 'include',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.access_token);
        return data.access_token;
      }
    } catch (err) {
      console.error('Failed to get stored token:', err);
    }
    return null;
  };

  // FIXED: Enhanced API fetch function with better error handling and retries
  const apiRequest = useCallback(async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
    
    const makeRequest = async (token = null) => {
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

      console.log(`🌐 API Request: ${options.method || 'GET'} ${url}`, {
        hasToken: !!token,
        hasCredentials: true,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch(url, {
          ...config,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
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
        const freshToken = await getStoredToken();
        if (freshToken && freshToken !== accessToken) {
          // Retry with fresh token
          response = await makeRequest(freshToken);
        }
      }
      
      // If still 401 and we have a user, redirect to re-auth
      if (response.status === 401 && user) {
        console.log('🔄 401 error persists, redirecting to re-authenticate');
        handleAuthError(new Error('401 unauthorized'), 'apiRequest');
      }
      
      return response;
    } catch (error) {
      console.error('🚨 API Request failed:', error);
      
      // Handle network errors gracefully
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      } else if (!navigator.onLine) {
        throw new Error('No internet connection');
      } else {
        throw error;
      }
    }
  }, [API_URL, accessToken, user, handleAuthError]);

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setAccessToken(null);
    }
  };

  const value = {
    user,
    setUser,
    loading,
    accessToken,
    logout,
    apiRequest,
    // FIXED: Add method to manually trigger re-authentication
    forceReauth: () => {
      console.log('🔄 Force re-authentication triggered');
      window.location.href = `${API_URL}/auth/login`;
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}