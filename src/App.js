// import { useEffect, useRef, useState } from "react";
// import "./App.css";

// const FLOW = [
//   {
//     type: "camera",
//     question: "Show me your Office area.",
//     target: "Office Area",
//   }
// ];

// export default function App() {
//   const videoRef = useRef(null);
//   const streamRef = useRef(null); // ✅ IMPORTANT
//   const speakingRef  = useRef(false);

//   const [step, setStep] = useState(0);
//   const [started, setStarted] = useState(false);
//   const [busy, setBusy] = useState(false);

//   // 🔊 SPEAK
//   const speak = (text, cb) => {
//     if (speakingRef.current) return;
//     speakingRef.current = true;

//     window.speechSynthesis.cancel();
//     const speech = new SpeechSynthesisUtterance(text);
//     speech.rate = 1;

//     const setVoice = () => {
//       const voices = window.speechSynthesis.getVoices();
//       const female =
//         voices.find((v) => v.name.includes("Samantha")) ||
//         voices.find((v) => v.name.includes("Google UK English Female")) ||
//         voices.find((v) => v.name.includes("Microsoft Zira")) ||
//         voices.find((v) => v.name.toLowerCase().includes("female")) ||
//         voices[0];
//       if (female) speech.voice = female;
//     };

//     speech.onend = () => {
//       speakingRef.current = false;
//       if (cb) cb();
//     };

//     if (window.speechSynthesis.getVoices().length === 0) {
//       window.speechSynthesis.onvoiceschanged = () => { setVoice(); window.speechSynthesis.speak(speech); };
//     } else {
//       setVoice();
//       window.speechSynthesis.speak(speech);
//     }
//   };

//   // 🎥 START CAMERA

//   const startCamera = async () => {
//   try {
//     const stream = await navigator.mediaDevices.getUserMedia({
//       video: {
//         facingMode: { exact: "environment" }, // ✅ Forces back camera on mobile
//         width: { ideal: 1280 },
//         height: { ideal: 720 },
//       },
//     });

//     streamRef.current = stream;

//     if (videoRef.current) {
//       videoRef.current.srcObject = stream;
//     }
//   } catch (err) {
//     // ⚠️ Fallback: if back camera not available, use any camera
//     console.warn("Back camera not found, falling back:", err);
//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({
//         video: { facingMode: "environment" }, // soft constraint (no exact)
//       });

//       streamRef.current = stream;

//       if (videoRef.current) {
//         videoRef.current.srcObject = stream;
//       }
//     } catch (fallbackErr) {
//       console.error("Camera error:", fallbackErr);
//     }
//   }
// };

//   // 🛑 STOP CAMERA
//   const stopCamera = () => {
//     if (streamRef.current) {
//       streamRef.current.getTracks().forEach((track) => track.stop());
//       streamRef.current = null;
//     }

//     if (videoRef.current) {
//       videoRef.current.srcObject = null;
//     }
//   };

//   // 📸 CAPTURE FRAME
//   const capture = () => {
//     const canvas = document.createElement("canvas");
//     canvas.width = 320;
//     canvas.height = 240;

//     const ctx = canvas.getContext("2d");
//     ctx.drawImage(videoRef.current, 0, 0, 320, 240);

//     return canvas.toDataURL("image/jpeg");
//   };

//   // 🧠 CAMERA VALIDATION
//   const validateCamera = async () => {
//     if (busy) return;

//     setBusy(true);

//     const img = capture();

//     const res = await fetch(`${BASE_URL}/analyze`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         image: img,
//         type: FLOW[step].target,
//       }),
//     });

//     const data = await res.json();

//     speak(data.message, () => {
//       setBusy(false);

//       if (data.status === "ok") {
//         next();
//       } else {
//         setTimeout(validateCamera, 2000);
//       }
//     });
//   };

//   // 🧠 MCQ HANDLER
//   const handleMCQ = async (option) => {
//     if (busy) return;

//     setBusy(true);

//     await fetch(`${BASE_URL}/save`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         question: FLOW[step].question,
//         answer: option,
//       }),
//     });

//     speak(`You selected ${option}`, () => {
//       setBusy(false);
//       next();
//     });
//   };

//   // ⏭ NEXT STEP
//   const next = () => {
//     stopCamera(); // ✅ ALWAYS STOP BEFORE MOVING
//     setStep((s) => s + 1);
//   };

//   // 🎯 FLOW ENGINE
//   useEffect(() => {
//     if (!started) return;

//     const current = FLOW[step];

//     if (!current) {
//       speak("Survey completed. Thank you.");
//       stopCamera();
//       return;
//     }

//     // 🚨 ALWAYS STOP FIRST BEFORE SWITCHING MODE
//     stopCamera();

//     if (current.type === "camera") {
//       speak(current.question, () => {
//         startCamera().then(() => {
//           setTimeout(validateCamera, 1000);
//         });
//       });
//     }

//     if (current.type === "voice") {
//       speak(current.question);
//     }
//   }, [step, started]);

