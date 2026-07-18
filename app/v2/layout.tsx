import V2Nav from "@/components/v2/V2Nav";
import V2AppearanceHost from "@/components/v2/V2AppearanceHost";
import V2CommandPalette from "@/components/v2/V2CommandPalette";
import "./shell.css";

/* Atlas Visual 2 shell — hosts every /v2/* surface behind one Atlas nav rail.
   V2AppearanceHost is the reactive `.v2-host` wrapper: it drives data-theme +
   typography CSS vars from the user's deck.prefs, so surfaces re-theme live.
   Surfaces must NOT hardcode their own data-theme. */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <V2AppearanceHost>
      <V2Nav />
      {children}
      <V2CommandPalette />
    </V2AppearanceHost>
  );
}
