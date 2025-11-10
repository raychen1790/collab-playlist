// client/src/components/TrackRow.jsx 
import VoteButtons from './VoteButtons.jsx';
import { Play, Pause, Music, Zap, Activity, Volume2, Loader } from 'lucide-react';

export default function TrackRow({
  roomId,
  track,
  sortMode,
  isAuthed,
  onTrackUpdate,
  position,
  isPlaying,
  isCurrentTrack,
  isLoading = false,
  onPlay,
  onPause,
  trackIndex,
  spotifyReady = false,
  spotifyActive = false,
  previewMode = false, 
}) {
  const { trackId, title, artist, albumArt, score, spotifyId, previewUrl,
          tempo, energy, danceability } = track;

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

  const isPlayable = previewMode 
    ? !!(title && artist) // In preview mode, any track with title/artist is potentially playable
    : !!spotifyId; // In Spotify mode, need Spotify ID

  const canPlay = previewMode 
    ? isPlayable && !isLoading // In preview mode, playable if has title/artist and not currently loading
    : (isPlayable && spotifyReady && spotifyActive); 

  const getPlayButtonIcon = () => {
    if (isLoading) return <Loader size={16} className="animate-spin" />; 
    if (!isPlayable) return <Music size={16} />;
    if (isCurrentTrack && isPlaying) return <Pause size={16} />;
    return <Play size={16} />;
  };

  const getPlayButtonTitle = () => {
    if (isLoading) return previewMode ? 'Searching for preview...' : 'Loading...';
    if (!isPlayable) {
      return previewMode ? 'No title/artist for preview search' : 'No Spotify ID available';
    }
    if (!previewMode && !spotifyReady) return 'Connecting to Spotify...';
    if (!previewMode && !spotifyActive) return 'Activate Spotify playback first';
    if (isCurrentTrack && isPlaying) return 'Pause track';
    return previewMode ? 'Play 30s preview' : 'Play track';
  };

  // Get position indicator styling
  const getPositionStyle = () => {
    if (position <= 3) return 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white';
    if (position <= 10) return 'bg-gradient-to-r from-blue-400 to-purple-500 text-white';
    return 'bg-white/20 text-white/80';
  };

  return (
    <div 
      className={`track-row-compact group relative flex items-center gap-4 py-4 px-5 border-b border-white/10 last:border-b-0 transition-all duration-500 ease-out ${
        isCurrentTrack 
          ? 'bg-gradient-to-r from-blue-400/20 via-purple-400/20 to-pink-400/20 border-blue-300/30 shadow-lg' 
          : 'hover:bg-white/10'
      }`}
      style={{
        animationDelay: `${position * 50}ms`
      }}
    >

      {isCurrentTrack && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400/10 via-purple-400/10 to-pink-400/10 rounded-lg animate-pulse"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-holographic-shine"></div>
        </>
      )}

      <div className="relative">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-fun font-bold shadow-lg transition-all duration-300 ${getPositionStyle()}`}>
          {position}
        </div>
        
        {position <= 3 && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-gradient-to-r from-yellow-300 to-yellow-500 rounded-full border border-white/50 animate-pulse"></div>
        )}
      </div>


      <button
        onClick={handlePlayPauseClick}
        disabled={!canPlay && !isLoading}
        className={`play-btn btn-liquid relative ${
          canPlay || isLoading
            ? `${isCurrentTrack && isPlaying ? 'playing' : ''} ${isLoading ? 'loading' : ''}` 
            : 'opacity-30 cursor-not-allowed'
        }`}
        title={getPlayButtonTitle()}
      >
        {getPlayButtonIcon()}
        
        {/* Preview mode indicator show for all playable tracks in preview mode */}
        {previewMode && isPlayable && !isLoading && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-gradient-to-r from-blue-300 to-purple-300 rounded-full border border-white/50">
            <Volume2 size={8} className="text-white p-0.5" />
          </div>
        )}
        
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-gradient-to-r from-orange-300 to-yellow-300 rounded-full border border-white/50 animate-pulse">
            <Loader size={8} className="text-white p-0.5 animate-spin" />
          </div>
        )}
        
        {/* Pulsing indicator for currently playing */}
        {isCurrentTrack && isPlaying && (
          <>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400 to-purple-400 animate-pulse opacity-20"></div>
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-blue-400/50 to-purple-400/50 animate-ping opacity-20"></div>
          </>
        )}
      </button>

      {/* 3D Album cover with enhanced hover effects */}
      <div className="relative group/album">
        <div className="card-3d">
          {albumArt ? (
            <img
              src={albumArt}
              alt=""
              className="w-14 h-14 rounded-xl object-cover shadow-lg transition-all duration-500 group-hover/album:shadow-2xl"
              style={{
                filter: isCurrentTrack ? 'brightness(1.1) saturate(1.2)' : 'none'
              }}
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-100 to-gray-300 flex items-center justify-center shadow-lg">
              <Music size={16} className="text-gray-500" />
            </div>
          )}
          
          {/* Holographic overlay on hover */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400/0 via-purple-400/20 to-pink-400/0 opacity-0 group-hover/album:opacity-100 transition-opacity duration-500"></div>
        </div>
        
        {/* Play overlay with liquid effect */}
        {canPlay && !isCurrentTrack && !isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-xl opacity-0 group-hover/album:opacity-100 transition-all duration-300 flex items-center justify-center">
            <Play size={16} className="text-white drop-shadow-lg" />
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-xl flex items-center justify-center">
            <Loader size={16} className="text-white drop-shadow-lg animate-spin" />
          </div>
        )}
      </div>

      {/* Enhanced title + artist section */}
      <div className="flex-1 min-w-0">
        <p className={`font-fun font-bold track-title truncate leading-tight text-lg transition-colors duration-300 ${
          isCurrentTrack ? 'text-gradient-animated' : 'text-white/90'
        }`}>
          {title}
        </p>
        <p className="track-artist text-white/70 truncate leading-tight mt-1 font-main font-medium">
          {artist}
        </p>
        
        {/* Enhanced status indicators */}
        {isCurrentTrack && isPlaying && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1">
              <div className="w-1 h-3 bg-blue-400 rounded-full animate-pulse"></div>
              <div className="w-1 h-4 bg-purple-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
              <div className="w-1 h-2 bg-pink-400 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
            </div>
            <span className="text-xs text-blue-300 font-fun font-bold">
              {previewMode ? 'Preview Playing' : 'Now Playing'}
            </span>
          </div>
        )}
        
        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-1 mt-1">
            <Loader size={12} className="text-orange-400 animate-spin" />
            <span className="text-xs text-orange-300 font-main">
              Searching for preview...
            </span>
          </div>
        )}
        
        {/* Not playable indicators */}
        {!isPlayable && !isLoading && (
          <div className="flex items-center gap-1 mt-1">
            <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
            <span className="text-xs text-yellow-300 font-main">
              {previewMode ? 'Missing title/artist' : 'No Spotify ID'}
            </span>
          </div>
        )}
        
        {/* Preview available indicator */}
        {previewMode && isPlayable && !isLoading && !isCurrentTrack && (
          <div className="flex items-center gap-1 mt-1">
            <Volume2 size={12} className="text-blue-300" />
            <span className="text-xs text-blue-300 font-main">Preview search available</span>
          </div>
        )}
      </div>

      {/* Enhanced metric display with visual indicators */}
      <div className="text-right min-w-[80px]">
        {sortMode === 'votes' ? (
          <div className="flex flex-col items-end">
            <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl backdrop-blur-lg transition-all duration-300 ${
              score > 0 
                ? 'bg-green-400/20 border border-green-400/40' 
                : score < 0 
                ? 'bg-red-400/20 border border-red-400/40' 
                : 'bg-gray-400/20 border border-gray-400/40'
            }`}>
              <span className={`text-lg font-fun font-bold ${
                score > 0 ? 'text-green-300' : score < 0 ? 'text-red-300' : 'text-gray-300'
              }`}>
                {score > 0 ? '+' : ''}{score}
              </span>
            </div>
            <span className="text-xs text-white/60 font-main mt-1">votes</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-white/10 backdrop-blur-lg border border-white/20">
              {sortMode === 'tempo' && <Activity size={14} className="text-blue-400" />}
              {sortMode === 'energy' && <Zap size={14} className="text-yellow-400" />}
              {sortMode === 'dance' && <Music size={14} className="text-purple-400" />}
              <span className="text-lg font-fun font-bold text-white">
                {extraMetric?.split(' ')[0] || 'N/A'}
              </span>
            </div>
            <span className="text-xs text-white/60 font-main mt-1">
              {extraMetric?.split(' ')[1] || ''}
            </span>
          </div>
        )}
      </div>

      {/* Enhanced vote buttons with better mobile visibility */}
      {isAuthed && (
        <div className="opacity-100 transition-opacity duration-300">
          <VoteButtons
            roomId={roomId}
            trackId={trackId}
            score={score}
            onTrackUpdate={onTrackUpdate}
          />
        </div>
      )}

      {/* Liquid border highlight for current track */}
      {isCurrentTrack && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-400 via-purple-400 to-pink-400 rounded-r animate-gradient-shift"></div>
      )}

      {/* Ambient glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-purple-400/5 to-pink-400/0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
    </div>
  );
}