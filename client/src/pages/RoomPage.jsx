// client/src/pages/RoomPage.jsx
import {
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext.jsx';
import TrackRow from '../components/TrackRow.jsx';
import MusicPlayer from '../components/MusicPlayer.jsx';
import { useMusicPlayer } from '../hooks/useMusicPlayer.js';
import { supabase } from '../lib/supabaseClient.js';
import { Play, Shuffle, Music, AlertCircle, Loader } from 'lucide-react';

const API = 'http://127.0.0.1:4000';

export default function RoomPage() {
  const { roomId } = useParams();
  const { user } = useContext(AuthContext);
  const [search, setSearch] = useSearchParams();

  /* ---------------- state ---------------- */
  const [room, setRoom] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const sortMode = (search.get('sort') ?? 'votes').toLowerCase();
  
  // Keep track of initial load to prevent unnecessary re-sorts
  const initialLoadDone = useRef(false);

  // Music player hook (now with enhanced features)
  const {
    isPlaying,
    currentTrack,
    currentTrackIndex,
    shuffleMode,
    playableTracks,
    playQueue,
    spotifyReady,
    spotifyActive,
    spotifyError,
    position,
    duration,
    volume,
    play,
    pause,
    next,
    previous,
    toggleShuffle,
    playAll,
    playTrackByOriginalIndex,
    playTrackFromQueue,
    getPlayableTrackIndex,
    isTrackCurrentlyPlaying,
    isTrackCurrent,
    setVolume,
    seek,
    transferPlayback,
  } = useMusicPlayer(tracks, sortMode);

  /* ------------ data loader ------------- */
  const loadRoom = useCallback(
    async (mode = sortMode) => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API}/api/rooms/${roomId}?sort=${mode}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const json = await res.json();
          setRoom(json.room);
          setTracks(json.tracks);
          initialLoadDone.current = true;
        } else {
          const { error } = await res.json();
          alert(error);
        }
      } catch (error) {
        console.error('Failed to load room:', error);
        alert('Failed to load room');
      }
      setLoading(false);
    },
    [roomId, sortMode]
  );

  /* fire on mount & when roomId changes */
  useEffect(() => {
    initialLoadDone.current = false;
    loadRoom();
  }, [loadRoom]);

  /* ----------- handle track updates from votes ---------- */
  const handleTrackUpdate = useCallback((trackId, newScore) => {
    setTracks(prevTracks => {
      const updatedTracks = prevTracks.map(track => 
        track.trackId === trackId 
          ? { ...track, score: newScore }
          : track
      );
      
      // Re-sort based on current sort mode
      if (['tempo', 'energy', 'dance'].includes(sortMode)) {
        const key = sortMode === 'dance' ? 'danceability' : sortMode;
        return updatedTracks.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
      } else {
        // Sort by score (desc), then by added_at (asc)
        return updatedTracks.sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));
      }
    });
  }, [sortMode]);

  /* -------- realtime subscription -------- */
  useEffect(() => {
    if (!initialLoadDone.current) return;

    console.log('Setting up real-time subscription for room:', roomId);

    const channel = supabase
      .channel(`room-${roomId}`)
      
      /* Handle vote changes */
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
        },
        async (payload) => {
          console.log('Vote change detected:', payload);
          
          // Get the track_id from the vote change
          const trackId = payload.new?.track_id || payload.old?.track_id;
          if (!trackId) return;

          // Fetch updated score for this specific track
          try {
            const { data: votes } = await supabase
              .from('votes')
              .select('vote')
              .eq('track_id', trackId);
            
            if (votes) {
              const newScore = votes.reduce((sum, v) => sum + v.vote, 0);
              handleTrackUpdate(trackId, newScore);
            }
          } catch (error) {
            console.error('Failed to fetch updated votes:', error);
          }
        }
      )
      
      /* Handle new tracks being added */
      .on(
        'postgres_changes',
        {
          event: 'insert',
          schema: 'public',
          table: 'tracks',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          console.log('New track added, reloading room');
          loadRoom();
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [roomId, handleTrackUpdate, loadRoom]);

  /* ----------- sort-mode toolbar ---------- */
  const changeSort = useCallback((mode) => {
    if (mode === sortMode) return;
    
    setSearch({ sort: mode });
    
    // Always reload from server to get fresh audio features if needed
    loadRoom(mode);
  }, [sortMode, setSearch, loadRoom]);

  /* ----------- music player handlers ----------- */
  const handlePlay = useCallback(async (trackIndex = null) => {
    if (trackIndex !== null) {
      await playTrackByOriginalIndex(trackIndex);
    } else {
      await play();
    }
  }, [playTrackByOriginalIndex, play]);

  const handlePause = useCallback(async () => {
    await pause();
  }, [pause]);

  const handleNext = useCallback(async () => {
    await next();
  }, [next]);

  const handlePrevious = useCallback(async () => {
    await previous();
  }, [previous]);

  const handleShuffle = useCallback(() => {
    toggleShuffle();
  }, [toggleShuffle]);

  const handlePlayAll = useCallback(async () => {
    await playAll();
  }, [playAll]);

  const handleSeek = useCallback(async (positionMs) => {
    await seek(positionMs);
  }, [seek]);

  const handleVolumeChange = useCallback(async (newVolume) => {
    await setVolume(newVolume);
  }, [setVolume]);

  const handlePlayTrackFromQueue = useCallback(async (queueIndex) => {
    await playTrackFromQueue(queueIndex);
  }, [playTrackFromQueue]);

  /* ----------- render ----------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading room...</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Room not found</h2>
          <p className="text-gray-600">The room you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  // All tracks with Spotify IDs are now "playable"
  const playableTracksCount = tracks.filter(t => t.spotifyId).length;
  const hasPlayableTracks = playableTracksCount > 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-40"> {/* Extra bottom padding for enhanced player */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        
        {/* Room Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{room.name}</h1>
          <p className="text-gray-600 mb-4">
            Spotify Playlist: {room.spotify_playlist}
          </p>
          
          {/* Stats */}
          <div className="flex gap-6 text-sm text-gray-500 mb-4">
            <span>{tracks.length} total tracks</span>
            <span>{playableTracksCount} playable tracks</span>
            {playQueue.length > 0 && <span>{playQueue.length} in queue</span>}
            {user && <span>Sorting by: {sortMode}</span>}
            {shuffleMode && <span className="text-blue-600">Shuffle: ON</span>}
          </div>

          {/* Spotify Connection Status */}
          {spotifyError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle size={16} />
                <div>
                  <p className="font-medium">Spotify Connection Error</p>
                  <p className="text-sm">{spotifyError}</p>
                </div>
              </div>
            </div>
          )}

          {!spotifyReady && !spotifyError && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800">
                <Loader size={16} className="animate-spin" />
                <div>
                  <p className="font-medium">Connecting to Spotify</p>
                  <p className="text-sm">Setting up Web Playback SDK...</p>
                </div>
              </div>
            </div>
          )}

          {spotifyReady && !spotifyActive && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 text-blue-800">
                <Music size={16} />
                <div className="flex-1">
                  <p className="font-medium">Spotify Connected</p>
                  <p className="text-sm">Click "Activate" in the player below to start playback on this device</p>
                </div>
                <button 
                  onClick={transferPlayback}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Activate
                </button>
              </div>
            </div>
          )}
          
          {/* Play All Button */}
          {hasPlayableTracks && (
            <div className="flex gap-3">
              <button
                onClick={handlePlayAll}
                disabled={!spotifyReady || !spotifyActive}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
              >
                <Play size={16} />
                Play All
              </button>
              <button
                onClick={handleShuffle}
                disabled={!spotifyReady}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  shuffleMode 
                    ? 'bg-blue-50 border-blue-200 text-blue-700' 
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Shuffle size={16} />
                {shuffleMode ? 'Shuffle On' : 'Shuffle'}
              </button>
            </div>
          )}
          
          {/* Warning for no playable tracks */}
          {!hasPlayableTracks && tracks.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800 text-sm">
                ⚠️ None of the tracks in this playlist have Spotify IDs available. 
                Please check that the playlist contains valid Spotify tracks.
              </p>
            </div>
          )}

          {/* Spotify Premium Notice */}
          {spotifyError && spotifyError.includes('Premium') && (
            <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-orange-600 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-800">Spotify Premium Required</p>
                  <p className="text-sm text-orange-700 mt-1">
                    The Spotify Web Playback SDK requires a Premium subscription to play full tracks. 
                    You can still browse and vote on tracks, but playback functionality requires Premium.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sort Toolbar */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-2">
            {['votes', 'tempo', 'energy', 'dance'].map((mode) => (
              <button
                key={mode}
                onClick={() => changeSort(mode)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  sortMode === mode
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Sort by {mode === 'dance' ? 'Danceability' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tracks List */}
        <div className="bg-white rounded-lg shadow-sm">
          {tracks.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 mb-2">No tracks in this room yet.</p>
              <p className="text-sm text-gray-400">
                Tracks will appear here when they're added to the connected Spotify playlist.
              </p>
            </div>
          ) : (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Tracks ({tracks.length})
              </h2>
              <div className="space-y-1">
                {tracks.map((track, index) => {
                  // Use the new helper functions
                  const isCurrentTrack = isTrackCurrent(index);
                  const isCurrentlyPlaying = isTrackCurrentlyPlaying(index);
                  
                  return (
                    <TrackRow
                      key={track.trackId || `track-${index}`}
                      roomId={roomId}
                      track={track}
                      sortMode={sortMode}
                      isAuthed={!!user}
                      onTrackUpdate={handleTrackUpdate}
                      position={index + 1}
                      isPlaying={isCurrentlyPlaying}
                      isCurrentTrack={isCurrentTrack}
                      onPlay={handlePlay}
                      onPause={handlePause}
                      trackIndex={index}
                      spotifyReady={spotifyReady}
                      spotifyActive={spotifyActive}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Debug info (only in development) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-6 bg-gray-100 rounded-lg p-4 text-xs text-gray-600">
            <h3 className="font-semibold mb-2">Debug Info:</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <strong>Room:</strong> {room?.name}<br/>
                <strong>Tracks:</strong> {tracks.length}<br/>
                <strong>Playable:</strong> {playableTracksCount}<br/>
                <strong>Sort Mode:</strong> {sortMode}
              </div>
              <div>
                <strong>Current Track:</strong> {currentTrack?.title || 'None'}<br/>
                <strong>Track Index:</strong> {currentTrackIndex}<br/>
                <strong>Is Playing:</strong> {isPlaying ? 'Yes' : 'No'}<br/>
                <strong>Shuffle:</strong> {shuffleMode ? 'On' : 'Off'}
              </div>
              <div className="col-span-2 mt-2">
                <strong>Spotify Status:</strong><br/>
                <span className="ml-2">Ready: {spotifyReady ? 'Yes' : 'No'}</span><br/>
                <span className="ml-2">Active: {spotifyActive ? 'Yes' : 'No'}</span><br/>
                <span className="ml-2">Error: {spotifyError || 'None'}</span><br/>
                <strong>Queue:</strong> {playQueue.length} tracks<br/>
                <strong>Position:</strong> {Math.floor(position / 1000)}s / {Math.floor(duration / 1000)}s
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Music Player (Fixed at bottom) */}
      {hasPlayableTracks && (
        <MusicPlayer
          tracks={playableTracks}
          sortMode={sortMode}
          isPlaying={isPlaying}
          currentTrack={currentTrack}
          spotifyReady={spotifyReady}
          spotifyActive={spotifyActive}
          spotifyError={spotifyError}
          position={position}
          duration={duration}
          volume={volume}
          onPlay={handlePlay}
          onPause={handlePause}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onShuffle={handleShuffle}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          shuffleMode={shuffleMode}
          transferPlayback={transferPlayback}
          playQueue={playQueue}
          currentTrackIndex={currentTrackIndex}
          onPlayTrackFromQueue={handlePlayTrackFromQueue}
        />
      )}
    </div>
  );
}