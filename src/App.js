import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const BASE_URL = process.env.REACT_APP_BASE_URL;

// ─── Phases ───────────────────────────────────────────────────────────────────
const PHASE = {
  AGE:        "age",
  GENDER:     "gender",
  CONSENT:    "consent",
  TERMINATED: "terminated",
  SURVEY:     "survey",
  COMPLETE:   "complete",
};

let sessionTranscript = [];

const WAITING_PHRASES = [
  "Okay, let me take a look…",
  "Alright, give me just a second…",
  "Hmm, let me see what we've got here…",
  "One moment, I'm taking this in…",
  "Just scanning what you've shown me…",
];
const randomPhrase = () =>
  WAITING_PHRASES[Math.floor(Math.random() * WAITING_PHRASES.length)];

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
  SPEAKING_Q:       "speaking_q",
  RECORDING_MAIN:   "recording_main",
  PROCESSING_MAIN:  "processing_main",
  SPEAKING_PROBE:   "speaking_probe",
  PROBE_READY:      "probe_ready",
  RECORDING_PROBE:  "recording_probe",
  PROCESSING_PROBE: "processing_probe",
  ACKNOWLEDGING:    "acknowledging",
  DONE:             "done",
};

// ─── ChatBubble ───────────────────────────────────────────────────────────────
// States:
//   loading=true           → animated dots (TTS is being fetched)
//   typewriter=true        → text animates in char by char (audio playing)
//   typing=true            → blinking cursor only (audio finished, cursor clearing)
//   default                → plain committed text
function ChatBubble({ role, text, loading = false, typewriter = false, typewriterDuration = 0, typing = false }) {
  const isAI = role === "ai";
  const [displayed, setDisplayed] = useState(typewriter ? "" : text);

  useEffect(() => {
    if (!typewriter || !text) return;
    setDisplayed("");
    const chars = text.length;
    // spread chars evenly across the audio duration (ms), min 30ms/char
    const delay = typewriterDuration > 0
      ? Math.max(Math.floor(typewriterDuration / chars), 25)
      : 38;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= chars) clearInterval(iv);
    }, delay);
    return () => clearInterval(iv);
  }, [typewriter, text, typewriterDuration]);

  return (
    <div className={`chat-row ${isAI ? "chat-row-ai" : "chat-row-user"}`}>
      {isAI && <div className="chat-avatar">AI</div>}
      <div className={`chat-bubble ${isAI ? "bubble-ai" : "bubble-user"}`}>
        {loading ? (
          <span className="dots-loader">
            <span /><span /><span />
          </span>
        ) : typewriter ? (
          <>
            {displayed}
            <span className="typing-cursor">▌</span>
          </>
        ) : (
          <>
            {text}
            {typing && <span className="typing-cursor">▌</span>}
          </>
        )}
      </div>
      {!isAI && <div className="chat-avatar user-avatar">You</div>}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Refs
  const videoRef          = useRef(null);
  const streamRef         = useRef(null);
  const streamIntervalRef = useRef(null);
  const mediaRecorderRef  = useRef(null);
  const audioChunksRef    = useRef([]);
  const audioRef          = useRef(null);   // current playing Audio object
  const speakingRef       = useRef(false);  // true while TTS audio is playing
  const probeQuestionRef  = useRef("");
  const mainTranscriptRef = useRef("");
  const vsRef             = useRef(VS.IDLE);
  const lastHintRef       = useRef("");
  const hintCooldownRef   = useRef(false);
  const chatEndRef        = useRef(null);

  // State
  const [phase,         setPhase]        = useState(PHASE.AGE);
  const [age,           setAge]          = useState("");
  const [gender,        setGender]       = useState("");
  const [step,          setStep]         = useState(0);
  const [started,       setStarted]      = useState(false);
  const [vs,            setVs]           = useState(VS.IDLE);
  const [cameraStatus,  setCameraStatus] = useState("scanning");
  const [transcriptDL,  setTranscriptDL] = useState(null);
  // chatMessages: [{ role, text, id, typing? }]
  const [chatMessages,  setChatMessages] = useState([]);
  const [cameraDisplayText, setCameraDisplayText] = useState(""); // typewriter for camera q
  const [cameraTyping,      setCameraTyping]      = useState(false);  // cursor visible
  const cameraTypewriterRef = useRef(null); // interval ref for camera typewriter

  // Keep vsRef synced
  useEffect(() => { vsRef.current = vs; }, [vs]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ─── TTS via OpenAI ─────────────────────────────────────────────────────────
  // fetchAudio  — downloads the mp3 blob, returns it (no playback yet)
  // playBlob    — plays a pre-fetched blob, calls onDone when finished

  // speakAndType — fetches audio FIRST (silent), then shows bubble + plays
  //               simultaneously so text and voice are in sync

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    speakingRef.current = false;
  };

  const fetchAudio = useCallback(async (text) => {
    const res = await fetch(`${BASE_URL}/speak`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return res.blob();
  }, []);

  const playBlob = useCallback((blob, onDone) => {
    stopAudio();
    speakingRef.current = true;
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;

    const finish = () => {
      URL.revokeObjectURL(url);
      speakingRef.current = false;
      audioRef.current = null;
      onDone && onDone();
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
  }, []);

  // speak — fetch then play, no bubble (camera hints / confirmations)
  const speak = useCallback((text, cb) => {
    fetchAudio(text)
      .then((blob) => playBlob(blob, cb))
      .catch((err) => {
        console.error("TTS error:", err);
        cb && cb();
      });
  }, [fetchAudio, playBlob]);

  // speakAndType — 3-phase:
  //   Phase 1: show loading dots bubble immediately while TTS fetches
  //   Phase 2: swap to typewriter bubble + start audio simultaneously
  //   Phase 3: mark done (cursor gone) when audio ends
  const speakAndType = useCallback((text, cb) => {
    const id = Date.now();

    // Phase 1: loading dots appear immediately
    setChatMessages((prev) => [...prev, { role: "ai", text, id, loading: true }]);

    fetchAudio(text)
      .then((blob) => {
        // Measure duration via a temporary Audio probe
        const probeUrl = URL.createObjectURL(blob);
        const probeAudio = new Audio();
        probeAudio.preload = "metadata";

        const startPlayback = (durationMs) => {
          URL.revokeObjectURL(probeUrl);
          // Phase 2: swap loading → typewriter bubble + start audio together
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, loading: false, typewriter: true, typewriterDuration: durationMs }
                : m
            )
          );
          playBlob(blob, () => {
            // Phase 3: audio done — remove cursor
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === id ? { ...m, typewriter: false, typing: false } : m
              )
            );
            cb && cb();
          });
        };

        probeAudio.addEventListener("loadedmetadata", () => {
          startPlayback((probeAudio.duration || 3) * 1000);
        }, { once: true });

        probeAudio.addEventListener("error", () => {
          // Can't get duration — use fallback of 3s, still plays fine
          startPlayback(3000);
        }, { once: true });

        probeAudio.src = probeUrl;
      })
      .catch((err) => {
        console.error("TTS error:", err);
        // Show text even if audio fails
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, loading: false, typewriter: false } : m
          )
        );
        cb && cb();
      });
  }, [fetchAudio, playBlob]);

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

  const startRealtimeValidation = (currentStep) => {
    if (streamIntervalRef.current) return;
    let retryCount = 0;

    streamIntervalRef.current = setInterval(async () => {
      if (speakingRef.current || hintCooldownRef.current) return;
      try {
        const flowItem = FLOW[currentStep];
        const res = await fetch(`${BASE_URL}/analyze`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            image:    capture(),
            type:     flowItem.target,
            question: flowItem.question,
          }),
        });
        const data = await res.json();

        if (data.status === "ok") {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
          setCameraStatus("ok");
          sessionTranscript.push({
            question: flowItem.question,
            answer:   data.transcriptAnswer,
          });
          const confirmations = [
            "Perfect, got it! That's exactly what I needed to see.",
            "Great, I can see everything clearly now — thanks!",
            "Awesome, that's a really nice setup!",
            "Brilliant, I've got a good picture of that now.",
            "Oh nice, yeah I can see that clearly — perfect!",
          ];
          speak(
            confirmations[Math.floor(Math.random() * confirmations.length)],
            () => next()
          );
          return;
        }

        retryCount++;
        if (retryCount === 1) { speak(randomPhrase()); return; }

        const hint = data.hint || "Could you adjust the camera a little so I can see better?";
        if (hint === lastHintRef.current) return;
        lastHintRef.current     = hint;
        hintCooldownRef.current = true;
        speak(hint, () => { hintCooldownRef.current = false; });
      } catch (err) { console.error(err); }
    }, 2500);
  };

  const stopRealtimeValidation = () => {
    clearInterval(streamIntervalRef.current);
    streamIntervalRef.current = null;
  };

  // ─── RECORDING ───────────────────────────────────────────────────────────
  const startRecording = async (onStop) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onStop(new Blob(audioChunksRef.current, { type: "audio/webm" }));
      };
      recorder.start();
    } catch (err) { console.error("Mic error:", err); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording")
      mediaRecorderRef.current.stop();
  };

  const transcribeBlob = async (blob, questionCtx) => {
    const fd = new FormData();
    fd.append("audio",    blob, "answer.webm");
    fd.append("question", questionCtx || "");
    const res = await fetch(`${BASE_URL}/transcribe`, { method: "POST", body: fd });
    const { transcript } = await res.json();
    return transcript || "";
  };

  // ─── MIC TAP ─────────────────────────────────────────────────────────────
  const handleMicTap = () => {
    const state = vsRef.current;

    // Stop recording
    if (state === VS.RECORDING_MAIN || state === VS.RECORDING_PROBE) {
      stopRecording();
      return;
    }

    // Start probe recording
    if (state === VS.PROBE_READY) {
      setVs(VS.RECORDING_PROBE);
      startRecording(async (blob) => {
        setVs(VS.PROCESSING_PROBE);
        try {
          const probeAnswer = await transcribeBlob(blob, probeQuestionRef.current);
          addUserBubble(probeAnswer);
          sessionTranscript.push({ question: probeQuestionRef.current, answer: probeAnswer });

          // Save voice Q&A to server
          await fetch(`${BASE_URL}/save-transcript`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              entries: [
                { question: FLOW[step].question,      answer: mainTranscriptRef.current },
                { question: probeQuestionRef.current, answer: probeAnswer },
              ],
            }),
          }).catch(() => {});

          // Get acknowledgement and speak it
          setVs(VS.ACKNOWLEDGING);
          let ack = "Yeah, that totally makes sense. Okay, moving on!";
          try {
            const ackRes = await fetch(`${BASE_URL}/acknowledge`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                probeQuestion: probeQuestionRef.current,
                probeAnswer,
              }),
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

        } catch (err) {
          console.error(err);
          setVs(VS.PROBE_READY);
        }
      });
      return;
    }

    // Start main recording
    if (state === VS.IDLE) {
      setVs(VS.RECORDING_MAIN);
      startRecording(async (blob) => {
        setVs(VS.PROCESSING_MAIN);
        try {
          // Transcribe answer
          const transcript = await transcribeBlob(blob, FLOW[step].question);
          mainTranscriptRef.current = transcript;
          addUserBubble(transcript);
          sessionTranscript.push({ question: FLOW[step].question, answer: transcript });

          // Fetch probe text AND pre-fetch its TTS audio simultaneously
          const probeRes = await fetch(`${BASE_URL}/probe`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ question: FLOW[step].question, answer: transcript }),
          });
          const { probe } = await probeRes.json();
          probeQuestionRef.current = probe;

          // Fetch probe audio silently first, then show bubble + play together
          setVs(VS.SPEAKING_PROBE);
          fetchAudio(probe)
            .then((audioBlob) => {
              const id = Date.now();
              setChatMessages((prev) => [...prev, { role: "ai", text: probe, id, typing: true }]);
              playBlob(audioBlob, () => {
                setChatMessages((prev) =>
                  prev.map((m) => (m.id === id ? { ...m, typing: false } : m))
                );
                setVs(VS.PROBE_READY);
              });
            })
            .catch(() => {
              // fallback: show bubble without audio
              const id = Date.now();
              setChatMessages((prev) => [...prev, { role: "ai", text: probe, id, typing: false }]);
              setVs(VS.PROBE_READY);
            });

        } catch (err) {
          console.error(err);
          setVs(VS.IDLE);
        }
      });
    }
  };

  // ─── NEXT ────────────────────────────────────────────────────────────────
  const next = () => {
    stopRealtimeValidation();
    stopCamera();
    setCameraStatus("scanning");
    setCameraTyping(false);
    setCameraDisplayText("");
    lastHintRef.current     = "";
    hintCooldownRef.current = false;
    setStep((s) => s + 1);
  };

  // ─── FLOW ENGINE ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    const current = FLOW[step];

    if (!current) {
      // Survey done
      fetch(`${BASE_URL}/save-transcript`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          age,
          gender,
          transcript:  sessionTranscript,
          completedAt: new Date().toISOString(),
        }),
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
      // Speak question — only move to IDLE when audio FINISHES
      speakAndType(current.question, () => setVs(VS.IDLE));
    }

    if (current.type === "camera") {
      setCameraStatus("scanning");
      setCameraDisplayText("");
      // Clear any previous typewriter interval
      if (cameraTypewriterRef.current) {
        clearInterval(cameraTypewriterRef.current);
        cameraTypewriterRef.current = null;
      }

      // Phase 1: show loading dots → fetch audio
      setCameraDisplayText("__loading__");

      fetchAudio(current.question)
        .then((blob) => {
          // Probe duration
          const probeUrl = URL.createObjectURL(blob);
          const probeAudio = new Audio();
          probeAudio.preload = "metadata";

          const startCameraTypewriter = (durationMs) => {
            URL.revokeObjectURL(probeUrl);
            const text  = current.question;
            const chars = text.length;
            const delay = Math.max(Math.floor(durationMs / chars), 25);
            let i = 0;

            // Phase 2: start typewriter + audio simultaneously
            setCameraDisplayText("");
            playBlob(blob, () => {
              // Phase 3: ensure full text shown, start camera
              setCameraDisplayText(text);
              setCameraTyping(false);
              if (cameraTypewriterRef.current) {
                clearInterval(cameraTypewriterRef.current);
                cameraTypewriterRef.current = null;
              }
              startCamera().then(() => startRealtimeValidation(step));
            });

            setCameraTyping(true);
            cameraTypewriterRef.current = setInterval(() => {
              i++;
              setCameraDisplayText(text.slice(0, i));
              if (i >= chars) {
                clearInterval(cameraTypewriterRef.current);
                cameraTypewriterRef.current = null;
                setCameraTyping(false);
              }
            }, delay);
          };

          probeAudio.addEventListener("loadedmetadata", () => {
            startCameraTypewriter((probeAudio.duration || 3) * 1000);
          }, { once: true });

          probeAudio.addEventListener("error", () => {
            URL.revokeObjectURL(probeUrl);
            startCameraTypewriter(3000);
          }, { once: true });

          probeAudio.src = probeUrl;
        })
        .catch(() => {
          // Audio failed — show text immediately, start camera
          setCameraDisplayText(current.question);
          startCamera().then(() => startRealtimeValidation(step));
        });
    }
  }, [step, started]);

  // ─── MIC LABEL ───────────────────────────────────────────────────────────
  const micLabel = () => {
    switch (vs) {
      case VS.SPEAKING_Q:       return { icon: "🔊", text: "Listening…",   active: false };
      case VS.IDLE:             return { icon: "🎙️", text: "Tap to Answer", active: false };
      case VS.RECORDING_MAIN:   return { icon: "⏹️", text: "Tap to Stop",   active: true  };
      case VS.PROCESSING_MAIN:  return { icon: "⏳", text: "Thinking…",     active: false };
      case VS.SPEAKING_PROBE:   return { icon: "🔊", text: "Listening…",    active: false };
      case VS.PROBE_READY:      return { icon: "🎙️", text: "Tap to Answer", active: false };
      case VS.RECORDING_PROBE:  return { icon: "⏹️", text: "Tap to Stop",   active: true  };
      case VS.PROCESSING_PROBE: return { icon: "⏳", text: "Saving…",       active: false };
      case VS.ACKNOWLEDGING:    return { icon: "🔊", text: "Listening…",    active: false };
      case VS.DONE:             return { icon: "✅", text: "Done!",         active: false };
      default:                  return { icon: "🎙️", text: "Tap to Answer", active: false };
    }
  };

  const micDisabled =
    vs === VS.SPEAKING_Q       ||
    vs === VS.PROCESSING_MAIN  ||
    vs === VS.SPEAKING_PROBE   ||
    vs === VS.PROCESSING_PROBE ||
    vs === VS.ACKNOWLEDGING    ||
    vs === VS.DONE;

  // ─── DOWNLOAD ────────────────────────────────────────────────────────────
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

  // ─── RENDER ──────────────────────────────────────────────────────────────

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

  if (phase === PHASE.CONSENT) {
    return (
      <div className="page-bg">
        <div className="card consent-card">
          <div className="consent-icon">🔒</div>
          <h2 className="title">Your Privacy Matters</h2>
          <p className="consent-body">
            To continue with this study, we need to collect some personal information
            including your responses, voice recordings, and camera footage of your workspace.
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
                sessionTranscript.push({ question: "Age",        answer: age    });
                sessionTranscript.push({ question: "Gender",     answer: gender });
                sessionTranscript.push({ question: "PII Consent",answer: "Agreed" });
                setStarted(true);
                setPhase(PHASE.SURVEY);
              }}
            >
              I Agree
            </button>
            <button className="consent-disagree" onClick={() => setPhase(PHASE.TERMINATED)}>
              I Disagree
            </button>
          </div>
        </div>
      </div>
    );
  }

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

  if (phase !== PHASE.SURVEY) return null;
  if (step >= FLOW.length)   return null;

  const current = FLOW[step];
  const ml      = micLabel();

  return (
    <div className="survey-bg">

      {/* ── CAMERA ── */}
      {current.type === "camera" && (
        <div className="camera-screen">
          <div className="camera-q-box">
            <span className="q-label-small">Question</span>
            {cameraDisplayText === "__loading__" ? (
              <p className="camera-q-text">
                <span className="dots-loader"><span /><span /><span /></span>
              </p>
            ) : (
              <p className="camera-q-text">
                {cameraDisplayText}
                {cameraTyping && <span className="typing-cursor">▌</span>}
              </p>
            )}
          </div>
          <video ref={videoRef} autoPlay playsInline className="camera-video" />
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

      {/* ── VOICE — chat UI ── */}
      {current.type === "voice" && (
        <div className="chat-screen">
          <div className="chat-messages">
            {chatMessages.map((msg) => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                text={msg.text}
                loading={!!msg.loading}
                typewriter={!!msg.typewriter}
                typewriterDuration={msg.typewriterDuration || 0}
                typing={!!msg.typing}
              />
            ))}
            <div ref={chatEndRef} />
          </div>

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