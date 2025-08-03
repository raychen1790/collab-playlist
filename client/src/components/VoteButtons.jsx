// client/src/components/VoteButtons.jsx
import { useState, useEffect } from 'react';

export default function VoteButtons({ roomId, trackId, score, onTrackUpdate }) {
  const [pending, setPending] = useState(false);
  const [localScore, setLocalScore] = useState(score);

  // Update local score when prop changes (from real-time updates)
  useEffect(() => {
    setLocalScore(score);
  }, [score]);

  const submitVote = async (value) => {
    if (pending) return;
    setPending(true);

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
      }
    } catch (error) {
      console.error('Vote submission failed:', error);
      alert('Failed to submit vote');
    }
    
    setPending(false);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        className={`px-2 py-1 rounded text-sm transition-colors ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed' 
            : 'hover:bg-green-100 hover:text-green-700'
        }`}
        onClick={() => submitVote(1)}
        disabled={pending}
        title="Upvote"
      >
        👍
      </button>

      <button
        className={`px-2 py-1 rounded text-sm transition-colors ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed' 
            : 'hover:bg-gray-200'
        }`}
        onClick={() => submitVote(0)}
        disabled={pending}
        title="Neutral (remove vote)"
      >
        ➖
      </button>

      <button
        className={`px-2 py-1 rounded text-sm transition-colors ${
          pending 
            ? 'bg-gray-100 cursor-not-allowed' 
            : 'hover:bg-red-100 hover:text-red-700'
        }`}
        onClick={() => submitVote(-1)}
        disabled={pending}
        title="Downvote"
      >
        👎
      </button>

      <span className={`w-8 text-center font-semibold text-sm ${
        pending ? 'text-gray-400' : 'text-blue-600'
      }`}>
        {localScore}
      </span>
      
      {pending && (
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      )}
    </div>
  );
}