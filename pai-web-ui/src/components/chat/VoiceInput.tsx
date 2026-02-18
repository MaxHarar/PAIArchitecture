"use client";

import { useEffect, useState } from "react";
import { useSpeechRecognition } from "@/lib/voice/useSpeechRecognition";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInput({ onTranscript, disabled = false }: VoiceInputProps) {
  const [showUnsupported, setShowUnsupported] = useState(false);

  const {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
  });

  // When final transcript is received, send it
  useEffect(() => {
    if (transcript && !isListening) {
      onTranscript(transcript);
      resetTranscript();
    }
  }, [transcript, isListening, onTranscript, resetTranscript]);

  const handleClick = () => {
    if (!isSupported) {
      setShowUnsupported(true);
      setTimeout(() => setShowUnsupported(false), 3000);
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Handle keyboard shortcut (V key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not in an input field
      if (
        e.key.toLowerCase() === "v" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        handleClick();
      }

      // Escape stops listening
      if (e.key === "Escape" && isListening) {
        stopListening();
        resetTranscript();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isListening, isSupported]);

  const displayTranscript = interimTranscript || transcript;

  return (
    <div className="relative">
      {/* Microphone button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`
          relative w-10 h-10 rounded-full flex items-center justify-center
          transition-all duration-200
          ${
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
        title={
          !isSupported
            ? "Voice input not supported in this browser"
            : isListening
            ? "Stop listening (Escape)"
            : "Start voice input (V)"
        }
      >
        {/* Microphone icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>

        {/* Pulsing indicator when listening */}
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full animate-pulse" />
          </>
        )}
      </button>

      {/* Transcript preview - anchored left to stay on screen */}
      {isListening && displayTranscript && (
        <div className="absolute bottom-full mb-2 left-0 min-w-[200px] max-w-[300px]">
          <div className="bg-card border border-border rounded-lg shadow-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">Listening...</p>
            <p className="text-sm">
              {displayTranscript}
              <span className="animate-pulse">|</span>
            </p>
          </div>
        </div>
      )}

      {/* Error message - anchored left to stay on screen */}
      {error && (
        <div className="absolute bottom-full mb-2 left-0 min-w-[200px] max-w-[300px]">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Unsupported browser message - anchored left to stay on screen */}
      {showUnsupported && (
        <div className="absolute bottom-full mb-2 left-0 min-w-[220px] max-w-[300px]">
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2">
            <p className="text-xs text-yellow-400">
              Voice input is not supported in this browser. Try Chrome or Edge.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
