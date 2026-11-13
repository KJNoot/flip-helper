// Voice dictation for flaws and measurements.
// Uses the Web Speech API where the browser offers it. On iPhone Safari
// that API is often missing, so we fall back to a focused text field and
// a hint to use the keyboard microphone.

export const DICTATION_HINT = "On iPhone, tap the microphone on the keyboard to dictate.";
export const DICTATION_UNSUPPORTED = "Voice typing isn't available in this browser. " + DICTATION_HINT;

export function speechSupported() {
  try {
    return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  } catch (e) { return false; }
}

/**
 * Start listening. Returns a session with a stop() method, or null if
 * the Web Speech API is not available (the UI should then focus the
 * field and show DICTATION_HINT).
 *
 * onResult(text, { final }) — cumulative transcript
 * onError(message)
 * onEnd()
 */
export function startDictation({ onResult, onError, onEnd, lang = "en-US", existing = "" } = {}) {
  const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let finalText = existing ? String(existing).trim() : "";
  let stopped = false;
  rec.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0] && event.results[i][0].transcript ? event.results[i][0].transcript : "";
      if (event.results[i].isFinal) {
        finalText = (finalText ? finalText + " " : "") + piece.trim();
      } else {
        interim += piece;
      }
    }
    const text = (finalText + (interim ? (finalText ? " " : "") + interim : "")).replace(/\s+/g, " ").trim();
    if (onResult) onResult(text, { final: !interim, interim: interim.trim() });
  };
  rec.onerror = event => {
    const name = event && event.error ? String(event.error) : "";
    if (name === "aborted" || name === "no-speech") return;
    if (onError) onError(friendlyVoiceError(name));
  };
  rec.onend = () => {
    if (!stopped && rec._keepGoing) {
      try { rec.start(); return; } catch (e) { /* fall through */ }
    }
    if (onEnd) onEnd(finalText);
  };
  rec._keepGoing = true;
  try { rec.start(); }
  catch (e) {
    if (onError) onError("Couldn't start the microphone. You can type, or use the microphone on the keyboard.");
    return null;
  }
  return {
    recognition: rec,
    stop() {
      stopped = true;
      rec._keepGoing = false;
      try { rec.stop(); } catch (e) { /* already stopped */ }
    }
  };
}

export function friendlyVoiceError(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "The microphone isn't allowed. You can type, or use the microphone on the keyboard.";
  }
  if (code === "audio-capture") {
    return "No microphone was found. You can type instead.";
  }
  if (code === "network") {
    return "Voice typing needs a connection on this phone. You can type instead, or use the keyboard microphone.";
  }
  return "Voice typing ran into a problem. You can type, or use the microphone on the keyboard.";
}

/** Append dictated text to a field, with a space if needed. */
export function appendDictation(current, spoken) {
  const a = String(current || "").trim();
  const b = String(spoken || "").trim();
  if (!b) return a;
  if (!a) return b;
  if (a.endsWith(b) || a.includes(b)) return a;
  return (a + " " + b).replace(/\s+/g, " ").trim();
}
