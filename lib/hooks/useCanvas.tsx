/**
 * Canvas State Management Hook
 * 
 * Provides global state for the canvas panel, enabling seamless integration
 * between chat and code execution/preview.
 * 
 * Design inspired by:
 * - Claude Artifacts: Dedicated panel, auto-open, persistence
 * - ChatGPT Canvas: Inline editing, revisions, shortcuts
 * - Cursor: Multi-file tabs, live preview, agent integration
 * 
 * Features:
 * - Tab management with auto-open
 * - Revision history per tab (undo/redo)
 * - LocalStorage persistence
 * - Code execution integration
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

export type CanvasContentType = 
  | "code"
  | "preview"
  | "image"
  | "audio"
  | "document"
  | "diagram"
  | "model3d";

// Revision for undo/redo
export interface Revision {
  id: string;
  code: string;
  timestamp: number;
  label?: string; // e.g., "Initial", "After execution", "Manual edit"
}

export interface CanvasTab {
  id: string;
  type: CanvasContentType;
  title: string;
  language?: string;
  code?: string;
  output?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    durationMs?: number;
  };
  preview?: {
    html?: string;
    bundled?: string;
  };
  images?: Array<{
    name: string;
    mimeType: string;
    data: string;
  }>;
  artifact?: {
    id: string;
    url: string;
    name: string;
    mimeType: string;
  };
  isRunning?: boolean;
  isEditable?: boolean;
  createdAt: number;
  updatedAt: number;
  // Revision history
  revisions?: Revision[];
  currentRevisionIndex?: number;
}

export interface CanvasState {
  isOpen: boolean;
  tabs: CanvasTab[];
  activeTabId: string | null;
  width: number;
  isResizing: boolean;
}

export interface CanvasActions {
  // Panel control
  open: () => void;
  close: () => void;
  toggle: () => void;
  setWidth: (width: number) => void;
  setResizing: (resizing: boolean) => void;
  
  // Tab management
  addTab: (tab: Omit<CanvasTab, "id" | "createdAt" | "updatedAt">) => string;
  updateTab: (id: string, updates: Partial<CanvasTab>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  
  // Content shortcuts
  openCode: (code: string, language: string, title?: string) => string;
  openPreview: (html: string, title?: string) => string;
  openImage: (url: string, name: string, mimeType: string) => string;
  openArtifact: (artifact: CanvasTab["artifact"]) => string;
  
  // Code execution
  executeCode: (tabId: string) => Promise<void>;
  updateCodeOutput: (tabId: string, output: CanvasTab["output"]) => void;
  setCodeRunning: (tabId: string, running: boolean) => void;
  
  // Revision history
  saveRevision: (tabId: string, label?: string) => void;
  undo: (tabId: string) => void;
  redo: (tabId: string) => void;
  getRevisions: (tabId: string) => Revision[];
  goToRevision: (tabId: string, revisionIndex: number) => void;
  canUndo: (tabId: string) => boolean;
  canRedo: (tabId: string) => boolean;
}

type CanvasContextValue = CanvasState & CanvasActions;

// =============================================================================
// Context
// =============================================================================

const CanvasContext = createContext<CanvasContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const STORAGE_KEY = "deck:canvas";
const MAX_REVISIONS = 50;

// LocalStorage helpers
function loadCanvasState(): Partial<CanvasState> | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Don't restore isRunning state
    if (parsed.tabs) {
      parsed.tabs = parsed.tabs.map((tab: CanvasTab) => ({ ...tab, isRunning: false }));
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCanvasState(state: CanvasState) {
  if (typeof window === "undefined") return;
  try {
    // Don't persist large data like images in localStorage
    const toStore = {
      ...state,
      tabs: state.tabs.map(tab => ({
        ...tab,
        images: undefined, // Don't persist images (too large)
        output: tab.output ? { exitCode: tab.output.exitCode } : undefined, // Keep minimal output
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.warn("[Canvas] Failed to persist state:", e);
  }
}

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CanvasState>(() => {
    const stored = loadCanvasState();
    return {
      isOpen: stored?.isOpen ?? false,
      tabs: stored?.tabs ?? [],
      activeTabId: stored?.activeTabId ?? null,
      width: stored?.width ?? DEFAULT_WIDTH,
      isResizing: false,
    };
  });
  
  const tabIdCounter = useRef(0);
  
  // Persist state changes to localStorage (debounced)
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      saveCanvasState(state);
    }, 500);
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [state]);
  
  // Panel control
  const open = useCallback(() => {
    setState(s => ({ ...s, isOpen: true }));
  }, []);
  
  const close = useCallback(() => {
    setState(s => ({ ...s, isOpen: false }));
  }, []);
  
  const toggle = useCallback(() => {
    setState(s => ({ ...s, isOpen: !s.isOpen }));
  }, []);
  
  const setWidth = useCallback((width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    setState(s => ({ ...s, width: clamped }));
  }, []);
  
  const setResizing = useCallback((resizing: boolean) => {
    setState(s => ({ ...s, isResizing: resizing }));
  }, []);
  
  // Tab management
  const addTab = useCallback((tabData: Omit<CanvasTab, "id" | "createdAt" | "updatedAt">) => {
    const id = `canvas-${++tabIdCounter.current}-${Date.now()}`;
    const now = Date.now();
    const tab: CanvasTab = { ...tabData, id, createdAt: now, updatedAt: now };
    
    setState(s => ({
      ...s,
      tabs: [...s.tabs, tab],
      activeTabId: id,
      isOpen: true, // Auto-open when adding content
    }));
    
    return id;
  }, []);
  
  const updateTab = useCallback((id: string, updates: Partial<CanvasTab>) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => 
        t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
      ),
    }));
  }, []);
  
  const removeTab = useCallback((id: string) => {
    setState(s => {
      const newTabs = s.tabs.filter(t => t.id !== id);
      let newActiveId = s.activeTabId;
      
      // If removing active tab, switch to last tab or close
      if (s.activeTabId === id) {
        newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
      }
      
      return {
        ...s,
        tabs: newTabs,
        activeTabId: newActiveId,
        isOpen: newTabs.length > 0,
      };
    });
  }, []);
  
  const setActiveTab = useCallback((id: string) => {
    setState(s => ({ ...s, activeTabId: id }));
  }, []);
  
  // Content shortcuts
  const openCode = useCallback((code: string, language: string, title?: string) => {
    // Create initial revision
    const initialRevision: Revision = {
      id: `rev-${Date.now()}`,
      code,
      timestamp: Date.now(),
      label: "Initial",
    };
    
    return addTab({
      type: "code",
      title: title || `${language} code`,
      language,
      code,
      isEditable: true,
      revisions: [initialRevision],
      currentRevisionIndex: 0,
    });
  }, [addTab]);
  
  const openPreview = useCallback((html: string, title?: string) => {
    return addTab({
      type: "preview",
      title: title || "Preview",
      preview: { bundled: html },
    });
  }, [addTab]);
  
  const openImage = useCallback((url: string, name: string, mimeType: string) => {
    return addTab({
      type: "image",
      title: name,
      artifact: { id: `img-${Date.now()}`, url, name, mimeType },
    });
  }, [addTab]);
  
  const openArtifact = useCallback((artifact: CanvasTab["artifact"]) => {
    if (!artifact) return "";
    
    const type: CanvasContentType = 
      artifact.mimeType.startsWith("image/") ? "image" :
      artifact.mimeType.startsWith("audio/") ? "audio" :
      artifact.mimeType.includes("gltf") || artifact.mimeType.includes("glb") ? "model3d" :
      "document";
    
    return addTab({
      type,
      title: artifact.name,
      artifact,
    });
  }, [addTab]);
  
  // Code execution
  const executeCode = useCallback(async (tabId: string) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== "code" || !tab.code || !tab.language) return;
    
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => 
        t.id === tabId ? { ...t, isRunning: true, output: undefined } : t
      ),
    }));
    
    try {
      const res = await fetch("/api/code/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: tab.language,
          code: tab.code,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setState(s => ({
          ...s,
          tabs: s.tabs.map(t => 
            t.id === tabId ? {
              ...t,
              isRunning: false,
              output: {
                stdout: data.stdout,
                stderr: data.stderr,
                exitCode: data.exitCode,
                durationMs: data.durationMs,
              },
              preview: data.preview,
              images: data.images,
              updatedAt: Date.now(),
            } : t
          ),
        }));
      }
    } catch (error) {
      setState(s => ({
        ...s,
        tabs: s.tabs.map(t => 
          t.id === tabId ? {
            ...t,
            isRunning: false,
            output: {
              stderr: error instanceof Error ? error.message : "Execution failed",
              exitCode: 1,
            },
            updatedAt: Date.now(),
          } : t
        ),
      }));
    }
  }, [state.tabs]);
  
  const updateCodeOutput = useCallback((tabId: string, output: CanvasTab["output"]) => {
    updateTab(tabId, { output, isRunning: false });
  }, [updateTab]);
  
  const setCodeRunning = useCallback((tabId: string, running: boolean) => {
    updateTab(tabId, { isRunning: running });
  }, [updateTab]);
  
  // =============================================================================
  // Revision History
  // =============================================================================
  
  const saveRevision = useCallback((tabId: string, label?: string) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== tabId || !t.code) return t;
        
        const revisions = t.revisions || [];
        const currentIndex = t.currentRevisionIndex ?? -1;
        
        // If we're not at the end, truncate future revisions
        const truncatedRevisions = revisions.slice(0, currentIndex + 1);
        
        // Don't save if code hasn't changed
        const lastRevision = truncatedRevisions[truncatedRevisions.length - 1];
        if (lastRevision && lastRevision.code === t.code) return t;
        
        // Add new revision
        const newRevision: Revision = {
          id: `rev-${Date.now()}`,
          code: t.code,
          timestamp: Date.now(),
          label,
        };
        
        // Keep only last MAX_REVISIONS
        const newRevisions = [...truncatedRevisions, newRevision].slice(-MAX_REVISIONS);
        
        return {
          ...t,
          revisions: newRevisions,
          currentRevisionIndex: newRevisions.length - 1,
          updatedAt: Date.now(),
        };
      }),
    }));
  }, []);
  
  const undo = useCallback((tabId: string) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== tabId) return t;
        
        const revisions = t.revisions || [];
        const currentIndex = t.currentRevisionIndex ?? revisions.length - 1;
        
        if (currentIndex <= 0 || revisions.length === 0) return t;
        
        const newIndex = currentIndex - 1;
        const revision = revisions[newIndex];
        
        return {
          ...t,
          code: revision.code,
          currentRevisionIndex: newIndex,
          updatedAt: Date.now(),
        };
      }),
    }));
  }, []);
  
  const redo = useCallback((tabId: string) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== tabId) return t;
        
        const revisions = t.revisions || [];
        const currentIndex = t.currentRevisionIndex ?? revisions.length - 1;
        
        if (currentIndex >= revisions.length - 1) return t;
        
        const newIndex = currentIndex + 1;
        const revision = revisions[newIndex];
        
        return {
          ...t,
          code: revision.code,
          currentRevisionIndex: newIndex,
          updatedAt: Date.now(),
        };
      }),
    }));
  }, []);
  
  const getRevisions = useCallback((tabId: string): Revision[] => {
    const tab = state.tabs.find(t => t.id === tabId);
    return tab?.revisions || [];
  }, [state.tabs]);
  
  const goToRevision = useCallback((tabId: string, revisionIndex: number) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== tabId) return t;
        
        const revisions = t.revisions || [];
        if (revisionIndex < 0 || revisionIndex >= revisions.length) return t;
        
        const revision = revisions[revisionIndex];
        
        return {
          ...t,
          code: revision.code,
          currentRevisionIndex: revisionIndex,
          updatedAt: Date.now(),
        };
      }),
    }));
  }, []);
  
  const canUndo = useCallback((tabId: string): boolean => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    const revisions = tab.revisions || [];
    const currentIndex = tab.currentRevisionIndex ?? revisions.length - 1;
    return currentIndex > 0 && revisions.length > 0;
  }, [state.tabs]);
  
  const canRedo = useCallback((tabId: string): boolean => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    const revisions = tab.revisions || [];
    const currentIndex = tab.currentRevisionIndex ?? revisions.length - 1;
    return currentIndex < revisions.length - 1;
  }, [state.tabs]);
  
  const value: CanvasContextValue = {
    ...state,
    open,
    close,
    toggle,
    setWidth,
    setResizing,
    addTab,
    updateTab,
    removeTab,
    setActiveTab,
    openCode,
    openPreview,
    openImage,
    openArtifact,
    executeCode,
    updateCodeOutput,
    setCodeRunning,
    // Revision history
    saveRevision,
    undo,
    redo,
    getRevisions,
    goToRevision,
    canUndo,
    canRedo,
  };
  
  return (
    <CanvasContext.Provider value={value}>
      {children}
    </CanvasContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useCanvas() {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error("useCanvas must be used within a CanvasProvider");
  }
  return context;
}

// =============================================================================
// Selectors
// =============================================================================

export function useActiveCanvasTab() {
  const { tabs, activeTabId } = useCanvas();
  return tabs.find(t => t.id === activeTabId) ?? null;
}

export function useCanvasIsOpen() {
  const { isOpen } = useCanvas();
  return isOpen;
}
