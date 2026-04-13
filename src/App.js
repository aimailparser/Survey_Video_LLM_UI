import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const BASE_URL = process.env.REACT_APP_BASE_URL;

// ─── Phases ───────────────────────────────────────────────────────────────────
const PHASE = {
  AGE:       "age",
  GENDER:    "gender",
  CONSENT:   "consent",
  TERMINATED:"terminated",
  SURVEY:    "survey",
  COMPLETE:  "complete",
};

let sessionTranscript = [];

const WAITING_PHRASES = [
  "Okay, let me take a look…",
  "Alright, give me just a second…",
  "Hmm, let me see what we've got here…",
  "One moment, I'm taking this in…",
  "Just scanning what you've shown me…",
];
const randomPhrase = () => WAITING_PHRASES[Math.floor(Math.random() * WAITING_PHRASES.length)];

// ─── Survey flow ──────────────────────────────────────────────────────────────
const FLOW = [
  {
    type: "voice",
    question:
      "Thanks so much for welcoming us into your workspace! To kick things off — how do you feel about your office setup? Like, is it a place you enjoy being in, or is it more of a get-things-done kind of situation?",
  },
  {
    type: "camera",
    question:
      "Lovely! Could you now show me around your workspace? I'd love to see what devices and tools you typically use, where you keep them, what's always within reach, and how everything is set up around you. And if there are any brand names visible, do point those out!",
    target: "Office Workspace",
  },
  {
    type: "voice",
    question:
      "Which brands do you particularly trust for your work setup — whether that's your laptop, peripherals, or any other gear? What is it about them that works for you?",
  },
  {
    type: "camera",
    question:
      "Where do you usually keep everything — your devices, cables, accessories? Could you show me on the camera? And walk me through why you store things the way you do.",
    target: "Device Storage and Organisation",
  },
  {
    type: "voice",
    question:
      "What other tools, gadgets, or accessories do you use as part of your work setup — things that maybe aren't obvious but you'd really miss if they weren't there?",
  },
];

// ─── Voice state machine ──────────────────────────────────────────────────────
const VS = {
  IDLE:             "idle",
  SPEAKING_Q:       "speaking_q",       // AI typing/speaking the question
  RECORDING_MAIN:   "recording_main",
  PROCESSING_MAIN:  "processing_main",
  SPEAKING_PROBE:   "speaking_probe",
  PROBE_READY:      "probe_ready",
  RECORDING_PROBE:  "recording_probe",
  PROCESSING_PROBE: "processing_probe",
  ACKNOWLEDGING:    "acknowledging",
  DONE:             "done",
};

// ─── Typewriter hook ──────────────────────────────────────────────────────────
// Returns displayed text that grows char by char at ~charDelay ms per char
function useTypewriter(text, active, charDelay = 35) {
  const [displayed, setDisplayed] = useState("");
  const idxRef = useRef(0);

  useEffect(() => {
    if (!active) { setDisplayed(""); idxRef.current = 0; return; }
    setDisplayed("");
    idxRef.current = 0;
    const interval = setInterval(() => {
      idxRef.current++;
      setDisplayed(text.slice(0, idxRef.current));
      if (idxRef.current >= text.length) clearInterval(interval);
    }, charDelay);
    return () => clearInterval(interval);
  }, [text, active]);

  return displayed;
}

// ─── ChatBubble component ─────────────────────────────────────────────────────
function ChatBubble({ role, text, typing = false }) {
  const isAI = role === "ai";
  return (
    <div className={`chat-row ${isAI ? "chat-row-ai" : "chat-row-user"}`}>
      {isAI && <div className="chat-avatar">AI</div>}
      <div className={`chat-bubble ${isAI ? "bubble-ai" : "bubble-user"}`}>
        {text}
        {typing && <span className="typing-cursor">▌</span>}
      </div>
      {!isAI && <div className="chat-avatar user-avatar">You</div>}
    </div>
  );
}

