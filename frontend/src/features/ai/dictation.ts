export type SpeechEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
export type SpeechConstructor = new () => Recognition;
export function createDictation(options: {
  getSpeech: () => SpeechConstructor | undefined;
  language: () => string;
  append: (text: string) => void;
  onListening: (value: boolean) => void;
  onStatus: (text: string) => void;
}) {
  let active: Recognition | null = null,
    version = 0;
  function stop() {
    version++;
    const old = active;
    active = null;
    if (old) {
      old.onresult = old.onerror = old.onend = null;
      try {
        old.abort();
      } catch {
        /* Already stopped. */
      }
    }
    options.onListening(false);
  }
  function toggle() {
    if (active) {
      stop();
      options.onStatus("Dictation stopped. Review your words, then send.");
      return;
    }
    const Speech = options.getSpeech();
    if (!Speech) {
      options.onStatus(
        "Voice input is unavailable in this browser. Use text or operating-system dictation.",
      );
      return;
    }
    const token = ++version;
    try {
      const rec = new Speech();
      active = rec;
      rec.lang = options.language();
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        if (token !== version) return;
        let text = "";
        for (let i = e.resultIndex; i < e.results.length; i++)
          if (e.results[i].isFinal) text += e.results[i][0].transcript + " ";
        if (text.trim()) options.append(text.trim());
      };
      rec.onerror = (e) => {
        if (token !== version) return;
        const reasons: Record<string, string> = {
          "not-allowed":
            "Microphone or speech permission denied. Allow access in browser settings or type.",
          "service-not-allowed":
            "Browser speech service access denied. Use text.",
          "audio-capture": "No microphone available. Connect one or type.",
          network:
            "Browser speech service could not connect. Retry or use text.",
          "no-speech": "No speech detected. Try again.",
        };
        stop();
        options.onStatus(
          reasons[e.error] ||
            `Speech service unavailable (${e.error}). Use text or retry.`,
        );
      };
      rec.onend = () => {
        if (token === version) {
          stop();
          options.onStatus("Dictation stopped. Review your words, then send.");
        }
      };
      rec.start();
      options.onListening(true);
      options.onStatus(
        "Listening. Your browser may use its speech service. Dictation appends to your text and never sends automatically.",
      );
    } catch {
      stop();
      options.onStatus(
        "Voice input could not start. Use text or retry browser dictation.",
      );
    }
  }
  return { stop, toggle };
}
