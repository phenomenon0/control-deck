import { BrowserHeader } from "@/components/browser/BrowserHeader";

export const dynamic = "force-static";

export default function BrowserHeaderPage() {
  return (
    <main
      className="h-screen w-screen overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <BrowserHeader />
    </main>
  );
}
