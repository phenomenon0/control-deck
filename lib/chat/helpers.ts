import type { Artifact } from "@/components/chat/ArtifactRenderer";

// Types
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
}

export interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
}

// localStorage keys
export const THREADS_KEY = "deck:threads";
export const ACTIVE_THREAD_KEY = "deck:activeThread";

export function getStoredThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(THREADS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setStoredThreads(threads: Thread[]) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

export function getStoredActiveThread(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_THREAD_KEY);
}

export function setStoredActiveThread(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_THREAD_KEY, id);
  else localStorage.removeItem(ACTIVE_THREAD_KEY);
}

// Helper to group threads by date
export function groupThreadsByDate(threads: Thread[]): { label: string; threads: Thread[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups: { label: string; threads: Thread[] }[] = [
    { label: "Today", threads: [] },
    { label: "Yesterday", threads: [] },
    { label: "Last 7 days", threads: [] },
    { label: "Last 30 days", threads: [] },
    { label: "Older", threads: [] },
  ];

  for (const t of threads) {
    const date = new Date(t.lastMessageAt);
    if (date >= today) {
      groups[0].threads.push(t);
    } else if (date >= yesterday) {
      groups[1].threads.push(t);
    } else if (date >= lastWeek) {
      groups[2].threads.push(t);
    } else if (date >= lastMonth) {
      groups[3].threads.push(t);
    } else {
      groups[4].threads.push(t);
    }
  }

  return groups.filter(g => g.threads.length > 0);
}
