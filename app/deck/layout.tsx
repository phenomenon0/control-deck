import { DeckShell } from "@/components/DeckShell";

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return <DeckShell>{children}</DeckShell>;
}
