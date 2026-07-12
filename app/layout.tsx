import type { Metadata } from "next";
import { IBM_Plex_Sans, Literata, JetBrains_Mono } from "next/font/google";
import "./atlas.css";
import "./atlas-components.css";
import "@wterm/react/css";

/* True-Atlas pass: the legacy sheets (globals/warp/audio — Tailwind engine,
   pane class library, audio dock) load ONLY on /v2/workspace, the one route
   that still hosts legacy panes. Every other surface resolves pure Atlas.
   blog-theme.css was deleted outright — atlas.css (loaded later) shadowed
   every token it defined and its component rules had no surviving consumer.
   WarpProvider moved with the panes (its one live consumer is the chat
   pane's ComposerTweaks). */

/* Atlas design language fonts — self-hosted by next/font at build time so the
   packaged Electron desktop app renders them OFFLINE (no CDN dependency).
   Exposed as CSS variables that app/atlas.css maps to --font-ui/reading/data. */
const fontPlex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});
const fontLiterata = Literata({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-literata",
  display: "swap",
});
const fontJetBrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Control Deck",
  description: "Homelab AI Control Center",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${fontPlex.variable} ${fontLiterata.variable} ${fontJetBrains.variable}`} data-theme="dark">
      <head>
        {/* Anti-FOUC: read persisted theme before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=JSON.parse(localStorage.getItem("deck.prefs")||"{}");var t=p.theme;if(t==="light"||t==="dark"||t==="hacker"){document.documentElement.dataset.theme=t;}}catch(e){}`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Inter:wght@400;500;600&family=Inter+Tight:wght@400;500;600&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Crimson+Pro:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Newsreader:ital,opsz,wght@0,16..72,400;0,16..72,500;0,16..72,600;1,16..72,400;1,16..72,500&family=Caveat:wght@500;600&family=Space+Grotesk:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet" />
        {/* Atlas fonts (IBM Plex Sans · Literata · JetBrains Mono) are self-hosted
            via next/font — see fontPlex/fontLiterata/fontJetBrains above. */}
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
