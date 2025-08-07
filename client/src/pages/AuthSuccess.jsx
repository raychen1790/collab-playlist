// client/src/pages/AuthSuccess.jsx
import { useEffect } from 'react';
import { Music } from 'lucide-react';

export default function AuthSuccess() {
  useEffect(() => {
    // This component is just a placeholder
    // The actual token processing is handled in AuthContext
    console.log('AuthSuccess component mounted');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center font-main">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-white/20 to-white/10 backdrop-blur-lg rounded-3xl mb-8 shadow-2xl border border-white/20">
          <Music size={48} className="text-white animate-pulse" />
        </div>
        <h1 className="text-3xl font-fun font-bold text-white mb-4">
          Processing authentication...
        </h1>
        <div className="loading-spinner w-8 h-8 mx-auto"></div>
      </div>
    </div>
  );
}