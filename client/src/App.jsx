// client/src/App.jsx
import { useContext } from 'react';
import { AuthContext } from './contexts/AuthContext';

export default function App() {
  const { user } = useContext(AuthContext);

  const handleLogin = () => {
    // this must be the explicit loopback URL to your Express route:
    window.location.href = 'http://127.0.0.1:4000/auth/login';
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
