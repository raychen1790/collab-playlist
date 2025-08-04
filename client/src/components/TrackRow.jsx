// client/src/components/TrackRow.jsx
import VoteButtons from './VoteButtons.jsx';
import { Play, Pause, Music } from 'lucide-react';

/**
 * Modern, compact TrackRow with smooth animations and glassmorphism
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
    if (!isPlayable) return <Music size={14} />;
    if (isCurrentTrack && isPlaying) return <Pause size={14} />;
    return <Play size={14} />;
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
      className={`track-row group relative flex items-center gap-3 py-2.5 px-3 border-b border-gray-100/50 last:border-b-0 ${
        isCurrentTrack 
          ? 'bg-gradient-to-r from-blue-50/80 to-purple-50/80 border-blue-200/30' 
          : 'hover:bg-white/60'
      }`}
      style={{
        animationDelay: `${position * 50}ms`
      }}
    >
      {/* Subtle glow for current track */}
      {isCurrentTrack && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400/5 to-purple-400/5 rounded-lg"></div>
      )}

      {/* Position indicator - more subtle and compact */}
      <div className="w-6 text-right">
        <span className={`text-xs font-medium ${
          isCurrentTrack ? 'text-blue-600' : 'text-gray-400'
        }`}>
          {position}
        </span>
      </div>

      {/* Play/pause button - more modern design */}
      <button
        onClick={handlePlayPauseClick}
        disabled={!canPlay}
        className={`relative p-1.5 rounded-lg transition-all duration-300 ${
          canPlay 
            ? `hover:bg-white/80 hover:shadow-lg hover:shadow-blue-500/20 ${
                isCurrentTrack && isPlaying 
                  ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30' 
                  : 'text-gray-600 hover:text-blue-600'
              }` 
            : 'text-gray-300 cursor-not-allowed opacity-50'
        }`}
        title={getPlayButtonTitle()}
      >
        {getPlayButtonIcon()}
        
        {/* Pulsing indicator for currently playing */}
        {isCurrentTrack && isPlaying && (
          <div className="absolute inset-0 rounded-lg bg-blue-500 animate-pulse opacity-30"></div>
        )}
      </button>

      {/* Album cover - smaller and more refined */}
      <div className="relative group">
        {albumArt ? (
          <img
            src={albumArt}
            alt=""
            className="w-10 h-10 rounded-lg object-cover shadow-sm transition-all duration-300 group-hover:shadow-md"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <Music size={12} className="text-gray-400" />
          </div>
        )}
        
        {/* Play overlay on hover */}
        {canPlay && !isCurrentTrack && (
          <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <Play size={12} className="text-white" />
          </div>
        )}
      </div>

      {/* Title + artist - more compact spacing */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm truncate leading-tight ${
          isCurrentTrack ? 'text-blue-700' : 'text-gray-900'
        } transition-colors duration-200`}>
          {title}
        </p>
        <p className="text-xs text-gray-500 truncate leading-tight mt-0.5">
          {artist}
        </p>
        
        {/* Compact status indicators */}
        {isCurrentTrack && isPlaying && (
          <div className="flex items-center gap-1 mt-0.5">
            <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-blue-500 font-medium">Playing</span>
          </div>
        )}
        {!isPlayable && (
          <span className="text-xs text-gray-400">No Spotify ID</span>
        )}
      </div>

      {/* Metric display - redesigned */}
      <div className="text-right min-w-[60px]">
        {sortMode === 'votes' ? (
          <div className="flex flex-col items-end">
            <span className={`text-sm font-bold ${
              score > 0 ? 'text-green-600' : score < 0 ? 'text-red-500' : 'text-gray-500'
            }`}>
              {score > 0 ? '+' : ''}{score}
            </span>
            <span className="text-xs text-gray-400">votes</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-sm font-semibold text-gray-700">
              {extraMetric?.split(' ')[0] || 'N/A'}
            </span>
            <span className="text-xs text-gray-400">
              {extraMetric?.split(' ')[1] || ''}
            </span>
          </div>
        )}
      </div>

      {/* Vote buttons */}
      {isAuthed && (
        <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
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
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 to-purple-500 rounded-r"></div>
      )}
    </div>
  );
}