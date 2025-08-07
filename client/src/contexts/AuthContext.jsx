// client/src/contexts/AuthContext.jsx - Updated to handle URL-based tokens
import { createContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Use environment variable for API URL, fallback to local dev
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  // Debug logging
  console.log('🔍 API_URL:', API_URL);
  console.log('🔍 All env vars:', import.meta.env);

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
        setLoading(false);
        return;
      }

      // No URL tokens, try regular cookie-based auth
      console.log('🔍 Checking existing session...');
      await checkExistingSession();
      
    } catch (err) {
      console.error('🔍 Auth initialization error:', err);
      setUser(null);
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

      // Store tokens on backend via API call
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
        throw new Error('Failed to store tokens');
      }
    } catch (err) {
      console.error('🔍 Error handling URL tokens:', err);
      // Fallback to regular session check
      await checkExistingSession();
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
      
      setUser(data.user || null);
    } catch (err) {
      console.error('🔍 Fetch error:', err);
      setUser(null);
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
    }
  };

  const value = {
    user,
    setUser,
    loading,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}