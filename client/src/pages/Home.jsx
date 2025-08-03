// client/src/pages/Home.jsx
import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext.jsx';

/* ----------  unauthenticated view ---------- */
function LoginScreen() {
  return (
    <div className="p-8 text-center">
      <h1 className="text-3xl font-bold mb-6">Collaborative Playlist</h1>

      <a
        href="http://127.0.0.1:4000/auth/login"
        className="inline-block px-6 py-3 bg-green-600 text-white rounded hover:bg-green-700"
      >
        Log in with Spotify
      </a>
    </div>
  );
}

/* ----------  authenticated view ---------- */
function AuthedHome() {
  const nav = useNavigate();

  // hooks declared on **every** render
  const [roomName, setRoomName]         = useState('');
  const [playlistInput, setPlaylistInput] = useState('');
  const [creating, setCreating]         = useState(false);
  const [joinId, setJoinId]             = useState('');

  /* util to pull playlist ID out of URL or raw ID */
  const getPlaylistId = (inp) => {
    try { return new URL(inp).pathname.split('/').pop(); }
    catch { return inp.trim(); }
  };

  /* create room */
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

  /* join room */
  const handleJoin = (e) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    nav(`/rooms/${joinId.trim()}`);
  };

  /* -----------  JSX  ----------- */
  return (
    <div className="p-6 max-w-md mx-auto space-y-8">
      <h1 className="text-3xl font-bold text-center">Collaborative Playlist</h1>

      {/* Create */}
      <form onSubmit={handleCreate} className="space-y-4">
        <h2 className="text-xl font-semibold">Create a Room</h2>
        <input value={roomName} onChange={e=>setRoomName(e.target.value)}
               placeholder="Room name"
               className="w-full border px-3 py-2 rounded" />
        <input value={playlistInput} onChange={e=>setPlaylistInput(e.target.value)}
               placeholder="Spotify playlist URL or ID"
               className="w-full border px-3 py-2 rounded" />
        <button type="submit" disabled={creating}
                className="w-full bg-green-600 text-white py-2 rounded">
          {creating ? 'Creating…' : 'Create Room'}
        </button>
      </form>

      <hr />

      {/* Join */}
      <form onSubmit={handleJoin} className="space-y-4">
        <h2 className="text-xl font-semibold">Join a Room</h2>
        <input value={joinId} onChange={e=>setJoinId(e.target.value)}
               placeholder="Room ID (UUID)"
               className="w-full border px-3 py-2 rounded" />
        <button type="submit"
                className="w-full bg-blue-600 text-white py-2 rounded">
          Join Room
        </button>
      </form>
    </div>
  );
}

/* ----------  top-level Home ---------- */
export default function Home() {
  const { user } = useContext(AuthContext);
  return user ? <AuthedHome /> : <LoginScreen />;
}
