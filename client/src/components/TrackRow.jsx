// client/src/components/TrackRow.jsx
import VoteButtons from './VoteButtons.jsx';
import { Play, Pause, Music } from 'lucide-react';

/**
 * Props
 * -----
 * roomId           UUID of the room   (string)
 * track            { trackId, spotifyId, title, artist, albumArt,
 *                    score, tempo, energy, danceability }
 * sortMode         "votes" | "tempo" | "energy" | "dance"
 * isAuthed         boolean   – show vote buttons only if true
 * onTrackUpdate    fn(trackId, newScore) – bubble up vote changes
 * position         number    – ranking position (1, 2, 3...)
 * isPlaying        boolean   – whether this track is currently playing
 * isCurrentTrack   boolean   – whether this is the current track in player
 * onPlay           fn(trackIndex) – callback when play button is clicked
 * onPause          fn() – callback when pause button is clicked
 * trackIndex       number    – index of this track in the tracks array
 * spotifyReady     boolean   – whether Spotify Web Playback SDK is ready
 * spotifyActive    boolean   – whether our device is the active Spotify device
 */
export default function TrackRow({
  roomId,
  track,
  sortMode,
  isAuthed,
  onTrackUpdate,
  position,
  isPlaying,
  isCurrentTrack,
  onPlay,
  onPause,
  trackIndex,
  spotifyReady = false,
  spotifyActive = false,
}) {
  const { trackId, title, artist, albumArt, score, spotifyId,
          tempo, energy, danceability } = track;

  /* value to show beside the row, depending on sort */
  let extraMetric = null;
  if (sortMode === 'tempo'  && tempo != null)        extraMetric = `${Math.round(tempo)} BPM`;
  if (sortMode === 'energy' && energy != null)       extraMetric = energy.toFixed(2);
  if (sortMode === 'dance'  && danceability != null) extraMetric = danceability.toFixed(2);

  const handlePlayPauseClick = (e) => {
    e.stopPropagation(); // Prevent row click if we add that later
    
    if (isCurrentTrack && isPlaying) {
      // Currently playing this track - pause it
      onPause();
    } else {
      // Either not current track or current track is paused - play it
      onPlay(trackIndex);
    }
  };

  // Track is playable if we have a Spotify ID
  const isPlayable = !!spotifyId;
  const canPlay = isPlayable && spotifyReady && spotifyActive;

  // Determine button state and icon
  const getPlayButtonIcon = () => {
    if (!isPlayable) return <Music size={16} />;
    if (isCurrentTrack && isPlaying) return <Pause size={16} />;
    return <Play size={16} />;
  };

  const getPlayButtonTitle = () => {
    if (!isPlayable) return 'No Spotify ID available';
    if (!spotifyReady) return 'Connecting to Spotify...';
    if (!spotifyActive) return 'Activate Spotify playback first';
    if (isCurrentTrack && isPlaying) return 'Pause track';
    return 'Play track';
  };

  return (
    <div className={`flex items-center gap-4 py-3 border-b transition-all duration-200 hover:bg-gray-50 ${
      isCurrentTrack ? 'bg-blue-50 border-blue-200' : ''
    }`}>
      {/* position indicator */}
      <div className="w-8 text-right text-sm font-semibold text-gray-400">
        #{position}
      </div>

      {/* play/pause button */}
      <button
        onClick={handlePlayPauseClick}
        disabled={!canPlay}
        className={`p-2 rounded-full transition-all duration-200 ${
          canPlay 
            ? 'hover:bg-blue-100 text-gray-600 hover:text-blue-600' 
            : 'text-gray-300 cursor-not-allowed'
        } ${isCurrentTrack && isPlaying ? 'bg-blue-100 text-blue-600' : ''}`}
        title={getPlayButtonTitle()}
      >
        {getPlayButtonIcon()}
      </button>

      {/* album cover */}
      {albumArt ? (
        <img
          src={albumArt}
          alt=""
          className="w-12 h-12 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded bg-gray-200 shrink-0" />
      )}

      {/* title + artist */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${isCurrentTrack ? 'text-blue-700' : ''}`}>
          {title}
        </p>
        <p className="text-sm text-gray-500 truncate">{artist}</p>
        
        {/* Status indicators */}
        {!isPlayable && (
          <p className="text-xs text-gray-400">No Spotify ID available</p>
        )}
        {isPlayable && !spotifyReady && (
          <p className="text-xs text-gray-400">Connecting to Spotify...</p>
        )}
        {isPlayable && spotifyReady && !spotifyActive && (
          <p className="text-xs text-gray-400">Activate Spotify playback to play</p>
        )}
        {isCurrentTrack && isPlaying && (
          <p className="text-xs text-blue-500 flex items-center gap-1">
            <span className="inline-block w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
            Now playing
          </p>
        )}
      </div>

      {/* show score in votes mode, otherwise the chosen metric */}
      <div className="w-20 text-right font-semibold">
        {sortMode === 'votes' ? (
          <span className="text-blue-600">{score}</span>
        ) : (
          <span className="text-gray-700">{extraMetric || 'N/A'}</span>
        )}
      </div>

      {/* vote buttons (only if authed) */}
      {isAuthed && (
        <VoteButtons
          roomId={roomId}
          trackId={trackId}
          score={score}
          onTrackUpdate={onTrackUpdate}
        />
      )}
    </div>
  );
}