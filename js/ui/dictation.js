// "Speak" button for flaws and measurements. Uses the Web Speech API when
// it's there; otherwise focuses the field and shows an iPhone keyboard hint.
import { toast } from "./dom.js";
import { speechSupported, startDictation, DICTATION_HINT, appendDictation } from "../core/voice.js";

export function dictateButton(inputId, { label = "Speak" } = {}) {
  return `<button type="button" class="btn sm soft dictate" data-act="dictate" data-input="${inputId}">🎤 ${label}</button>`;
}

export function dictateHint() {
  return `<p class="tiny muted dictate-hint">${DICTATION_HINT}</p>`;
}

/**
 * Start dictation into an input or textarea. If the Speech API is missing,
 * focus the field and show the keyboard-mic hint.
 * Returns a session (call stop() on it) or null.
 */
export function beginDictate(input, { onText } = {}) {
  if (!input) { toast("Can't find that field."); return null; }
  if (!speechSupported()) {
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* not all inputs */ }
    toast(DICTATION_HINT);
    return null;
  }
  input.dataset.listening = "1";
  input.focus();
  const existing = input.value || "";
  const session = startDictation({
    existing,
    onResult(text) {
      input.value = text;
      if (onText) onText(text);
    },
    onError(msg) { toast(msg); },
    onEnd(finalText) {
      input.dataset.listening = "";
      const next = finalText || input.value;
      input.value = next;
      if (onText) onText(next);
      toast("Dictation stopped. You can edit the text.");
    }
  });
  if (!session) {
    input.dataset.listening = "";
    input.focus();
    toast(DICTATION_HINT);
    return null;
  }
  toast("Listening… tap Speak again to stop.");
  return session;
}

export { speechSupported, appendDictation, DICTATION_HINT };
