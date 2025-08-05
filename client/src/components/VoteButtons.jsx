// client/src/components/VoteButtons.jsx - Enhanced with bigger, more colorful buttons
import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Minus } from 'lucide-react';

export default function VoteButtons({ roomId, trackId, score, onTrackUpdate }) {
  const [pending, setPending] = useState(false);
  const [localScore, setLocalScore] = useState(score);
  const [lastVote, setLastVote] = useState(null); // Track user's last vote for visual feedback

  // Update local score when prop changes (from real-time updates)
  useEffect(() => {
    setLocalScore(score);
  }, [score]);

  const submitVote = async (value) => {
    if (pending) return;
    setPending(true);
    setLastVote(value);

    try {
      const res = await fetch(
        `http://127.0.0.1:4000/api/rooms/${roomId}/tracks/${trackId}/vote`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote: value }),
        }
      );

      if (res.ok) {
        const json = await res.json();
        
        // Update local score immediately for responsive UI
        setLocalScore(json.newScore);
        
        // Also notify parent component for real-time sorting
        if (onTrackUpdate) {
          onTrackUpdate(trackId, json.newScore);
        }
      } else {
        const { error } = await res.json();
        alert(error);
        setLastVote(null);
      }
    } catch (error) {
      console.error('Vote submission failed:', error);
      alert('Failed to submit vote');
      setLastVote(null);
    }
    
    setPending(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Upvote */}
      <button
        className={`vote-btn upvote transition-all duration-300 ${
          pending 
            ? 'opacity-50 cursor-not-allowed' 
            : lastVote === 1
            ? 'scale-110 shadow-lg'
            : 'hover:scale-110'
        }`}
        onClick={() => submitVote(1)}
        disabled={pending}
        title="Upvote"
      >
        <ThumbsUp size={14} className={lastVote === 1 ? 'fill-current' : ''} />
      </button>

      {/* Neutral/Remove vote */}
      <button
        className={`vote-btn neutral transition-all duration-300 ${
          pending 
            ? 'opacity-50 cursor-not-allowed' 
            : lastVote === 0
            ? 'scale-110 shadow-lg'
            : 'hover:scale-110'
        }`}
        onClick={() => submitVote(0)}
        disabled={pending}
        title="Remove vote"
      >
        <Minus size={14} />
      </button>

      {/* Downvote */}
      <button
        className={`vote-btn downvote transition-all duration-300 ${
          pending 
            ? 'opacity-50 cursor-not-allowed' 
            : lastVote === -1
            ? 'scale-110 shadow-lg'
            : 'hover:scale-110'
        }`}
        onClick={() => submitVote(-1)}
        disabled={pending}
        title="Downvote"
      >
        <ThumbsDown size={14} className={lastVote === -1 ? 'fill-current' : ''} />
      </button>

      {/* Score display with loading state */}
      <div className="flex items-center gap-1 ml-2">
        {pending && (
          <div className="loading-spinner w-4 h-4"></div>
        )}
        <span className={`text-sm font-fun font-bold min-w-[24px] text-center transition-all duration-300 px-2 py-1 rounded-lg ${
          pending ? 'text-gray-400 bg-gray-100' : 
          localScore > 0 ? 'text-green-600 bg-green-100' : 
          localScore < 0 ? 'text-red-500 bg-red-100' : 'text-gray-500 bg-gray-100'
        }`}>
          {localScore > 0 ? '+' : ''}{localScore}
        </span>
      </div>
    </div>
  );
}