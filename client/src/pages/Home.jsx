// client/src/pages/Home.jsx - Enhanced design with fun fonts and better layout
import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext.jsx';
import { Music, Plus, ArrowRight, Sparkles } from 'lucide-react';

// Get API URL from environment
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';

/* ----------  unauthenticated view ---------- */
function LoginScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center font-main">
      <div className="max-w-lg w-full mx-4">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-white/20 to-white/10 backdrop-blur-lg rounded-3xl mb-8 shadow-2xl border border-white/20">
            <Music size={48} className="text-white" />
          </div>
          <h1 className="text-5xl font-fun font-bold text-white mb-6 drop-shadow-lg">
            Collaborative Playlist
          </h1>
          <p className="text-white/90 text-xl leading-relaxed font-medium">
            Create shared playlists where everyone can vote on their favorite tracks
          </p>
        </div>

        {/* Features - Horizontal layout */}
        <div className="glass-card p-8 mb-8">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Music size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-fun font-bold text-gray-900 text-lg">Real-time voting</p>
                <p className="text-gray-600 font-medium">Vote up or down on any track instantly</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Sparkles size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-fun font-bold text-gray-900 text-lg">Live playback</p>
                <p className="text-gray-600 font-medium">Stream directly from Spotify with friends</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Plus size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-fun font-bold text-gray-900 text-lg">Easy sharing</p>
                <p className="text-gray-600 font-medium">Share room links with friends effortlessly</p>
              </div>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <a
          href={`${API_URL}/auth/login`}
          className="btn-primary w-full text-center inline-flex items-center justify-center gap-3 no-underline text-lg"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" className="fill-current">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Continue with Spotify
          <ArrowRight size={20} />
        </a>

        <p className="text-center text-sm text-white/70 mt-6 font-medium">
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
    const res = await fetch(`${API_URL}/api/rooms`, {
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
    <div className="min-h-screen flex items-center justify-center font-main">
      <div className="max-w-lg w-full mx-4 space-y-6">
        
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-white/20 to-white/10 backdrop-blur-lg rounded-3xl mb-8 shadow-2xl border border-white/20">
            <Music size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-fun font-bold text-white mb-4 drop-shadow-lg">
            Welcome back!
          </h1>
          <p className="text-white/90 text-lg font-medium">Create a new room or join an existing one</p>
        </div>

        {/* Create Room */}
        <div className="glass-card p-8">
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                <Plus size={20} className="text-white" />
              </div>
              <h2 className="text-xl font-fun font-bold text-gray-900">Create a Room</h2>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3 font-fun">
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
              <label className="block text-sm font-bold text-gray-700 mb-3 font-fun">
                Spotify Playlist
              </label>
              <input 
                value={playlistInput} 
                onChange={e => setPlaylistInput(e.target.value)}
                placeholder="Paste Spotify playlist URL or ID"
                className="input-modern"
                required
              />
              <p className="text-xs text-gray-500 mt-2 font-medium">
                You can paste the full Spotify URL or just the playlist ID
              </p>
            </div>
            
            <button 
              type="submit" 
              disabled={creating}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {creating ? (
                <>
                  <div className="loading-spinner w-5 h-5 mr-3"></div>
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={20} className="mr-3" />
                  Create Room
                </>
              )}
            </button>
          </form>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t-2 border-white/20"></div>
          </div>
          <div className="relative flex justify-center text-lg">
            <span className="px-4 bg-transparent text-white/80 font-fun font-bold">or</span>
          </div>
        </div>

        {/* Join Room */}
        <div className="glass-card p-8">
          <form onSubmit={handleJoin} className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <ArrowRight size={20} className="text-white" />
              </div>
              <h2 className="text-xl font-fun font-bold text-gray-900">Join a Room</h2>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3 font-fun">
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
              className="btn-secondary w-full text-lg"
            >
              <ArrowRight size={20} className="mr-3" />
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