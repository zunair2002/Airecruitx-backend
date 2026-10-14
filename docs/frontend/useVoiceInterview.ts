"use client";
/**
 * Voice interview hook (frontend, Next.js/React) — free browser Web Speech API.
 *  - speak(text): reads the question aloud (text-to-speech)
 *  - startListening()/stopListening(): turns the candidate's speech into text (speech-to-text)
 * The resulting `transcript` is sent to POST /api/interview/answer exactly like typed text,
 * so the backend needs no changes. Works in Chrome and Edge (not Firefox) — keep the text box
 * as a fallback. Copy this file to e.g. src/hooks/useVoiceInterview.ts in the frontend.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = any; // the Web Speech API has no built-in TS types in every setup

export function useVoiceInterview(lang = "en-US") {
  const recRef = useRef<Recognition | null>(null);
  const wantListening = useRef(false);
  const finalText = useRef("");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const sttSupported = Boolean(SR);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true; // keep listening through short pauses
    rec.interimResults = true; // show words while the candidate is still speaking
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText.current += text.trim() + " ";
        else interim += text;
      }
      setTranscript((finalText.current + interim).trim());
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech") return; // silence: onend restarts it
      setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech error: ${e.error}`);
      wantListening.current = false;
    };
    rec.onend = () => {
      // Chrome stops after a long pause; restart while the candidate is still answering
      if (wantListening.current) {
        try { rec.start(); } catch { /* already started */ }
      } else {
        setListening(false);
      }
    };
    recRef.current = rec;
    return () => { wantListening.current = false; try { rec.abort(); } catch { /* ignore */ } };
  }, [SR, lang]);

  /** Read text aloud; resolves when finished. Listening is paused so the mic doesn't hear the question. */
  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!ttsSupported) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => { setSpeaking(false); resolve(); };
    window.speechSynthesis.speak(u);
  }), [lang, ttsSupported]);

  const startListening = useCallback(() => {
    if (!recRef.current) return;
    setError(null);
    finalText.current = "";
    setTranscript("");
    wantListening.current = true;
    try { recRef.current.start(); setListening(true); } catch { /* already started */ }
  }, []);

  /** Stop and return the final answer text. */
  const stopListening = useCallback((): string => {
    wantListening.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
    return (finalText.current || transcript).trim();
  }, [transcript]);

  return { sttSupported, ttsSupported, speak, startListening, stopListening, transcript, setTranscript, listening, speaking, error };
}

/* ---------------------------------------------------------------- usage example
const voice = useVoiceInterview("en-US");   // try "en-IN" if Pakistani English is recognised better

// when a new question arrives from the backend:
await voice.speak(session.question);
voice.startListening();

// UI: show voice.transcript live (editable textarea bound to voice.transcript / voice.setTranscript)
// "Submit answer" button:
const answer = voice.stopListening() || typedAnswer;
await api.post("/api/interview/answer", { sessionId, answer });

// Fallback: if (!voice.sttSupported) show only the normal text box
---------------------------------------------------------------- */
