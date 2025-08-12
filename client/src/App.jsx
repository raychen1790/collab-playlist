// client/src/App.jsx - Enhanced with modern design system
import { useContext } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthContext, AuthProvider } from './contexts/AuthContext';
import Home from './pages/Home';
import RoomPage from './pages/RoomPage';
import { Music, Sparkles } from 'lucide-react';

// Background component for animated particles
function AnimatedBackground() {
  return (
    <>
      {/* Primary animated gradient background */}
      <div className="fixed inset-0 bg-gradient-animated bg-[length:400%_400%] animate-gradient-shift -z-10"></div>
      
      {/* Floating particles overlay */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 opacity-30">
          {/* Large floating orbs */}
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-float-pulse"></div>
          <div className="absolute top-3/4 right-1/4 w-48 h-48 bg-gradient-to-r from-pink-400/20 to-orange-400/20 rounded-full blur-3xl animate-float-pulse" style={{animationDelay: '2s'}}></div>
          <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-gradient-to-r from-green-400/20 to-blue-400/20 rounded-full blur-2xl animate-float-pulse" style={{animationDelay: '4s'}}></div>
        </div>
        
        {/* Micro particles */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_75%,rgba(255,255,255,0.1)_1px,transparent_1px),radial-gradient(circle_at_75%_25%,rgba(255,255,255,0.08)_2px,transparent_2px),radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:100px_100px,150px_150px,200px_200px] animate-particle-float"></div>
      </div>
    </>
  );
}

// Loading screen with advanced animations
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center font-main relative overflow-hidden">
      <AnimatedBackground />
      
      <div className="glass-card p-12 text-center max-w-md mx-4 floating-element">
        {/* Animated logo container */}
        <div className="relative mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-primary rounded-3xl shadow-floating">
            <Music size={48} className="text-white animate-spin-slow" />
          </div>
          
          {/* Orbital rings */}
          <div className="absolute inset-0 border-2 border-white/20 rounded-3xl animate-spin"></div>
          <div className="absolute inset-2 border border-white/10 rounded-2xl animate-spin" style={{animationDirection: 'reverse', animationDuration: '3s'}}></div>
        </div>

        <h2 className="text-3xl font-fun font-bold text-gradient-animated mb-4">
          Loading Magic...
        </h2>
        <p className="text-white/80 font-medium mb-6">
          Setting up your collaborative playlist experience
        </p>
        
        {/* Advanced loading bar */}
        <div className="progress-bar">
          <div className="progress-fill w-3/4"></div>
        </div>
      </div>
    </div>
  );
}

// Enhanced navigation component
function Navigation() {
  const { user } = useContext(AuthContext);
  
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="glass-card px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center shadow-lg">
              <Music size={20} className="text-white" />
            </div>
            <span className="font-fun font-bold text-xl text-gradient hidden sm:block">
              Collaborative Playlist
            </span>
          </div>
          
          {/* User info */}
          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-white/90 font-fun font-bold text-sm">
                  {user.display_name}
                </span>
              </div>
              
              {/* User avatar placeholder */}
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-white font-fun font-bold text-sm">
                  {user.display_name?.charAt(0) || 'U'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

// Main app content
function AppContent() {
  const { loading } = useContext(AuthContext);
  
  if (loading) {
    return <LoadingScreen />;
  }
  
  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      
      <Router>
        <div className="relative z-10">
          <Navigation />
          
          {/* Main content with top padding for fixed nav */}
          <main className="pt-20">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/rooms/:roomId" element={<RoomPage />} />
            </Routes>
          </main>
        </div>
      </Router>
      
      {/* Ambient glow effects */}
      <div className="fixed bottom-0 left-0 w-96 h-96 bg-gradient-to-t from-blue-500/20 to-transparent blur-3xl -z-10"></div>
      <div className="fixed top-0 right-0 w-96 h-96 bg-gradient-to-b from-purple-500/20 to-transparent blur-3xl -z-10"></div>
    </div>
  );
}

// Root App component
export default function App() {
  return (
    <AuthProvider>
      <div className="scrollbar-modern">
        <AppContent />
      </div>
    </AuthProvider>
  );
}