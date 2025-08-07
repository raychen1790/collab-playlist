// client/src/hooks/useApi.js - Custom hook for authenticated API requests
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

export function useApi() {
  const { apiRequest, accessToken, user } = useContext(AuthContext);

  return {
    apiRequest,
    accessToken,
    user,
    isAuthenticated: !!user,
    hasToken: !!accessToken,
  };
}