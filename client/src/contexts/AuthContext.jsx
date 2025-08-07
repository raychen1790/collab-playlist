// client/src/contexts/AuthContext.jsx - Enhanced with token management
import { createContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(null);
  
  // Use environment variable for API URL, fallback to local dev
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  // Debug logging
  console.log('🔍 API_URL:', API_URL);

  useEffect(() => {
    console.log('🔍 AuthContext initializing...');
    handleAuth();
  }, [API_URL]);

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
      console.error('🔍 Auth initialization error:', err);
      setUser(null);
      setAccessToken(null);
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

      // Verify tokens are not expired
      if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
        console.log('🔍 Tokens expired, falling back to regular auth');
        await checkExistingSession();
        return;
      }

      // Store tokens in memory for immediate use
      setAccessToken(tokenData.access_token);

      // Also store tokens on backend via API call for cookie fallback
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
        console.error('🔍 Failed to store tokens:', storeResponse.status);
        // Even if storing fails, we can still use the token temporarily
        await verifyToken(tokenData.access_token);
      }
    } catch (err) {
      console.error('🔍 Error handling URL tokens:', err);
      // Fallback to regular session check
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

  const checkExistingSession = async () => {
    try {
      console.log('🔍 Fetching from:', `${API_URL}/auth/me`);
      
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include'
      });
      
      console.log('🔍 Response status:', response.status);
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
    } catch (err) {
      console.error('🔍 Fetch error:', err);
      setUser(null);
      setAccessToken(null);
    }
  };

  const getStoredToken = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/token`, {
        credentials: 'include'
      });
      
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

  // Enhanced API fetch function that includes token in headers
  const apiRequest = async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
    
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add token to Authorization header if available
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const config = {
      ...options,
      headers,
      credentials: 'include', // Still include cookies as fallback
    };

    console.log(`🌐 API Request: ${options.method || 'GET'} ${url}`, {
      hasToken: !!accessToken,
      hasCredentials: true,
    });

    try {
      const response = await fetch(url, config);
      
      // If we get 401 and we have no token, try to refresh
      if (response.status === 401 && !accessToken && user) {
        console.log('🔄 401 error, attempting to get fresh token...');
        const freshToken = await getStoredToken();
        if (freshToken) {
          // Retry with fresh token
          config.headers.Authorization = `Bearer ${freshToken}`;
          return await fetch(url, config);
        }
      }
      
      return response;
    } catch (error) {
      console.error('🚨 API Request failed:', error);
      throw error;
    }
  };

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
    apiRequest, // Expose the enhanced API request function
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}