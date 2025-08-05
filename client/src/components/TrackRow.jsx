// client/src/components/TrackRow.jsx - Enhanced with better styling and compact design
import VoteButtons from './VoteButtons.jsx';
import { Play, Pause, Music } from 'lucide-react';

/**
 * Enhanced, compact TrackRow with fun styling and animations
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
    e.stopPropagation();
    
    if (isCurrentTrack && isPlaying) {
      onPause();
    } else {
      onPlay(trackIndex);
    }
  };

  const isPlayable = !!spotifyId;
  const canPlay = isPlayable && spotifyReady && spotifyActive;

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
    <div 
      className={`track-row-compact group relative flex items-center gap-3 py-3 px-4 border-b border-white/10 last:border-b-0 transition-all duration-300 ${
        isCurrentTrack 
          ? 'bg-gradient-to-r from-blue-400/20 to-purple-400/20 border-blue-300/30' 
          : 'hover:bg-white/10'
      }`}
      style={{
        animationDelay: `${position * 30}ms`
      }}
    >
      {/* Subtle glow for current track */}
      {isCurrentTrack && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400/10 to-purple-400/10 rounded-lg"></div>
      )}

      {/* Position indicator - more compact */}
      <div className="w-8 text-center">
        <span className={`text-sm font-fun font-bold ${
          isCurrentTrack ? 'text-blue-300' : 'text-gray-400'
        }`}>
          {position}
        </span>
      </div>

      {/* Play/pause button - enhanced styling */}
      <button
        onClick={handlePlayPauseClick}
        disabled={!canPlay}
        className={`play-btn relative p-2 transition-all duration-300 ${
          canPlay 
            ? `${
                isCurrentTrack && isPlaying 
                  ? 'playing' 
                  : ''
              }` 
            : 'opacity-30 cursor-not-allowed'
        }`}
        title={getPlayButtonTitle()}
      >
        {getPlayButtonIcon()}
        
        {/* Pulsing indicator for currently playing */}
        {isCurrentTrack && isPlaying && (
          <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-400 to-purple-400 animate-pulse opacity-20"></div>
        )}
      </button>

      {/* Album cover - smaller and more refined */}
      <div className="relative group">
        {albumArt ? (
          <img
            src={albumArt}
            alt=""
            className="w-12 h-12 rounded-xl object-cover shadow-md transition-all duration-300 group-hover:shadow-lg group-hover:scale-105"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shadow-md">
            <Music size={14} className="text-gray-400" />
          </div>
        )}
        
        {/* Play overlay on hover */}
        {canPlay && !isCurrentTrack && (
          <div className="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <Play size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Title + artist - more compact spacing */}
      <div className="flex-1 min-w-0">
        <p className={`font-fun font-bold track-title truncate leading-tight ${
          isCurrentTrack ? 'text-blue-200' : 'text-gray-800'
        } transition-colors duration-200`}>
          {title}
        </p>
        <p className="track-artist text-gray-600 truncate leading-tight mt-0.5 font-main font-medium">
          {artist}
        </p>
        
        {/* Compact status indicators */}
        {isCurrentTrack && isPlaying && (
          <div className="flex items-center gap-1 mt-1">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="text-xs text-blue-400 font-fun font-bold">Playing</span>
          </div>
        )}
        {!isPlayable && (
          <span className="text-xs text-gray-400 font-main">No Spotify ID</span>
        )}
      </div>

      {/* Metric display - redesigned */}
      <div className="text-right min-w-[60px]">
        {sortMode === 'votes' ? (
          <div className="flex flex-col items-end">
            <span className={`text-lg font-fun font-bold ${
              score > 0 ? 'text-green-400' : score < 0 ? 'text-red-400' : 'text-gray-500'
            }`}>
              {score > 0 ? '+' : ''}{score}
            </span>
            <span className="text-xs text-gray-400 font-main">votes</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-lg font-fun font-bold text-gray-700">
              {extraMetric?.split(' ')[0] || 'N/A'}
            </span>
            <span className="text-xs text-gray-400 font-main">
              {extraMetric?.split(' ')[1] || ''}
            </span>
          </div>
        )}
      </div>

      {/* Vote buttons */}
      {isAuthed && (
        <div className="opacity-100 md:opacity-80 md:group-hover:opacity-100 transition-opacity duration-200">
          <VoteButtons
            roomId={roomId}
            trackId={trackId}
            score={score}
            onTrackUpdate={onTrackUpdate}
          />
        </div>
      )}

      {/* Subtle border highlight for current track */}
      {isCurrentTrack && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-400 to-purple-400 rounded-r"></div>
      )}
    </div>
  );
}