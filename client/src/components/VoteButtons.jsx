// client/src/components/VoteButtons.jsx - Enhanced with liquid animations and micro-interactions
import { useState, useEffect, useContext } from 'react';
import { ThumbsUp, ThumbsDown, Minus, Loader2 } from 'lucide-react';
import { AuthContext } from '../contexts/AuthContext.jsx';

export default function VoteButtons({ roomId, trackId, score, onTrackUpdate }) {
  const [pending, setPending] = useState(false);
  const [localScore, setLocalScore] = useState(score);
  const [lastVote, setLastVote] = useState(null);
  const [animateScore, setAnimateScore] = useState(false);
  
  // Use AuthContext for enhanced API requests
  const { apiRequest } = useContext(AuthContext);

  // Update local score when prop changes with animation
  useEffect(() => {
    if (score !== localScore) {
      setAnimateScore(true);
      setTimeout(() => setAnimateScore(false), 600);
    }
    setLocalScore(score);
  }, [score]);

  const submitVote = async (value) => {
    if (pending) return;
    setPending(true);
    setLastVote(value);

    try {
      console.log('🗳️ Submitting vote via AuthContext to:', `/api/rooms/${roomId}/tracks/${trackId}/vote`);
      
      // Use AuthContext's apiRequest instead of direct fetch
      const res = await apiRequest(`/api/rooms/${roomId}/tracks/${trackId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: value }),
      });

      if (res.ok) {
        const json = await res.json();
        console.log('✅ Vote submitted successfully:', json);
        
        // Update local score immediately for responsive UI with animation
        setAnimateScore(true);
        setLocalScore(json.newScore);
        setTimeout(() => setAnimateScore(false), 600);
        
        // Also notify parent component for real-time sorting
        if (onTrackUpdate) {
          onTrackUpdate(trackId, json.newScore);
        }
      } else {
        const errorData = await res.json();
        console.error('❌ Vote submission failed:', res.status, errorData);
        alert(errorData.error || 'Failed to submit vote');
        setLastVote(null);
      }
    } catch (error) {
      console.error('❌ Vote submission error:', error);
      alert('Failed to submit vote - network error');
      setLastVote(null);
    }
    
    setPending(false);
  };

  const getScoreColor = () => {
    if (localScore > 0) return 'from-green-400 to-emerald-500';
    if (localScore < 0) return 'from-red-400 to-rose-500';
    return 'from-gray-400 to-slate-500';
  };

  const getScoreTextColor = () => {
    if (localScore > 0) return 'text-green-100';
    if (localScore < 0) return 'text-red-100';
    return 'text-gray-100';
  };

  return (
    <div className="flex items-center gap-2">
      {/* Enhanced Upvote Button */}
      <button
        className={`vote-btn upvote transition-all duration-500 ease-out relative overflow-hidden ${
          pending 
            ? 'opacity-50 cursor-not-allowed scale-95' 
            : lastVote === 1
            ? 'scale-125 shadow-neon-green animate-liquid-bounce'
            : 'hover:scale-110 hover:rotate-12'
        }`}
        onClick={() => submitVote(1)}
        disabled={pending}
        title="Upvote"
      >
        <ThumbsUp 
          size={12} 
          className={`relative z-10 transition-all duration-300 ${
            lastVote === 1 ? 'fill-current scale-110' : ''
          }`} 
        />
        
        {/* Liquid ripple effect */}
        {lastVote === 1 && (
          <div className="absolute inset-0 bg-white/30 rounded-full animate-ping"></div>
        )}
        
        {/* Shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-700"></div>
      </button>

      {/* Enhanced Neutral/Remove vote Button */}
      <button
        className={`vote-btn neutral transition-all duration-500 ease-out relative overflow-hidden ${
          pending 
            ? 'opacity-50 cursor-not-allowed scale-95' 
            : lastVote === 0
            ? 'scale-125 shadow-lg animate-liquid-bounce'
            : 'hover:scale-110 hover:rotate-6'
        }`}
        onClick={() => submitVote(0)}
        disabled={pending}
        title="Remove vote"
      >
        <Minus 
          size={12} 
          className={`relative z-10 transition-all duration-300 ${
            lastVote === 0 ? 'scale-110' : ''
          }`} 
        />
        
        {/* Liquid ripple effect */}
        {lastVote === 0 && (
          <div className="absolute inset-0 bg-white/30 rounded-full animate-ping"></div>
        )}
      </button>

      {/* Enhanced Downvote Button */}
      <button
        className={`vote-btn downvote transition-all duration-500 ease-out relative overflow-hidden ${
          pending 
            ? 'opacity-50 cursor-not-allowed scale-95' 
            : lastVote === -1
            ? 'scale-125 shadow-neon-pink animate-liquid-bounce'
            : 'hover:scale-110 hover:-rotate-12'
        }`}
        onClick={() => submitVote(-1)}
        disabled={pending}
        title="Downvote"
      >
        <ThumbsDown 
          size={12} 
          className={`relative z-10 transition-all duration-300 ${
            lastVote === -1 ? 'fill-current scale-110' : ''
          }`} 
        />
        
        {/* Liquid ripple effect */}
        {lastVote === -1 && (
          <div className="absolute inset-0 bg-white/30 rounded-full animate-ping"></div>
        )}
        
        {/* Shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-700"></div>
      </button>

      {/* Enhanced Score display with morphing animations */}
      <div className="flex items-center gap-2 ml-1">
        {/* Loading spinner with neon glow */}
        {pending && (
          <div className="relative">
            <Loader2 size={16} className="animate-spin text-blue-400" />
            <div className="absolute inset-0 animate-ping">
              <Loader2 size={16} className="text-blue-400/50" />
            </div>
          </div>
        )}
        
        {/* Score badge with liquid morphing */}
        <div 
          className={`relative overflow-hidden transition-all duration-[600ms] ease-out ${
            animateScore ? 'animate-liquid-bounce scale-125' : 'scale-100'
          }`}
        >
          <div className={`px-3 py-1.5 rounded-xl font-fun font-bold text-sm min-w-[40px] text-center transition-all duration-500 bg-gradient-to-r ${getScoreColor()} ${getScoreTextColor()} shadow-lg backdrop-blur-sm border border-white/20`}>
            {localScore > 0 ? '+' : ''}{localScore}
          </div>
          
          {/* Holographic shine effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
          
          {/* Pulsing border for high scores */}
          {Math.abs(localScore) >= 5 && (
            <div className="absolute inset-0 rounded-xl border-2 border-white/50 animate-pulse"></div>
          )}
          
          {/* Particle burst effect for score changes */}
          {animateScore && (
            <>
              <div className="absolute -top-1 -left-1 w-2 h-2 bg-white/60 rounded-full animate-ping"></div>
              <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-white/60 rounded-full animate-ping" style={{animationDelay: '0.1s'}}></div>
              <div className="absolute -bottom-1 -left-1 w-1 h-1 bg-white/60 rounded-full animate-ping" style={{animationDelay: '0.2s'}}></div>
              <div className="absolute -bottom-1 -right-1 w-1.5 h-1.5 bg-white/60 rounded-full animate-ping" style={{animationDelay: '0.15s'}}></div>
            </>
          )}
        </div>
        
        {/* Trending indicator for high-scoring tracks */}
        {localScore >= 10 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gradient-to-r from-yellow-400/20 to-orange-500/20 border border-yellow-400/40 backdrop-blur-sm">
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
            <span className="text-xs font-fun font-bold text-yellow-200">Hot</span>
          </div>
        )}
      </div>
    </div>
  );
}