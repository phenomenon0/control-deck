"use client";

import { Icon } from "@/components/warp/Icons";
import { useThreadManager } from "@/lib/hooks/useThreadManager";

function relativeTime(iso?: string): string {
  if (!iso) return "Today";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diff)) return "Today";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ThreadSidebar() {
  const {
    threads,
    activeThreadId,
    threadGroups,
    selectThread,
    deleteThread,
    setActiveThreadId,
    setMessages,
    resetFallbackThreadId,
  } = useThreadManager();

  const startDraft = () => {
    resetFallbackThreadId();
    setActiveThreadId(null);
    setMessages([]);
  };

  const handleDelete = (id: string, title: string) => {
    if (window.confirm(`Delete "${title || "this thread"}"?`)) {
      deleteThread(id);
    }
  };

  return (
    <aside className="threads">
      <div className="threads-head">
        <div>
          <span className="threads-title">Threads</span>
        </div>
        <button
          type="button"
          className={`threads-new ${activeThreadId ? "" : "on"}`}
          title="New thread"
          onClick={startDraft}
        >
          <Icon.Plus size={13} sw={1.5} />
        </button>
      </div>
      <div className="threads-list">
        {threadGroups.length === 0 ? (
          <div className="thread-empty">
            <div className="thread-title">No saved threads</div>
            <div className="thread-meta">Send a message to keep one here.</div>
          </div>
        ) : (
          threadGroups.map((group) => (
            <section key={group.label} className="thread-group">
              {group.threads.map((thread) => (
                <div
                  key={thread.id}
                  role="button"
                  tabIndex={0}
                  className={`thread ${thread.id === activeThreadId ? "on" : ""}`}
                  onClick={() => selectThread(thread.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectThread(thread.id);
                  }}
                >
                  <div className="thread-title">{thread.title}</div>
                  <div className="thread-meta">
                    <span>{relativeTime(thread.lastMessageAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="thread-delete"
                    title="Delete thread"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleDelete(thread.id, thread.title);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      handleDelete(thread.id, thread.title);
                    }}
                  >
                    <Icon.X size={12} sw={1.5} />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
