import type { Artifact } from "@/lib/types/chat";

// Types
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  artifacts?: Artifact[];
  /** Persisted metadata — tool call summaries, upload refs, etc. */
  metadata?: Record<string, unknown>;
}

export interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
  preview?: string;
}

// Thread records and messages live in SQLite (deck.db) behind /api/threads —
// localStorage is NOT a thread store. The only chat key allowed here is
// pure-UI convenience state: the last-open thread id.
export const ACTIVE_THREAD_KEY = "deck:activeThread";

// Pre-merge builds mirrored the thread catalogue into localStorage under this
// key. It is orphaned now; useThreads purges it once on mount.
const LEGACY_THREADS_KEY = "deck:threads";

/** Drop the legacy localStorage thread-catalogue mirror. Idempotent. */
export function purgeLegacyThreadCache() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_THREADS_KEY);
  } catch {
    /* private mode — nothing to purge */
  }
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
