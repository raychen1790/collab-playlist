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
import { Play, Shuffle, Music, AlertCircle, Loader, Activity, Users, Clock, Zap } from 'lucide-react';

export default function RoomPage() {
  const { roomId } = useParams();
  const { user, apiRequest } = useContext(AuthContext);
  const [search, setSearch] = useSearchParams();

  /* ---------------- state ---------------- */
  const [room, setRoom] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const sortMode = (search.get('sort') ?? 'votes').toLowerCase();
  
  const initialLoadDone = useRef(false);

  // Music player hook
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
    // NEW: user-gesture activator for Safari/iOS
    activateAudio,
  } = useMusicPlayer(tracks, sortMode);

  /* ------------ data loader ------------- */
  const loadRoom = useCallback(
    async (mode = sortMode) => {
      setLoading(true);
      try {
        // Use the enhanced apiRequest function
        const res = await apiRequest(`/api/rooms/${roomId}?sort=${mode}`);
        
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
    [roomId, sortMode, apiRequest]
  );

  useEffect(() => {
    initialLoadDone.current = false;
    loadRoom();
  }, [loadRoom]);

  /* ----------- handle track updates from votes ---------- */
  const handleTrackUpdate = useCallback((trackId, newScore) => {
    console.log(`🗳️ RoomPage: Updating track ${trackId} score to ${newScore}`);
    
    setTracks(prevTracks => {
      const updatedTracks = prevTracks.map(track => {
        if (track.trackId === trackId) {
          console.log(`🔄 Track ${trackId}: ${track.score} → ${newScore}`);
          return { ...track, score: newScore };
        }
        return track;
      });
      
      // Re-sort based on current sort mode
      let sortedTracks;
      if (['tempo', 'energy', 'dance'].includes(sortMode)) {
        const key = sortMode === 'dance' ? 'danceability' : sortMode;
        sortedTracks = updatedTracks.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
      } else {
        sortedTracks = updatedTracks.sort((a, b) => b.score - a.score || new Date(a.addedAt) - new Date(b.addedAt));
      }
      
      console.log(`📊 Tracks re-sorted by ${sortMode}`);
      return sortedTracks;
    });
  }, [sortMode]);

  /* -------- realtime subscription -------- */
  useEffect(() => {
    if (!initialLoadDone.current) return;

    console.log('Setting up real-time subscription for room:', roomId);

    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
        },
        async (payload) => {
          console.log('🗳️ Vote change detected:', {
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old
          });
          
          const trackId = payload.new?.track_id || payload.old?.track_id;
          if (!trackId) {
            console.warn('No track_id found in vote change payload');
            return;
          }

          try {
            console.log(`🔍 Fetching updated votes for track ${trackId}`);
            const { data: votes, error } = await supabase
              .from('votes')
              .select('vote')
              .eq('track_id', trackId);
            
            if (error) {
              console.error('Error fetching votes:', error);
              return;
            }
            
            if (votes) {
              const newScore = votes.reduce((sum, v) => sum + v.vote, 0);
              console.log(`✅ New score for track ${trackId}: ${newScore} (from ${votes.length} votes)`);
              handleTrackUpdate(trackId, newScore);
            }
          } catch (error) {
            console.error('Failed to fetch updated votes:', error);
            console.log('📥 Fallback: reloading entire room');
            loadRoom();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tracks',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          console.log('➕ New track added, reloading room');
          loadRoom();
        }
      )
      .subscribe((status) => {
        console.log('📡 Real-time subscription status:', status);
      });

    return () => {
      console.log('🔌 Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [roomId, handleTrackUpdate, loadRoom]);

  /* ----------- sort-mode toolbar ---------- */
  const changeSort = useCallback((mode) => {
    if (mode === sortMode) return;
    
    setSearch({ sort: mode });
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
      <div className="min-h-screen flex items-center justify-center font-main">
        <div className="glass-card p-8 text-center max-w-sm">
          <div className="loading-spinner w-12 h-12 mx-auto mb-4"></div>
          <h3 className="text-lg font-fun font-bold mb-2">Loading room...</h3>
          <p className="text-gray-500 text-sm font-medium">Please wait while we fetch your playlist</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center font-main">
        <div className="glass-card p-8 text-center max-w-sm">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-fun font-bold text-gray-900 mb-2">Room not found</h2>
          <p className="text-gray-600 font-medium">The room you're looking for doesn't exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  const playableTracksCount = tracks.filter(t => t.spotifyId).length;
  const hasPlayableTracks = playableTracksCount > 0;

  const getSortIcon = (mode) => {
    switch(mode) {
      case 'votes': return <Users size={18} />;
      case 'tempo': return <Activity size={18} />;
      case 'energy': return <Zap size={18} />;
      case 'dance': return <Music size={18} />;
      default: return <Clock size={18} />;
    }
  };

  return (
    <div className="min-h-screen pb-40 font-main">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        
        {/* Room Header - Simplified and more prominent */}
        <div className="glass-card p-8 text-center">
          <h1 className="playlist-title">{room.name}</h1>
          <p className="track-count">{tracks.length} Total Tracks</p>
          
          {/* Live indicator */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-400/20 to-green-500/20 backdrop-blur-sm rounded-full border border-green-400/30 mb-6">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm font-fun font-bold text-green-100">Live</span>
          </div>

          {/* Spotify Status */}
          {spotifyError && (
            <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm border border-red-200/50 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle size={20} className="text-red-500 shrink-0" />
                <div>
                  <p className="font-fun font-bold text-red-800">Spotify Connection Error</p>
                  <p className="text-sm text-red-600 font-medium">{spotifyError}</p>
                </div>
              </div>
            </div>
          )}

          {!spotifyReady && !spotifyError && (
            <div className="mb-6 p-4 bg-yellow-50/80 backdrop-blur-sm border border-yellow-200/50 rounded-xl">
              <div className="flex items-center gap-3">
                <Loader size={20} className="animate-spin text-yellow-600" />
                <div>
                  <p className="font-fun font-bold text-yellow-800">Connecting to Spotify</p>
                  <p className="text-sm text-yellow-600 font-medium">Setting up Web Playback SDK...</p>
                </div>
              </div>
            </div>
          )}

          {spotifyReady && !spotifyActive && (
            <div className="mb-6 p-4 bg-blue-50/80 backdrop-blur-sm border border-blue-200/50 rounded-xl">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <Music size={20} className="text-blue-600" />
                  <div>
                    <p className="font-fun font-bold text-blue-800">Spotify Connected</p>
                    <p className="text-sm text-blue-600 font-medium">Ready to play music on this device</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={transferPlayback}
                    className="btn-primary"
                  >
                    Activate
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Action buttons */}
          {hasPlayableTracks && (
            <div className="flex gap-4 justify-center">
              <button
                onClick={handlePlayAll}
                disabled={!spotifyReady || !spotifyActive}
                className="btn-primary flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
              >
                <Play size={20} />
                Play All
              </button>
              {sortMode === 'votes' && (
                <button
                  onClick={handleShuffle}
                  disabled={!spotifyReady}
                  className={`btn-secondary flex items-center gap-3 disabled:opacity-50 text-lg ${
                    shuffleMode ? 'bg-gradient-to-r from-blue-400/20 to-purple-400/20 border-blue-300/50' : ''
                  }`}
                >
                  <Shuffle size={20} />
                  {shuffleMode ? 'Shuffle On' : 'Shuffle'}
                </button>
              )}
            </div>
          )}
          
          {!hasPlayableTracks && tracks.length > 0 && (
            <div className="p-4 bg-yellow-50/80 backdrop-blur-sm border border-yellow-200/50 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle size={20} className="text-yellow-600" />
                <p className="text-sm text-yellow-800 font-medium">
                  No tracks with Spotify IDs available. Please check that the playlist contains valid Spotify tracks.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sort Toolbar - Enhanced buttons */}
        <div className="glass-card p-6">
          <div className="flex flex-wrap gap-3 justify-center">
            {['votes', 'tempo', 'energy', 'dance'].map((mode) => (
              <button
                key={mode}
                onClick={() => changeSort(mode)}
                className={`btn-sort ${sortMode === mode ? 'active' : 'inactive'}`}
              >
                {getSortIcon(mode)}
                {mode === 'dance' ? 'Danceability' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tracks List - More compact */}
        <div className="glass-card overflow-hidden">
          {tracks.length === 0 ? (
            <div className="p-12 text-center">
              <Music size={48} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-fun font-bold text-gray-900 mb-2">No tracks yet</h3>
              <p className="text-gray-500 font-medium">
                Tracks will appear here when they're added to the connected Spotify playlist.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {tracks.map((track, index) => {
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
          )}
        </div>
      </div>

      {/* Enhanced Music Player */}
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
