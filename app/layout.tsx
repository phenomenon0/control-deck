import type { Metadata } from "next";
import "./globals.css";
import "./warp.css";
import { WarpProvider } from "@/components/warp/WarpProvider";

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
    <html lang="en" className="dark" data-warmth="warm" data-type="matter" data-accent="amber" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Inter:wght@400;500;600&family=Inter+Tight:wght@400;500;600&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <WarpProvider>{children}</WarpProvider>
      </body>
    </html>
  );
}
