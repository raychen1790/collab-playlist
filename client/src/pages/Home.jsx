// client/src/pages/Home.jsx - Modern redesign with glassmorphism
import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext.jsx';
import { Music, Plus, ArrowRight, Sparkles } from 'lucide-react';

/* ----------  unauthenticated view ---------- */
function LoginScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-6 shadow-lg shadow-blue-500/25">
            <Music size={32} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-4">
            Collaborative Playlist
          </h1>
          <p className="text-gray-600 text-lg leading-relaxed">
            Create shared playlists where everyone can vote on their favorite tracks
          </p>
        </div>

        {/* Features */}
        <div className="glass-card p-6 mb-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Music size={16} className="text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Real-time voting</p>
                <p className="text-sm text-gray-500">Vote up or down on any track</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <Sparkles size={16} className="text-purple-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Live playback</p>
                <p className="text-sm text-gray-500">Stream directly from Spotify</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <Plus size={16} className="text-green-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Easy sharing</p>
                <p className="text-sm text-gray-500">Share room links with friends</p>
              </div>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <a
          href="http://127.0.0.1:4000/auth/login"
          className="btn-primary w-full text-center inline-flex items-center justify-center gap-2 no-underline"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" className="fill-current">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Continue with Spotify
          <ArrowRight size={16} />
        </a>

        <p className="text-center text-xs text-gray-500 mt-4">
          Requires Spotify Premium for full playback features
        </p>
      </div>
    </div>
  );
}

/* ----------  authenticated view ---------- */
function AuthedHome() {
  const nav = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [playlistInput, setPlaylistInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState('');

  const getPlaylistId = (inp) => {
    try { return new URL(inp).pathname.split('/').pop(); }
    catch { return inp.trim(); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const playlistId = getPlaylistId(playlistInput);
    if (!roomName || !playlistId) return alert('Both fields required');

    setCreating(true);
    const res = await fetch('http://127.0.0.1:4000/api/rooms', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName, spotifyPlaylistId: playlistId }),
    });
    setCreating(false);

    if (res.ok) {
      const { room } = await res.json();
      nav(`/rooms/${room.id}`);
    } else {
      const { error } = await res.json();
      alert(error);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    nav(`/rooms/${joinId.trim()}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full mx-4 space-y-6">
        
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-6 shadow-lg shadow-blue-500/25">
            <Music size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-2">
            Welcome back!
          </h1>
          <p className="text-gray-600">Create a new room or join an existing one</p>
        </div>

        {/* Create Room */}
        <div className="glass-card p-6">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <Plus size={16} className="text-green-600" />
              </div>
              <h2 className="text-lg font-semibold">Create a Room</h2>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room Name
              </label>
              <input 
                value={roomName} 
                onChange={e => setRoomName(e.target.value)}
                placeholder="My awesome playlist"
                className="input-modern"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Spotify Playlist
              </label>
              <input 
                value={playlistInput} 
                onChange={e => setPlaylistInput(e.target.value)}
                placeholder="Paste Spotify playlist URL or ID"
                className="input-modern"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                You can paste the full Spotify URL or just the playlist ID
              </p>
            </div>
            
            <button 
              type="submit" 
              disabled={creating}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <div className="loading-spinner w-4 h-4 mr-2"></div>
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={16} className="mr-2" />
                  Create Room
                </>
              )}
            </button>
          </form>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gradient-to-br from-blue-50 to-purple-50 text-gray-500">or</span>
          </div>
        </div>

        {/* Join Room */}
        <div className="glass-card p-6">
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <ArrowRight size={16} className="text-blue-600" />
              </div>
              <h2 className="text-lg font-semibold">Join a Room</h2>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room ID
              </label>
              <input 
                value={joinId} 
                onChange={e => setJoinId(e.target.value)}
                placeholder="Enter room ID (UUID)"
                className="input-modern"
                required
              />
            </div>
            
            <button 
              type="submit"
              className="btn-secondary w-full"
            >
              <ArrowRight size={16} className="mr-2" />
              Join Room
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ----------  top-level Home ---------- */
export default function Home() {
  const { user } = useContext(AuthContext);
  return user ? <AuthedHome /> : <LoginScreen />;
}