import { createContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  
  // Use environment variable for API URL, fallback to local dev
  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';
  
  // Debug logging
  console.log('🔍 API_URL:', API_URL);
  console.log('🔍 All env vars:', import.meta.env);

  useEffect(() => {
    // on app load, check if we have a valid session
    console.log('🔍 Fetching from:', `${API_URL}/auth/me`);
    
    fetch(`${API_URL}/auth/me`, {
      credentials: 'include'
    })
      .then(res => {
        console.log('🔍 Response status:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('🔍 Response data:', data);
        setUser(data.user || null);
      })
      .catch(err => {
        console.error('🔍 Fetch error:', err);
        setUser(null);
      });
  }, [API_URL]);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}