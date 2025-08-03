# 🎵 Collaborative Playlist — Real-Time Spotify Voting App

Create a shared “party room”, let guests log in with Spotify, vote tracks
up / down, and reorder the list live by score, tempo, energy, or
danceability.  Playback happens in-browser via Spotify Web Playback SDK.

---

## ✨ Features
| Category | Highlights |
| -------- | ---------- |
| **Auth & Playback** | • Spotify OAuth 2.0 + silent token refresh<br>• Web Playback SDK with play / pause / previous / next, shuffle, seek, volume |
| **Real-time** | • Supabase Realtime streams `votes` + `tracks`<br>• Instant re-sort across all browsers |
| **Audio-feature logic** | • Falls back to **MusicBrainz + AcousticBrainz** when Spotify features are missing<br>• Caches results in Postgres |
| **Data model** | `rooms`, `tracks`, `votes`, `audio_features`, `room_members` with RLS |
| **UI / UX** | • React + Tailwind<br>• Always-visible bottom player bar with progress slider<br>• Sort toolbar (votes / tempo / energy / danceability)<br>• Host “Play All” & shuffle queue |
| **Dev workflow** | Vite HMR, Express API, Supabase CLI locally, one-command deploy to Render / Netlify |

---

## 🏗 Tech Stack
- **Frontend**   React 18, Vite, Tailwind CSS  
- **Backend**    Node.js, Express, Supabase Postgres (via service role)  
- **Realtime**   Supabase Realtime over Postgres `replication`  
- **Music APIs** Spotify Web API & Playback SDK, MusicBrainz, AcousticBrainz  
- **Auth**       OAuth 2.0 (PKCE) + signed HTTP-only cookies  
- **Deployment** Render (API) · Netlify (client) — both free tiers

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
