import { VoiceLab } from "@/components/voice-lab/VoiceLab";

// Client-only diagnostic that reads useSearchParams — opt out of static
// prerender (it has no SSR/SEO value and would need a Suspense boundary).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Voice Lab",
  description: "End-to-end latency diagnostic for the voice pipeline.",
};

export default function VoiceLabPage() {
  return <VoiceLab />;
}
