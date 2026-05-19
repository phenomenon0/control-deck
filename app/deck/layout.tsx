import { DeckShell } from "@/components/DeckShell";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary name="deck">
      <OnboardingGate />
      <DeckShell>{children}</DeckShell>
    </ErrorBoundary>
  );
}
