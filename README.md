Exec Roleplay — Realtime (Avatar + near-real-time audio)
======================================================

What this adds:
- Emotion avatars (SVGs) built into frontend assets.
- A WebSocket 'realtime' endpoint where the frontend sends short base64 audio chunks.
- Backend transcribes chunks with Whisper, generates a reply with ChatCompletion, and attempts to synthesize audio (if available).
- Frontend decodes and plays received audio or uses browser TTS fallback.

How to run (dev):
1) Backend
   cd backend
   cp .env.example .env
   set OPENAI_API_KEY in .env
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000

2) Frontend
   cd frontend
   npm install
   npm run dev

3) Open http://localhost:5173 and create a scenario -> publish -> Start Live -> Record/Stop to speak.

Security note:
- This implementation is for development. For production, add proper ephemeral tokens and avoid sending your long-lived OpenAI API key to the browser.
