# 🎵 Collaborative Playlist — Real-Time Spotify Voting App

A full-stack, real-time web application that transforms any Spotify playlist into a collaborative, crowd-controlled experience.
Hosts create a shared “party room”, guests log in with their Spotify account, vote tracks up/down, and instantly reorder the playlist by votes, tempo, energy, or danceability.
Playback is handled entirely in-browser via the Spotify Web Playback SDK
---

| Category                      | Highlights                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication & Playback** | • Secure Spotify OAuth 2.0 with silent token refresh<br>• Spotify Web Playback SDK: play, pause, skip, shuffle, seek, volume control<br>• Device activation flow for browser-based playback                   |
| **Real-Time Collaboration**   | • Supabase Realtime subscriptions for `votes` and `tracks`<br>• Instant re-sorting and live UI updates across all connected clients                                                                           |
| **Smart Audio Features**      | • Uses Spotify audio features where available<br>• Falls back to **MusicBrainz + AcousticBrainz** APIs for tempo/energy/danceability<br>• All results cached in Postgres for fast retrieval                   |
| **Robust Data Model**         | • Normalized schema: `rooms`, `tracks`, `votes`, `audio_features`, `room_members`<br>• Row-Level Security (RLS) for multi-room isolation                                                                      |
| **User Experience**           | • React + Tailwind UI with persistent bottom music player<br>• Progress bar with seeking support<br>• Sort toolbar (votes / tempo / energy / danceability)<br>• Host-only “Play All” & shuffle queue controls |
| **Developer Workflow**        | • Modular Express API<br>• Vite + HMR for rapid frontend iteration<br>• Supabase CLI for local Postgres + Realtime<br>• One-command deploy to Render (API) & Vercel (frontend)                               |


## 🏗 Tech Stack
- **Frontend**   React 18, Vite, Tailwind CSS  
- **Backend**    Node.js, Express, Supabase Postgres 
- **Realtime**   Supabase Realtime over Postgres replication  
- **Music APIs** Spotify Web API & Playback SDK, MusicBrainz, AcousticBrainz  
- **Auth**       OAuth 2.0 (PKCE) + signed HTTP-only cookies  
- **Deployment** Render (API) · Vercel (client) 

---

## 🚀 Quick Start (Local)

```bash
# 1. clone
git clone git@github.com:raychen1790/collab-playlist.git
cd collab-playlist

# 2. install deps
npm i -w server
npm i -w client

# 3. copy env examples
cp server/.env.example server/.env
cp client/.env.example client/.env.local

# 4. fill in:
#   SPOTIFY_CLIENT_ID / SECRET
#   SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY
#   REDIRECT_URI=http://127.0.0.1:4000/auth/callback
#   FRONTEND_URI=http://127.0.0.1:5173

# 5. run Postgres locally (optional) or use hosted Supabase
supabase start  # if using Supabase CLI

# 6. dev servers
npm run dev -w server   # http://127.0.0.1:4000
npm run dev -w client   # http://127.0.0.1:5173