//   return (
//     <div className="container">
//       <div className="card">
//         {!started && (
//           <button
//             onClick={() => {
//               setStarted(true);
//               window.speechSynthesis.resume();
//             }}
//           >
//             Start Survey
//           </button>
//         )}

//         <h2>{FLOW[step]?.question}</h2>

//         {/* 🎥 CAMERA VIEW */}
//         <video ref={videoRef} autoPlay playsInline style={{ width: 300 }} />

//         {/* 🧠 MCQ OPTIONS */}
//         {started &&
//           FLOW[step]?.type === "voice" &&
//           FLOW[step]?.options?.map((opt) => (
//             <button
//               key={opt}
//               onClick={() => handleMCQ(opt)}
//               style={{
//                 display: "block",
//                 margin: "10px",
//                 padding: "10px",
//               }}
//             >
//               {opt}
//             </button>
//           ))}
//       </div>
//     </div>
//   );
// }
















//---------------------------------------new code with ui------------------------------

import { useEffect, useRef, useState } from "react";
import "./App.css";
const BASE_URL = process.env.REACT_APP_BASE_URL;

const PHASE = {
  AGE: "age",
  GENDER: "gender",
  SURVEY: "survey",
};

const FLOW = [
  {
    type: "camera",
    question: "Show me your Office area.",
    target: "Office Area",
  }
];

export default function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const speakingRef = useRef(false);

  const [phase, setPhase] = useState(PHASE.AGE);
  const [age, setAge] = useState("");
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  // 🔊 SPEAK
  const speak = (text, cb) => {
    if (speakingRef.current) return;
    speakingRef.current = true;

    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);

    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const female =
        voices.find((v) => v.name.includes("Female")) ||
        voices.find((v) => v.name.includes("Zira")) ||
        voices[0];
      if (female) speech.voice = female;
    };

    speech.onend = () => {
      speakingRef.current = false;
      cb && cb();
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        setVoice();
        window.speechSynthesis.speak(speech);
      };
    } else {
      setVoice();
      window.speechSynthesis.speak(speech);
    }
  };

  // 🎥 CAMERA
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // 📸 CAPTURE
  const capture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, 320, 240);

    return canvas.toDataURL("image/jpeg");
  };

  // 🧠 VALIDATE CAMERA
  const validateCamera = async () => {
    if (busy) return;

    setBusy(true);

    const img = capture();

    try {
      const res = await fetch(`${BASE_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: img,
          type: FLOW[step].target,
        }),
      });

      const data = await res.json();

      speak(data.message, () => {
        setBusy(false);

        if (data.status === "ok") {
          next();
        } else {
          setTimeout(validateCamera, 2000);
        }
      });
    } catch {
      setBusy(false);
    }
  };

  // 🧠 MCQ
  const handleMCQ = async (option) => {
    if (busy) return;

    setBusy(true);

    try {
      await fetch(`${BASE_URL}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: FLOW[step].question,
          answer: option,
        }),
      });
    } catch {}

    speak(`You selected ${option}`, () => {
      setBusy(false);
      setStep((prev) => prev + 1);
    });
  };

  const next = () => {
    stopCamera();
    setStep((s) => s + 1);
  };

  // 🎯 FLOW ENGINE
  useEffect(() => {
    if (!started) return;

    const current = FLOW[step];
    if (!current) return;

    stopCamera();

    if (current.type === "camera") {
      speak(current.question, () => {
        startCamera().then(() => {
          setTimeout(validateCamera, 1000);
        });
      });
    }

    if (current.type === "voice") {
      speak(current.question);
    }
  }, [step, started]);

  // ================= UI =================

  // ✅ AGE SCREEN
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
            <button
              className="next-btn"
              disabled={!age}
              onClick={() => setPhase(PHASE.GENDER)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ✅ GENDER SCREEN
  if (phase === PHASE.GENDER) {
    return (
      <div className="page-bg">
        <div className="card">
          <h2 className="title">What is your gender?</h2>

          <div className="options-row">
            {["Male", "Female", "Other"].map((g) => (
              <button
                key={g}
                className="option-btn"
                onClick={() => {
                  setPhase(PHASE.SURVEY);
                  setStarted(true);
                  window.speechSynthesis.resume();
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ✅ SURVEY COMPLETED
  if (step >= FLOW.length) {
    return (
      <div className="page-bg">
        <div className="card">
          <h2 className="title">Survey Completed 🎉</h2>
          <p style={{ marginTop: "10px", color: "#555" }}>
            Thank you for participating.
          </p>
        </div>
      </div>
    );
  }

  // ✅ SURVEY SCREEN
  return (
    <div className="container">
      <div className="card">
        <h2>{FLOW[step]?.question}</h2>

        {FLOW[step]?.type === "camera" && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: "100%", borderRadius: "12px", marginTop: "20px" }}
          />
        )}

        {FLOW[step]?.type === "voice" && (
          <div className="mcq-grid">
            {FLOW[step]?.options?.map((opt) => (
              <button
                key={opt}
                className="mcq-btn"
                onClick={() => handleMCQ(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}