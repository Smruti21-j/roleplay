# backend/main.py
import os
import json
import requests
import uuid
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import openai

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "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")
if not OPENAI_API_KEY:
    raise RuntimeError("Please set OPENAI_API_KEY in .env (project key, starts with sk-proj-...)")

openai.api_key = OPENAI_API_KEY

# Realtime sessions endpoint and recommended model name
OPENAI_REALTIME_SESSIONS = "https://api.openai.com/v1/realtime/sessions"
REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17"

# map emotions to example voice names (valid names per API)
VOICE_MAP = {
    "happy": "alloy",
    "sad": "verse",
    "angry": "coral",
    "neutral": "sage",
}

app = FastAPI(title="Roleplay Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# In-memory store (dev)
SESSIONS = {}

class ScenarioCreate(BaseModel):
    prompt: str
    emotion: str
    title: str = None

@app.post("/api/scenario/create")
def create_scenario(payload: ScenarioCreate):
    """
    Use OpenAI ChatCompletion to generate a structured scenario JSON.
    Falls back to a simple structure if parsing fails.
    """
    system_prompt = (
        "You are an expert roleplay scenario author for hospitality training. "
        "Produce a concise JSON object (and nothing else) with these fields:\n"
        'title, overview, roles (list of {name, instructions}), opening_dialogue (list of {speaker, line}), learning_goals (list).\n'
        "Keep each text short and actionable."
    )
    user_prompt = f"Emotion: {payload.emotion}\nPrompt: {payload.prompt}\nReturn valid JSON only."

    try:
        # Use a capable chat model for scenario generation
        resp = openai.ChatCompletion.create(
            model="gpt-4o",  # change if not available; fallback handled below
            messages=[{"role":"system","content":system_prompt},
                      {"role":"user","content":user_prompt}],
            temperature=0.7,
            max_tokens=700
        )
        raw = resp["choices"][0]["message"]["content"]
        try:
            scenario = json.loads(raw)
        except Exception:
            # Sometimes model returns text; embed into structure
            scenario = {
                "title": payload.title or payload.prompt[:48],
                "overview": raw[:800],
                "roles": [
                    {"name":"Guest","instructions":"Express frustration and be specific about the issue."},
                    {"name":"Staff","instructions":"Listen, empathize, and offer a quick resolution."}
                ],
                "opening_dialogue":[
                    {"speaker":"Guest","line":"I've been waiting 20 minutes and my order is wrong!"},
                    {"speaker":"Staff","line":"I'm very sorry — let me fix that immediately."}
                ],
                "learning_goals": ["Empathy","Ownership","Resolution"]
            }
    except Exception as e:
        scenario = {
            "title": payload.title or payload.prompt[:48],
            "overview": "Generated locally: " + payload.prompt,
            "roles": [{"name":"Guest"},{"name":"Staff"}],
            "opening_dialogue":[{"speaker":"Guest","line":"I'm upset."},{"speaker":"Staff","line":"I'm sorry."}],
            "learning_goals": ["Empathy","Resolution"]
        }

    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "scenario": scenario,
        "emotion": payload.emotion,
        "published": False,
        "messages": []
    }
    return {"session_id": session_id, "scenario": scenario}

@app.post("/api/scenario/publish")
def publish(payload: dict):
    session_id = payload.get("session_id")
    if not session_id or session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="session_id not found")
    SESSIONS[session_id]["published"] = True
    return {"session_id": session_id, "published": True}

@app.get("/api/scenario/{session_id}")
def get_scenario(session_id: str):
    if session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="not found")
    return {"session_id": session_id, "scenario": SESSIONS[session_id]["scenario"], "published": SESSIONS[session_id]["published"]}

@app.post("/api/realtime/session")
def create_realtime_session(body: dict):
    """
    Request an ephemeral realtime session from OpenAI.
    The backend uses your project API key to get a short-lived credential the browser will use.
    """
    model = body.get("model") or REALTIME_MODEL
    emotion = body.get("emotion") or "neutral"
    voice = body.get("voice") or VOICE_MAP.get(emotion, "sage")

    payload = {"model": model, "voice": voice}
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    r = requests.post(OPENAI_REALTIME_SESSIONS, headers=headers, json=payload, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenAI sessions request failed: {r.status_code} {r.text}")
    return r.json()

@app.get("/api/session/{session_id}/messages")
def get_messages(session_id: str):
    if session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="not found")
    return {"messages": SESSIONS[session_id]["messages"]}

@app.get("/")
def root():
    return {"status": "ok", "sessions": len(SESSIONS)}
