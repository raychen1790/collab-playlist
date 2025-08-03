// client/src/components/MusicPlayer.jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Volume2, 
  VolumeX,
  List,
  X,
  Music
} from 'lucide-react';

export default function MusicPlayer({ 
  tracks = [], 
  sortMode, 
  isPlaying, 
  currentTrack, 
  spotifyReady,
  spotifyActive,
  spotifyError,
  position = 0,
  duration = 0,
  volume = 0.5,
  onPlay, 
  onPause, 
  onNext, 
  onPrevious, 
  onSeek,
  onVolumeChange,
  shuffleMode = false,
  onShuffle,
  transferPlayback,
  playQueue = [],
  currentTrackIndex = 0,
  onPlayTrackFromQueue
}) {
  const [showQueue, setShowQueue] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(volume);
  const progressRef = useRef(null);
  const volumeRef = useRef(null);

  // Format time in MM:SS
  const formatTime = (milliseconds) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle progress bar interaction
  const handleProgressClick = useCallback((e) => {
    if (!progressRef.current || !duration || !onSeek) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newPosition = Math.max(0, Math.min(duration, percent * duration));
    onSeek(newPosition);
  }, [duration, onSeek]);

  const handleProgressMouseDown = useCallback((e) => {
    setIsDragging(true);
    handleProgressClick(e);
  }, [handleProgressClick]);

  const handleProgressMouseMove = useCallback((e) => {
    if (isDragging) {
      handleProgressClick(e);
    }
  }, [isDragging, handleProgressClick]);

  const handleProgressMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Volume control
  const handleVolumeClick = useCallback((e) => {
    if (!volumeRef.current || !onVolumeChange) return;
    
    const rect = volumeRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newVolume = Math.max(0, Math.min(1, percent));
    onVolumeChange(newVolume);
  }, [onVolumeChange]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      onVolumeChange(previousVolume);
      setIsMuted(false);
    } else {
      setPreviousVolume(volume);
      onVolumeChange(0);
      setIsMuted(true);
    }
  }, [isMuted, volume, previousVolume, onVolumeChange]);

  // Global mouse events for dragging
  const handleGlobalMouseMove = useCallback((e) => {
    if (isDragging) {
      handleProgressClick(e);
    }
  }, [isDragging, handleProgressClick]);

  const handleGlobalMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global event listeners when dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDragging, handleGlobalMouseMove, handleGlobalMouseUp]);

  const progressPercent = duration ? (position / duration) * 100 : 0;
  const effectiveVolume = isMuted ? 0 : volume;

  // Debug logging
  console.log('🎵 MusicPlayer Debug:', {
    position,
    duration,
    progressPercent,
    isPlaying,
    currentTrack: currentTrack?.title || currentTrack?.name,
    spotifyReady,
    spotifyActive
  });

  return (
    <>
      {/* Queue Overlay */}
      {showQueue && (
        <div 
          style={{
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: '50',
            display: 'flex',
            alignItems: 'flex-end'
          }}
        >
          <div style={{
            width: '100%',
            backgroundColor: 'white',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            maxHeight: '400px',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', margin: '0' }}>
                Queue ({playQueue.length} tracks)
              </h3>
              <button
                onClick={() => {
                  console.log('Closing queue');
                  setShowQueue(false);
                }}
                style={{
                  padding: '4px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ 
              overflowY: 'auto', 
              maxHeight: '320px' 
            }}>
              {playQueue.slice(currentTrackIndex).map((trackIndex, displayIndex) => {
                const track = tracks[trackIndex];
                const actualQueueIndex = currentTrackIndex + displayIndex;
                if (!track) {
                  console.log('Missing track at index:', trackIndex);
                  return null;
                }
                
                const isCurrentInQueue = displayIndex === 0; // First item is always current
                
                return (
                  <div
                    key={`queue-${actualQueueIndex}-${track.trackId || trackIndex}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      cursor: 'pointer',
                      backgroundColor: isCurrentInQueue ? '#eff6ff' : 'transparent',
                      borderLeft: isCurrentInQueue ? '4px solid #2563eb' : '4px solid transparent'
                    }}
                    onClick={() => {
                      console.log('Clicked queue item:', actualQueueIndex, track.title);
                      onPlayTrackFromQueue?.(actualQueueIndex);
                      setShowQueue(false);
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrentInQueue) {
                        e.target.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrentInQueue) {
                        e.target.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{ 
                      width: '32px', 
                      fontSize: '14px', 
                      color: '#6b7280',
                      textAlign: 'center'
                    }}>
                      {isCurrentInQueue ? '▶' : displayIndex + 1}
                    </div>
                    {track.albumArt ? (
                      <img
                        src={track.albumArt}
                        alt=""
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '40px',
                        height: '40px',
                        backgroundColor: '#e5e7eb',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Music size={16} style={{ color: '#9ca3af' }} />
                      </div>
                    )}
                    <div style={{ flex: '1', minWidth: '0' }}>
                      <p style={{
                        fontWeight: '500',
                        margin: '0',
                        marginBottom: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: isCurrentInQueue ? '#1d4ed8' : '#000'
                      }}>
                        {track.title}
                      </p>
                      <p style={{
                        fontSize: '14px',
                        color: '#6b7280',
                        margin: '0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {track.artist}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Player */}
      <div style={{
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        width: '100%',
        backgroundColor: 'white',
        borderTop: '1px solid #e5e7eb',
        boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1)',
        zIndex: '40'
      }}>
        <div style={{ maxWidth: '100%', margin: '0 auto' }}>
          {/* Progress Bar */}
          <div style={{ padding: '16px 16px 8px 16px' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              fontSize: '12px', 
              color: '#6b7280', 
              marginBottom: '4px' 
            }}>
              <span>{formatTime(position)}</span>
              <div style={{ flex: 1 }}></div>
              <span>{formatTime(duration)}</span>
            </div>
            <div
              ref={progressRef}
              style={{
                width: '100%',
                height: '4px',
                backgroundColor: '#e5e7eb',
                borderRadius: '2px',
                cursor: 'pointer',
                position: 'relative'
              }}
              onMouseDown={handleProgressMouseDown}
              onMouseMove={handleProgressMouseMove}
              onMouseUp={handleProgressMouseUp}
            >
              <div
                style={{
                  height: '100%',
                  backgroundColor: '#2563eb',
                  borderRadius: '2px',
                  width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                  position: 'relative',
                  transition: 'width 0.1s ease'
                }}
              >
                <div 
                  style={{
                    position: 'absolute',
                    right: '-6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '12px',
                    height: '12px',
                    backgroundColor: '#2563eb',
                    borderRadius: '50%',
                    opacity: progressPercent > 0 ? '1' : '0',
                    transition: 'opacity 0.2s ease'
                  }}
                />
              </div>
            </div>
            {/* Debug info */}
            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>
              {progressPercent.toFixed(1)}% | {position}ms / {duration}ms
            </div>
          </div>

          {/* Main Controls */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '16px', 
            gap: '16px' 
          }}>
            {/* Current Track Info */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              flex: '1', 
              minWidth: '0' 
            }}>
              {currentTrack?.albumArt ? (
                <img
                  src={currentTrack.albumArt}
                  alt=""
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                    flexShrink: '0'
                  }}
                />
              ) : (
                <div style={{
                  width: '48px',
                  height: '48px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: '0'
                }}>
                  <Music size={20} style={{ color: '#9ca3af' }} />
                </div>
              )}
              <div style={{ minWidth: '0', flex: '1' }}>
                <p style={{ 
                  fontWeight: '500', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap',
                  margin: '0',
                  marginBottom: '2px'
                }}>
                  {currentTrack?.title || currentTrack?.name || 'No track selected'}
                </p>
                <p style={{ 
                  fontSize: '14px', 
                  color: '#6b7280', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap',
                  margin: '0'
                }}>
                  {currentTrack?.artist || 'Unknown artist'}
                </p>
              </div>
            </div>

            {/* Playback Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Shuffle */}
              <button
                onClick={() => {
                  console.log('Shuffle clicked, current mode:', shuffleMode);
                  onShuffle?.();
                }}
                disabled={!spotifyReady}
                style={{
                  padding: '8px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: shuffleMode ? '#dbeafe' : 'transparent',
                  color: shuffleMode ? '#2563eb' : '#6b7280',
                  cursor: spotifyReady ? 'pointer' : 'not-allowed',
                  opacity: spotifyReady ? '1' : '0.5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={shuffleMode ? 'Shuffle On' : 'Shuffle Off'}
              >
                <Shuffle size={18} />
              </button>

              {/* Previous */}
              <button
                onClick={() => {
                  console.log('Previous clicked');
                  onPrevious?.();
                }}
                disabled={!spotifyReady || !spotifyActive}
                style={{
                  padding: '8px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#6b7280',
                  cursor: (spotifyReady && spotifyActive) ? 'pointer' : 'not-allowed',
                  opacity: (spotifyReady && spotifyActive) ? '1' : '0.5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Previous track"
              >
                <SkipBack size={20} />
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => {
                  console.log('Play/Pause clicked, isPlaying:', isPlaying);
                  if (isPlaying) {
                    onPause?.();
                  } else {
                    onPlay?.();
                  }
                }}
                disabled={!spotifyReady || !spotifyActive}
                style={{
                  padding: '12px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  cursor: (spotifyReady && spotifyActive) ? 'pointer' : 'not-allowed',
                  opacity: (spotifyReady && spotifyActive) ? '1' : '0.5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={24} /> : <Play size={24} />}
              </button>

              {/* Next */}
              <button
                onClick={() => {
                  console.log('Next clicked');
                  onNext?.();
                }}
                disabled={!spotifyReady || !spotifyActive}
                style={{
                  padding: '8px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#6b7280',
                  cursor: (spotifyReady && spotifyActive) ? 'pointer' : 'not-allowed',
                  opacity: (spotifyReady && spotifyActive) ? '1' : '0.5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Next track"
              >
                <SkipForward size={20} />
              </button>

              {/* Queue */}
              <button
                onClick={() => {
                  console.log('Queue clicked, playQueue length:', playQueue.length);
                  setShowQueue(true);
                }}
                disabled={playQueue.length === 0}
                style={{
                  padding: '8px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#6b7280',
                  cursor: playQueue.length > 0 ? 'pointer' : 'not-allowed',
                  opacity: playQueue.length > 0 ? '1' : '0.5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={`View queue (${playQueue.length} tracks)`}
              >
                <List size={18} />
              </button>
            </div>

            {/* Volume Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' }}>
              <button
                onClick={toggleMute}
                style={{
                  padding: '8px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#6b7280',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || effectiveVolume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <div
                ref={volumeRef}
                style={{
                  width: '80px',
                  height: '4px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  position: 'relative'
                }}
                onClick={handleVolumeClick}
              >
                <div
                  style={{
                    height: '100%',
                    backgroundColor: '#6b7280',
                    borderRadius: '2px',
                    width: `${effectiveVolume * 100}%`,
                    position: 'relative'
                  }}
                >
                  <div 
                    style={{
                      position: 'absolute',
                      right: '-6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '12px',
                      height: '12px',
                      backgroundColor: '#6b7280',
                      borderRadius: '50%',
                      opacity: effectiveVolume > 0 ? '1' : '0'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Connection Status */}
          {!spotifyReady && (
            <div className="px-4 pb-2">
              <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                Connecting to Spotify...
              </div>
            </div>
          )}
          {spotifyReady && !spotifyActive && (
            <div className="px-4 pb-2">
              <div className="flex items-center justify-between text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                <span>Click "Activate" to play on this device</span>
                <button
                  onClick={transferPlayback}
                  className="text-blue-700 hover:text-blue-800 font-medium"
                >
                  Activate
                </button>
              </div>
            </div>
          )}
          {spotifyError && (
            <div className="px-4 pb-2">
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                {spotifyError}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}