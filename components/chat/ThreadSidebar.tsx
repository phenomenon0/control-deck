"use client";

import { ChevronsRight, Plus, ChevronsLeft, MessageSquare, X } from "lucide-react";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

/**
 * ThreadSidebar — self-contained thread list that consumes context directly.
 * Rendered at the shell level (DeckShell) per DESIGN.md §4, not inside ChatSurface.
 */
export function ThreadSidebar() {
  const {
    threads, activeThreadId, threadGroups,
    createThread, selectThread, deleteThread,
  } = useThreadManager();
  const { sidebarOpen, setSidebarOpen } = useDeckSettings();
  return (
    <aside className={`thread-sidebar ${sidebarOpen ? "expanded" : "collapsed"}`}>
      {/* Collapsed view buttons */}
      <div className="sidebar-collapsed-content">
        <button
          onClick={() => setSidebarOpen(true)}
          className="sidebar-expand-btn"
          title="Open sidebar (Cmd+B)"
        >
          <ChevronsRight width={16} height={16} />
        </button>
        <button
          onClick={() => createThread()}
          className="sidebar-new-btn-mini"
          title="New Chat"
        >
          <Plus width={16} height={16} />
        </button>
        {threads.length > 0 && (
          <span className="sidebar-thread-count">{threads.length}</span>
        )}
      </div>

      {/* Expanded view content */}
      <div className="sidebar-expanded-content">
        {/* Sidebar Header */}
        <div className="sidebar-header-left">
          <button onClick={() => createThread()} className="new-chat-btn">
            <Plus width={16} height={16} />
            New Chat
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="sidebar-collapse-btn"
            title="Close sidebar (Cmd+B)"
          >
            <ChevronsLeft width={16} height={16} />
          </button>
        </div>

        {/* Thread List */}
        <div className="thread-list">
          {threads.length === 0 ? (
            <div className="thread-empty">
              <div className="thread-empty-icon">
                <MessageSquare width={40} height={40} strokeWidth={1.5} />
              </div>
              <div className="thread-empty-text">
                No conversations yet.<br />
                Start a new chat!
              </div>
            </div>
          ) : (
            threadGroups.map((group) => (
              <div key={group.label} className="thread-group">
                <div className="thread-group-label">{group.label}</div>
                {group.threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => selectThread(t.id)}
                    className={`thread-item ${activeThreadId === t.id ? "active" : ""}`}
                  >
                    <div className="thread-item-icon">
                      <MessageSquare width={16} height={16} />
                    </div>
                    <div className="thread-item-content">
                      <div className="thread-item-title">{t.title}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                      className="thread-delete-btn"
                      title="Delete"
                    >
                      <X width={14} height={14} />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="sidebar-footer-left">
          <span>{threads.length} conversation{threads.length !== 1 ? "s" : ""}</span>
          <span className="sidebar-shortcut">&#x2318;B</span>
        </div>
      </div>
    </aside>
  );
}
