// client/src/pages/Home.jsx
import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext.jsx';
import { Music, Plus, ArrowRight, Sparkles, Loader2, User, PlayCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';

/* ----------  loading view ---------- */
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center font-main">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-white/20 to-white/10 backdrop-blur-lg rounded-3xl mb-8 shadow-2xl border border-white/20">
          <Loader2 size={40} className="text-white animate-spin" />
        </div>
        <h2 className="text-2xl font-title font-bold text-white mb-4">
          Setting up your session...
        </h2>
        <p className="text-white/80 font-medium">
          Please wait while we authenticate with Spotify
        </p>
      </div>
    </div>
  );
}

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
          <h1 className="text-5xl font-title font-bold text-white mb-6 drop-shadow-lg">
            UPMIX
          </h1>
          <p className="text-white/90 text-xl leading-relaxed font-medium">
            Build a live, crowd-powered playlist </p>
            <p className="text-white/90 text-xl leading-relaxed font-medium">
            then play songs by votes, tempo, energy, or danceability
          </p>
        </div>

        {/* Features - Horizontal layout */}
        <div className="glass-card glass-card--snappy p-8 mb-8">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Music size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-title font-bold text-gray-900 text-lg">Real-time voting</p>
                <p className="text-gray-600 font-medium">Vote up or down on any track instantly</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Sparkles size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-title font-bold text-gray-900 text-lg">Live playback</p>
                <p className="text-gray-600 font-medium">Stream directly from Spotify with friends</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                <Plus size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-title font-bold text-gray-900 text-lg">Easy sharing</p>
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

                {/* Demo Section */}
        <div className="glass-card glass-card--snappy p-6 mb-6 border-2 border-yellow-400/30 bg-gradient-to-br from-yellow-50/10 to-amber-50/5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl flex items-center justify-center shadow-lg">
              <User size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-title font-bold text-white text-lg">Try the Demo</h3>
              <p className="text-white/80 text-sm">Experience UPMIX without Spotify Premium</p>
            </div>
          </div>
          
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-4 border border-white/20">
            <p className="text-white/90 text-sm font-medium mb-2">Demo Login Credentials:</p>
            <div className="space-y-1 text-white/80 text-sm font-mono">
              <div className="flex justify-between">
                <span>Email:</span>
                <span className="select-all">upmixdemo@gmail.com</span>
              </div>
              <div className="flex justify-between">
                <span>Password:</span>
                <span className="select-all">upmixdemo25</span>
              </div>
            </div>
          </div>
          
          <p className="text-white/70 text-xs">
            Use these credentials to explore the features of this website while it is in development mode.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------  authenticated view ---------- */
function AuthedHome() {
  const nav = useNavigate();
  const { user, apiRequest } = useContext(AuthContext);
  const [roomName, setRoomName] = useState('');
  const [playlistInput, setPlaylistInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState('');

  const demoRoomId = 'ea3b4ad0-5318-43e0-a906-23fec4565469';

  const getPlaylistId = (inp) => {
    try { return new URL(inp).pathname.split('/').pop(); }
    catch { return inp.trim(); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const playlistId = getPlaylistId(playlistInput);
    if (!roomName || !playlistId) return alert('Both fields required');

    setCreating(true);
    
    try {
      console.log('🔍 Creating room with:', { roomName, playlistId });
      console.log('🔍 User context:', user);
      
      // Use the enhanced apiRequest function
      const res = await apiRequest('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ 
          name: roomName, 
          spotifyPlaylistId: playlistId 
        }),
      });

      console.log('🔍 Create room response status:', res.status);
      
      if (res.ok) {
        const { room } = await res.json();
        console.log('✅ Room created successfully:', room);
        nav(`/rooms/${room.id}`);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ Create room error:', res.status, errorData);
        
        if (res.status === 401) {
          alert('Authentication expired. Please log in again.');
          // Force refresh of auth state
          window.location.reload();
        } else {
          alert(errorData.error || `Error: ${res.status}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error creating room:', error);
      alert('Network error. Please check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    nav(`/rooms/${joinId.trim()}`);
  };

  const handleJoinDemo = () => {
    nav(`/rooms/${demoRoomId}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-main">
      <div className="max-w-lg w-full mx-4 space-y-6">
        
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-white/20 to-white/10 backdrop-blur-lg rounded-3xl mb-8 shadow-2xl border border-white/20">
            <Music size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-title font-bold text-white mb-4 drop-shadow-lg">
            Welcome back!
          </h1>
          <p className="text-white/90 text-lg font-medium">
            Create a new room or join an existing one
          </p>
          {user && (
            <p className="text-white/70 text-sm font-medium mt-2">
              Logged in as {user.display_name}
            </p>
          )}
        </div>

        {/* Create Room */}
        <div className="glass-card p-8">
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                <Plus size={20} className="text-white" />
              </div>
              <h2 className="text-xl font-title font-bold text-gray-900">Create a Room</h2>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3 font-title">
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
              <label className="block text-sm font-bold text-gray-700 mb-3 font-title">
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
                  <Loader2 size={20} className="mr-3 animate-spin" />
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
            <span className="px-4 bg-transparent text-white/80 font-title font-bold">or</span>
          </div>
        </div>

        {/* Join Room */}
        <div className="glass-card p-8">
          <form onSubmit={handleJoin} className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <ArrowRight size={20} className="text-white" />
              </div>
              <h2 className="text-xl font-title font-bold text-gray-900">Join a Room</h2>
            </div>

            {/* Demo Room Section */}
            <div className="bg-gradient-to-br from-yellow-50/20 to-amber-50/10 rounded-lg p-4 border border-yellow-400/30 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-lg flex items-center justify-center">
                  <PlayCircle size={16} className="text-white" />
                </div>
                <span className="font-title font-bold text-gray-900 text-sm">Try Demo Room</span>
              </div>
              <p className="text-gray-700 text-xs mb-3 font-medium">
                Join our demo room with sample music to test all features
              </p>
              <button
                type="button"
                onClick={handleJoinDemo}
                className="w-full bg-gradient-to-r from-yellow-400 to-amber-500 text-white font-title font-bold text-sm py-2 px-4 rounded-lg hover:shadow-lg transition-all duration-200 hover:scale-[1.02]"
              >
                Join Demo Room
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3 font-title">
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

        {process.env.NODE_ENV === 'development' && (
          <div className="glass-card p-4 text-xs">
            <p className="text-gray-600">Debug - API: {API_URL}</p>
            <p className="text-gray-600">User: {user ? user.display_name : 'null'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------  top-level Home ---------- */
export default function Home() {
  const { user, loading } = useContext(AuthContext);
  
  if (loading) {
    return <LoadingScreen />;
  }
  
  return user ? <AuthedHome /> : <LoginScreen />;
}