export default function App() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef          = useRef(null);
  const streamRef         = useRef(null);
  const speakingRef       = useRef(false);
  const streamIntervalRef = useRef(null);
  const mediaRecorderRef  = useRef(null);
  const audioChunksRef    = useRef([]);
  const probeQuestionRef  = useRef("");
  const mainTranscriptRef = useRef("");
  const vsRef             = useRef(VS.IDLE);
  const lastHintRef       = useRef("");
  const hintCooldownRef   = useRef(false);
  const chatEndRef        = useRef(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [phase,         setPhase]        = useState(PHASE.AGE);
  const [age,           setAge]          = useState("");
  const [gender,        setGender]       = useState("");
  const [step,          setStep]         = useState(0);
  const [started,       setStarted]      = useState(false);
  const [vs,            setVs]           = useState(VS.IDLE);
  const [cameraStatus,  setCameraStatus] = useState("scanning");
  const [transcriptDL,  setTranscriptDL] = useState(null);

  // Chat messages: [{ role: "ai"|"user", text, id }]
  const [chatMessages,  setChatMessages] = useState([]);
  // Text currently being typed by AI (for typewriter)
  const [typingText,    setTypingText]   = useState("");
  const [isTyping,      setIsTyping]     = useState(false);

  useEffect(() => { vsRef.current = vs; }, [vs]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, typingText]);

  // ─── ADD AI CHAT MESSAGE (with typewriter synced to speech) ───────────────
  // Returns a promise that resolves when both typing and speech are done
  const speakAndType = useCallback((text, cb) => {
    // Start typewriter
    setTypingText(text);
    setIsTyping(true);

    // Start speech
    window.speechSynthesis.cancel();
    speakingRef.current = true;
    const speech = new SpeechSynthesisUtterance(text);
    speech.rate = 0.95;

    const applyVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const chosen =
        voices.find((v) => v.name.includes("Samantha"))                ||
        voices.find((v) => v.name.includes("Google UK English Female")) ||
        voices.find((v) => v.name.includes("Female"))                   ||
        voices.find((v) => v.name.includes("Zira"))                     ||
        voices[0];
      if (chosen) speech.voice = chosen;
    };

    speech.onend = () => {
      speakingRef.current = false;
      // Commit full text as a permanent bubble, stop typing cursor
      setIsTyping(false);
      setTypingText("");
      setChatMessages((prev) => [...prev, { role: "ai", text, id: Date.now() }]);
      cb && cb();
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { applyVoice(); window.speechSynthesis.speak(speech); };
    } else {
      applyVoice();
      window.speechSynthesis.speak(speech);
    }
  }, []);

  // Silent speak (no typewriter) — used for camera hints/confirmations
  const speak = useCallback((text, cb) => {
    window.speechSynthesis.cancel();
    speakingRef.current = true;
    const speech = new SpeechSynthesisUtterance(text);
    speech.rate = 0.95;
    const applyVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const chosen =
        voices.find((v) => v.name.includes("Samantha"))                ||
        voices.find((v) => v.name.includes("Google UK English Female")) ||
        voices.find((v) => v.name.includes("Female"))                   ||
        voices.find((v) => v.name.includes("Zira"))                     ||
        voices[0];
      if (chosen) speech.voice = chosen;
    };
    speech.onend = () => { speakingRef.current = false; cb && cb(); };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { applyVoice(); window.speechSynthesis.speak(speech); };
    } else {
      applyVoice();
      window.speechSynthesis.speak(speech);
    }
  }, []);

  // Add a user bubble to chat
  const addUserBubble = (text) => {
    setChatMessages((prev) => [...prev, { role: "user", text, id: Date.now() }]);
  };

  // ─── CAMERA ──────────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) { console.error("Camera error:", err); }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const capture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0, 320, 240);
    return canvas.toDataURL("image/jpeg");
  };

  // ─── REALTIME CAMERA VALIDATION ──────────────────────────────────────────
  const startRealtimeValidation = (currentStep) => {
    if (streamIntervalRef.current) return;
    let retryCount = 0;

    streamIntervalRef.current = setInterval(async () => {
      if (speakingRef.current || hintCooldownRef.current) return;
      try {
        const flowItem = FLOW[currentStep];
        const res  = await fetch(`${BASE_URL}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: capture(),
            type: flowItem.target,
            question: flowItem.question,
          }),
        });
        const data = await res.json();

        if (data.status === "ok") {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
          setCameraStatus("ok");
          sessionTranscript.push({ question: flowItem.question, answer: data.transcriptAnswer });

          const confirmations = [
            "Perfect, got it! That's exactly what I needed to see.",
            "Great, I can see everything clearly now — thanks!",
            "Awesome, that's a really nice setup!",
            "Brilliant, I've got a good picture of that now.",
            "Oh nice, yeah I can see that clearly — perfect!",
          ];
          const confirm = confirmations[Math.floor(Math.random() * confirmations.length)];
          speak(confirm, () => next());
          return;
        }

        retryCount++;
        if (retryCount === 1) { speak(randomPhrase()); return; }

        const hint = data.hint || "Could you adjust the camera a little so I can see better?";
        if (hint === lastHintRef.current) return;
        lastHintRef.current = hint;
        hintCooldownRef.current = true;
        speak(hint, () => { hintCooldownRef.current = false; });

      } catch (err) { console.error(err); }
    }, 2500);
  };

  const stopRealtimeValidation = () => {
    clearInterval(streamIntervalRef.current);
    streamIntervalRef.current = null;
  };

  // ─── AUDIO RECORDING ─────────────────────────────────────────────────────
  const startRecording = async (onStop) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onStop(new Blob(audioChunksRef.current, { type: "audio/webm" }));
      };
      recorder.start();
    } catch (err) { console.error("Mic error:", err); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const transcribeBlob = async (blob, questionCtx) => {
    const fd = new FormData();
    fd.append("audio", blob, "answer.webm");
    fd.append("question", questionCtx || "");
    const res = await fetch(`${BASE_URL}/transcribe`, { method: "POST", body: fd });
    const { transcript } = await res.json();
    return transcript || "";
  };

  // ─── SINGLE MIC BUTTON ───────────────────────────────────────────────────
  const handleMicTap = () => {
    const state = vsRef.current;

    if (state === VS.RECORDING_MAIN || state === VS.RECORDING_PROBE) {
      stopRecording();
      return;
    }

    if (state === VS.PROBE_READY) {
      setVs(VS.RECORDING_PROBE);
      startRecording(async (blob) => {
        setVs(VS.PROCESSING_PROBE);
        try {
          const probeAnswer = await transcribeBlob(blob, probeQuestionRef.current);
          addUserBubble(probeAnswer);
          sessionTranscript.push({ question: probeQuestionRef.current, answer: probeAnswer });

          await fetch(`${BASE_URL}/save-transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entries: [
                { question: FLOW[step].question,      answer: mainTranscriptRef.current },
                { question: probeQuestionRef.current, answer: probeAnswer },
              ],
            }),
          }).catch(() => {});

          setVs(VS.ACKNOWLEDGING);
          let ack = "Yeah, that totally makes sense. Okay, moving on!";
          try {
            const ackRes = await fetch(`${BASE_URL}/acknowledge`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ probeQuestion: probeQuestionRef.current, probeAnswer }),
            });
            const ackData = await ackRes.json();
            ack = ackData.ack || ack;
          } catch {}

          speakAndType(ack, () => {
            setVs(VS.DONE);
            setTimeout(() => {
              setVs(VS.IDLE);
              probeQuestionRef.current  = "";
              mainTranscriptRef.current = "";
              next();
            }, 400);
          });

        } catch (err) { console.error(err); setVs(VS.PROBE_READY); }
      });
      return;
    }

    if (state === VS.IDLE) {
      setVs(VS.RECORDING_MAIN);
      startRecording(async (blob) => {
        setVs(VS.PROCESSING_MAIN);
        try {
          const transcript = await transcribeBlob(blob, FLOW[step].question);
          mainTranscriptRef.current = transcript;
          addUserBubble(transcript);
          sessionTranscript.push({ question: FLOW[step].question, answer: transcript });

          const probeRes = await fetch(`${BASE_URL}/probe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: FLOW[step].question, answer: transcript }),
          });
          const { probe } = await probeRes.json();
          probeQuestionRef.current = probe;

          setVs(VS.SPEAKING_PROBE);
          speakAndType(probe, () => setVs(VS.PROBE_READY));

        } catch (err) { console.error(err); setVs(VS.IDLE); }
      });
    }
  };

  // ─── NEXT ─────────────────────────────────────────────────────────────────
  const next = () => {
    stopRealtimeValidation();
    stopCamera();
    setCameraStatus("scanning");
    lastHintRef.current     = "";
    hintCooldownRef.current = false;
    setStep((s) => s + 1);
  };

  // ─── FLOW ENGINE ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    const current = FLOW[step];

    if (!current) {
      fetch(`${BASE_URL}/save-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ age, gender, transcript: sessionTranscript, completedAt: new Date().toISOString() }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.txtContent) {
            setTranscriptDL({ content: data.txtContent, filename: data.filename });
          }
        })
        .catch(console.error);
      setPhase(PHASE.COMPLETE);
      return;
    }

    stopCamera();

    if (current.type === "voice") {
      setVs(VS.SPEAKING_Q);
      setChatMessages([]);
      probeQuestionRef.current  = "";
      mainTranscriptRef.current = "";
      speakAndType(current.question, () => setVs(VS.IDLE));
    }

    if (current.type === "camera") {
      setCameraStatus("scanning");
      speak(current.question, () =>
        startCamera().then(() => startRealtimeValidation(step))
      );
    }
  }, [step, started]);

  // ─── MIC BUTTON LABEL ────────────────────────────────────────────────────
  const micLabel = () => {
    switch (vs) {
      case VS.SPEAKING_Q:       return { icon: "🔊", text: "Listening…",    active: false };
      case VS.IDLE:             return { icon: "🎙️", text: "Tap to Answer",  active: false };
      case VS.RECORDING_MAIN:   return { icon: "⏹️", text: "Tap to Stop",    active: true  };
      case VS.PROCESSING_MAIN:  return { icon: "⏳", text: "Thinking…",      active: false };
      case VS.SPEAKING_PROBE:   return { icon: "🔊", text: "Listening…",     active: false };
      case VS.PROBE_READY:      return { icon: "🎙️", text: "Tap to Answer",  active: false };
      case VS.RECORDING_PROBE:  return { icon: "⏹️", text: "Tap to Stop",    active: true  };
      case VS.PROCESSING_PROBE: return { icon: "⏳", text: "Saving…",        active: false };
      case VS.ACKNOWLEDGING:    return { icon: "🔊", text: "Listening…",     active: false };
      case VS.DONE:             return { icon: "✅", text: "Done!",          active: false };
      default:                  return { icon: "🎙️", text: "Tap to Answer",  active: false };
    }
  };

  const micDisabled =
    vs === VS.SPEAKING_Q       ||
    vs === VS.PROCESSING_MAIN  ||
    vs === VS.SPEAKING_PROBE   ||
    vs === VS.PROCESSING_PROBE ||
    vs === VS.ACKNOWLEDGING    ||
    vs === VS.DONE;

  // ─────────────────────────────────────────────────────────────────────────
  //  SCREENS
  // ─────────────────────────────────────────────────────────────────────────

  // ── AGE ──
  if (phase === PHASE.AGE) {
    return (
      <div className="page-bg">
        <div className="card">
          <h2 className="title">What is your age?</h2>
          <input
            className="input"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="Type your answer here..."
            type="number"
          />
          <div className="btn-row">
            <button className="next-btn" disabled={!age} onClick={() => setPhase(PHASE.GENDER)}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── GENDER ──
  if (phase === PHASE.GENDER) {
    return (
      <div className="page-bg">
        <div className="card">
          <h2 className="title">What is your gender?</h2>
          <div className="options-row">
            {["Male", "Female", "Other"].map((g) => (
              <button key={g} className="option-btn" onClick={() => {
                setGender(g);
                setPhase(PHASE.CONSENT);
              }}>
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── PII CONSENT ──
  if (phase === PHASE.CONSENT) {
    return (
      <div className="page-bg">
        <div className="card consent-card">
          <div className="consent-icon">🔒</div>
          <h2 className="title">Your Privacy Matters</h2>
          <p className="consent-body">
            To continue with this study, we need to collect some personal information including
            your responses, voice recordings, and camera footage of your workspace.
          </p>
          <ul className="consent-list">
            <li>Your data will only be used for research purposes</li>
            <li>Recordings will not be shared with third parties</li>
            <li>You may withdraw at any time</li>
          </ul>
          <p className="consent-question">
            Do you agree to proceed and allow collection of your information?
          </p>
          <div className="consent-btns">
            <button
              className="consent-agree"
              onClick={() => {
                sessionTranscript = [];
                sessionTranscript.push({ question: "Age",    answer: age });
                sessionTranscript.push({ question: "Gender", answer: gender });
                sessionTranscript.push({ question: "PII Consent", answer: "Agreed" });
                setStarted(true);
                setPhase(PHASE.SURVEY);
                window.speechSynthesis.resume();
              }}
            >
              I Agree
            </button>
            <button
              className="consent-disagree"
              onClick={() => setPhase(PHASE.TERMINATED)}
            >
              I Disagree
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── TERMINATED ──
  if (phase === PHASE.TERMINATED) {
    return (
      <div className="page-bg">
        <div className="status-card">
          <div className="status-icon-wrap terminated-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" className="status-icon">
              <circle cx="12" cy="12" r="10" stroke="#e53935" strokeWidth="1.8"/>
              <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" stroke="#e53935" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <h2 className="status-title">Survey Terminated</h2>
          <p className="status-sub">This survey is no longer accepting responses.</p>
        </div>
      </div>
    );
  }

  // ── Download helper ──
  const handleDownload = () => {
    if (!transcriptDL) return;
    const blob = new Blob([transcriptDL.content], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = transcriptDL.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── COMPLETE ──
  if (phase === PHASE.COMPLETE) {
    return (
      <div className="page-bg">
        <div className="status-card">
          <div className="status-icon-wrap complete-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" className="status-icon">
              <circle cx="12" cy="12" r="10" stroke="#2e7d32" strokeWidth="1.8"/>
              <polyline points="7,12.5 10.5,16 17,9" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="status-title">Survey Completed</h2>
          <p className="status-sub">Thank you for your time. Your response has been recorded.</p>
          {transcriptDL && (
            <button className="download-btn" onClick={handleDownload}>
              ⬇ Download Transcript
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── SURVEY ──
  if (phase !== PHASE.SURVEY) return null;
  if (step >= FLOW.length)   return null; // handled by flow engine → COMPLETE

  const current = FLOW[step];
  const ml      = micLabel();

  return (
    <div className="survey-bg">

      {/* ── CAMERA STEP ── */}
      {current.type === "camera" && (
        <div className="camera-screen">
          <div className="camera-q-box">
            <span className="q-label-small">Question</span>
            <p className="camera-q-text">{current.question}</p>
          </div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="camera-video"
          />
          <div className="camera-status">
            {cameraStatus === "scanning" ? (
              <span className="scanning-dot-wrap">
                <span className="scanning-dot" />
                Looking…
              </span>
            ) : (
              <span className="scanning-ok">✓ Got it!</span>
            )}
          </div>
        </div>
      )}

      {/* ── VOICE STEP — chat UI ── */}
      {current.type === "voice" && (
        <div className="chat-screen">

          {/* Chat messages area */}
          <div className="chat-messages">
            {chatMessages.map((msg) => (
              <ChatBubble key={msg.id} role={msg.role} text={msg.text} />
            ))}
            {/* Live typing bubble */}
            {isTyping && typingText && (
              <ChatBubble role="ai" text={typingText} typing />
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Mic button pinned at bottom */}
          <div className="chat-input-area">
            <button
              className={`mic-btn ${ml.active ? "mic-active" : ""} ${micDisabled ? "mic-disabled" : ""}`}
              onClick={handleMicTap}
              disabled={micDisabled}
            >
              <span className="mic-icon-big">{ml.icon}</span>
              <span className="mic-label-text">{ml.text}</span>
              {ml.active && <span className="mic-ring" />}
            </button>
            <p className="voice-hint">
              {vs === VS.SPEAKING_Q       && "AI is speaking…"}
              {vs === VS.IDLE             && "Tap the mic when you're ready"}
              {vs === VS.RECORDING_MAIN   && "Recording… tap again to stop"}
              {vs === VS.PROCESSING_MAIN  && "Hold on, processing that…"}
              {vs === VS.SPEAKING_PROBE   && "Listen to the follow-up…"}
              {vs === VS.PROBE_READY      && "Tap the mic to answer the follow-up"}
              {vs === VS.RECORDING_PROBE  && "Recording… tap again to stop"}
              {vs === VS.PROCESSING_PROBE && "Saving your response…"}
              {vs === VS.ACKNOWLEDGING    && "…"}
              {vs === VS.DONE             && "Moving on…"}
            </p>
          </div>

        </div>
      )}

    </div>
  );
}