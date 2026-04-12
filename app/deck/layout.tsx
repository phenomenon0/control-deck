import { DeckShell } from "@/components/DeckShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary name="deck">
      <DeckShell>{children}</DeckShell>
    </ErrorBoundary>
  );
}
