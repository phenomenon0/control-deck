// Icon components extracted from ChatPaneV2
import { AudioLines, Mic, Paperclip, Send } from "lucide-react";

export function VoiceModeIcon({ size = 16 }: { size?: number }) {
  return <AudioLines size={size} />;
}

export function MicIcon({ size = 16 }: { size?: number }) {
  return <Mic size={size} />;
}

export function PaperclipIcon({ size = 16 }: { size?: number }) {
  return <Paperclip size={size} />;
}

export function SendIcon({ size = 16 }: { size?: number }) {
  return <Send size={size} />;
}
