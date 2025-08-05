// client/src/App.jsx
import { useContext } from 'react';
import { AuthContext } from './contexts/AuthContext';

// Get API URL from environment
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';

export default function App() {
  const { user } = useContext(AuthContext);

  const handleLogin = () => {
    // Use environment variable for the login URL
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div className="p-8">
      {user ? (
        <p>Welcome, {user.display_name}!</p>
      ) : (
        <button
          onClick={handleLogin}
          className="px-4 py-2 bg-green-600 text-white rounded"
        >
          Log in with Spotify
        </button>
      )}
    </div>
  );
}