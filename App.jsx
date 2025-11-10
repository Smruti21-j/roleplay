import React, {useState, useRef, useEffect} from "react";
import { motion } from "framer-motion";

const API = import.meta.env.VITE_API || "http://localhost:8000";

const EMOJI = { happy: "😊", sad: "😔", angry: "😡", neutral: "😐" };

// small avatar SVGs are in /assets
function Avatar({emotion}) {
  const src = `/assets/${emotion}.svg`;
  return <img src={src} alt={emotion} style={{width:160,height:160,borderRadius:12}} />;
}

export default function App(){
  const [prompt, setPrompt] = useState("An angry guest complains about slow service and wrong order.");
  const [emotion, setEmotion] = useState("angry");
  const [sessionId, setSessionId] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [published, setPublished] = useState(false);
  const [pc, setPc] = useState(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(()=> { return ()=>{ if(pc) pc.close(); if(localStreamRef.current) localStreamRef.current.getTracks().forEach(t=>t.stop()); } }, [pc]);

  function append(role, text){
    setMessages(prev=>[...prev, {role, text}]);
  }

  async function createScenario(){
    append("system","Generating scenario...");
    const res = await fetch(`${API}/api/scenario/create`, {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({prompt, emotion})
    });
    const jr = await res.json();
    setSessionId(jr.session_id);
    setScenario(jr.scenario);
    setPublished(false);
    append("system","Scenario generated.");
  }

  async function publishScenario(){
    if(!sessionId) return alert("create first");
    await fetch(`${API}/api/scenario/publish`, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({session_id: sessionId})});
    setPublished(true);
    append("system","Published.");
  }

  async function startLive(){
    if(!sessionId) return alert("Create & publish");
    // request ephemeral session from backend
    append("system","Requesting ephemeral realtime session...");
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const resp = await fetch(`${API}/api/realtime/session`, {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({model, emotion})
    });
    if(!resp.ok){
      const txt = await resp.text();
      append("system","Failed to get ephemeral key: " + txt);
      return;
    }
    const jr = await resp.json();
    // jr should contain client_secret.value and possibly a url
    const ephemeralKey = jr?.client_secret?.value || jr?.client_secret || jr?.api_key;
    const realtimeUrl = jr?.url || `https://api.openai.com/v1/realtime?model=${model}`;

    if(!ephemeralKey){
      append("system","Ephemeral key missing in backend response.");
      console.warn(jr);
      return;
    }
    append("system","Got ephemeral key. Creating WebRTC connection...");

    // Create RTCPeerConnection
    const pcLocal = new RTCPeerConnection();
    setPc(pcLocal);

    pcLocal.ontrack = (ev) => {
      const [s] = ev.streams;
      if(!audioRef.current){
        const a = document.createElement("audio");
        a.autoplay = true;
        audioRef.current = a;
        document.body.appendChild(a);
      }
      audioRef.current.srcObject = s;
      append("system","Remote audio attached.");
    };

    // data channel for transcripts and events (optional)
    const dc = pcLocal.createDataChannel("oai-datachannel");
    dc.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        // structure varies; show generically
        if(d.type === "response" && d.output){
          append("bot", JSON.stringify(d.output));
        } else {
          append("info", ev.data);
        }
      } catch(e){
        append("info", ev.data);
      }
    };
    dcRef.current = dc;

    // get mic
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    localStreamRef.current = stream;
    for(const t of stream.getTracks()) pcLocal.addTrack(t, stream);

    // create offer
    const offer = await pcLocal.createOffer();
    await pcLocal.setLocalDescription(offer);

    // POST SDP to realtimeUrl using ephemeral key
    append("system","Sending SDP offer to Realtime API...");
    const sdpResp = await fetch(realtimeUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + ephemeralKey,
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if(!sdpResp.ok){
      const txt = await sdpResp.text();
      append("system", "SDP exchange failed: " + txt);
      return;
    }
    const answerSdp = await sdpResp.text();
    await pcLocal.setRemoteDescription({type:"answer", sdp: answerSdp});
    append("system","WebRTC handshake complete. Speak — AI will reply live.");
    setConnected(true);
  }

  function stopLive(){
    if(localStreamRef.current){ localStreamRef.current.getTracks().forEach(t=>t.stop()); localStreamRef.current = null; }
    if(pc){ pc.close(); setPc(null); setConnected(false); }
    append("system","Live session stopped.");
  }

  // UI
  return (
    <div className="app">
      <div className="header">
        <h2>Exec Roleplay — Live</h2>
        <div className="small">Backend: {API}</div>
      </div>

      <div className="section">
        <h3>Create Scenario</h3>
        <textarea rows={3} value={prompt} onChange={e=>setPrompt(e.target.value)} />
        <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
          <label>Emotion</label>
          <select value={emotion} onChange={e=>setEmotion(e.target.value)}>
            <option value="angry">Angry</option>
            <option value="happy">Happy</option>
            <option value="sad">Sad</option>
            <option value="neutral">Neutral</option>
          </select>
          <button className="btn" onClick={createScenario}>Create</button>
          <button className="btn" onClick={publishScenario} disabled={!sessionId}>Publish</button>
          <button className="btn" onClick={startLive} disabled={!sessionId}>Start Live</button>
          <button className="btn" onClick={stopLive} disabled={!connected}>Stop</button>
        </div>

        {scenario && (
          <motion.div className="row" style={{marginTop:12}} initial={{opacity:0, y:8}} animate={{opacity:1,y:0}}>
            <Avatar emotion={emotion} />
            <div style={{flex:1, marginLeft:12}}>
              <h4>{scenario.title || "Scenario"}</h4>
              <p className="small">{scenario.overview}</p>
              <div className="small">Roles: {scenario.roles?.map(r=>r.name).join(", ")}</div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="section" style={{marginTop:12}}>
        <h3>Live Session</h3>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Avatar emotion={emotion} />
          <div>
            <div className="small">Connected: {connected ? "Yes" : "No"}</div>
            <div style={{marginTop:8, display:"flex", gap:8}}>
              <button className="btn" onClick={startLive} disabled={connected}>Join</button>
              <button className="btn" onClick={stopLive} disabled={!connected}>Leave</button>
            </div>
          </div>
        </div>

        <div className="messages">
          {messages.map((m, i)=>(
            <div key={i} className={"message " + (m.role === "bot" ? "bot" : m.role === "user" ? "user" : "")}>
              <small style={{color:"#6b7280"}}>{m.role}</small>
              <div>{m.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
