import { useEffect, useRef, useState } from "react";
import { createDictation, type SpeechConstructor } from "./dictation";
export function useDictation(identity: number, append: (text: string) => void) {
  const appendRef = useRef(append);
  appendRef.current = append;
  const [listening, setListening] = useState(false),
    [status, setStatus] = useState("");
  const controller = useRef<ReturnType<typeof createDictation> | null>(null);
  if (!controller.current)
    controller.current = createDictation({
      getSpeech: () => {
        const speechWindow = window as unknown as {
          SpeechRecognition?: SpeechConstructor;
          webkitSpeechRecognition?: SpeechConstructor;
        };
        return (
          speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
        );
      },
      language: () => navigator.language || "en-US",
      append: (text) => appendRef.current(text),
      onListening: setListening,
      onStatus: setStatus,
    });
  const { stop, toggle } = controller.current;
  useEffect(() => {
    stop();
    return stop;
  }, [identity, stop]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [stop]);
  return { listening, status, toggle, stop };
}
