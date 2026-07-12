import { DeckShell } from "@/components/DeckShell";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { LegacyBanner } from "./legacy-banner";

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary name="deck">
      <OnboardingGate />
      <LegacyBanner />
      <DeckShell>{children}</DeckShell>
    </ErrorBoundary>
  );
}
