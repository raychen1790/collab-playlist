// client/src/components/VoteButtons.jsx
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
    <div className="flex items-center gap-1">
      {/* Upvote */}
      <button
        className={`vote-btn p-1.5 rounded-lg transition-all duration-200 ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed opacity-50' 
            : lastVote === 1
            ? 'bg-green-100 text-green-700 shadow-sm'
            : 'hover:bg-green-50 hover:text-green-600 text-gray-500'
        }`}
        onClick={() => submitVote(1)}
        disabled={pending}
        title="Upvote"
      >
        <ThumbsUp size={12} className={lastVote === 1 ? 'fill-current' : ''} />
      </button>

      {/* Neutral/Remove vote */}
      <button
        className={`vote-btn p-1.5 rounded-lg transition-all duration-200 ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed opacity-50' 
            : lastVote === 0
            ? 'bg-gray-100 text-gray-700 shadow-sm'
            : 'hover:bg-gray-50 hover:text-gray-600 text-gray-400'
        }`}
        onClick={() => submitVote(0)}
        disabled={pending}
        title="Remove vote"
      >
        <Minus size={12} />
      </button>

      {/* Downvote */}
      <button
        className={`vote-btn p-1.5 rounded-lg transition-all duration-200 ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed opacity-50' 
            : lastVote === -1
            ? 'bg-red-100 text-red-700 shadow-sm'
            : 'hover:bg-red-50 hover:text-red-600 text-gray-500'
        }`}
        onClick={() => submitVote(-1)}
        disabled={pending}
        title="Downvote"
      >
        <ThumbsDown size={12} className={lastVote === -1 ? 'fill-current' : ''} />
      </button>

      {/* Score display with loading state */}
      <div className="flex items-center gap-1 ml-1">
        {pending && (
          <div className="loading-spinner w-3 h-3"></div>
        )}
        <span className={`text-xs font-semibold min-w-[20px] text-center transition-all duration-300 ${
          pending ? 'text-gray-400' : 
          localScore > 0 ? 'text-green-600' : 
          localScore < 0 ? 'text-red-500' : 'text-gray-500'
        }`}>
          {localScore > 0 ? '+' : ''}{localScore}
        </span>
      </div>
    </div>
  );
}