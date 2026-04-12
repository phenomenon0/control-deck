"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Radio,
  List,
  LayoutGrid,
  Table,
  FileText,
  SquarePen,
  Sparkles,
  Send,
  Check,
  X,
  Loader,
  Wand2,
  MessageSquare,
} from "lucide-react";
import type { PluginBundle, PluginTemplate } from "@/lib/plugins/types";

// =============================================================================
// Types
// =============================================================================

interface TemplateInfo {
  id: PluginTemplate;
  name: string;
  description: string;
  icon: string;
}

interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

interface MakerMeta {
  templates: TemplateInfo[];
  tools: ToolInfo[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  bundle?: PluginBundle;
  error?: string;
}

type MakerMode = "form" | "chat";

interface PluginMakerProps {
  onSave: (bundle: PluginBundle) => Promise<void>;
  onCancel: () => void;
  initialBundle?: PluginBundle;
}

// =============================================================================
// Icons
// =============================================================================

const icons: Record<string, React.ReactNode> = {
  radio: <Radio />,
  list: <List />,
  "layout-grid": <LayoutGrid />,
  table: <Table />,
  "file-text": <FileText />,
  "square-pen": <SquarePen />,
  sparkles: <Sparkles />,
  send: <Send />,
  check: <Check />,
  x: <X />,
  loader: <Loader />,
  wand: <Wand2 />,
  message: <MessageSquare />,
};

// =============================================================================
// Component
// =============================================================================

/**
 * PluginMaker - UI for creating plugins via form or AI chat
 * 
 * Modes:
 * - Form: Pick template, configure options, generate bundle
 * - Chat: Describe what you want, AI generates the bundle
 */
export function PluginMaker({ onSave, onCancel, initialBundle }: PluginMakerProps) {
  // Mode state
  const [mode, setMode] = useState<MakerMode>("chat");
  
  // Meta state (templates and tools from API)
  const [meta, setMeta] = useState<MakerMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  
  // Form mode state
  const [selectedTemplate, setSelectedTemplate] = useState<PluginTemplate | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  
  // Chat mode state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Generated bundle state
  const [bundle, setBundle] = useState<PluginBundle | null>(initialBundle ?? null);
  const [saving, setSaving] = useState(false);
  
  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // =============================================================================
  // Load meta (templates and tools)
  // =============================================================================
  
  useEffect(() => {
    async function loadMeta() {
      try {
        const res = await fetch("/api/plugins/maker");
        if (!res.ok) throw new Error("Failed to load maker metadata");
        const data = await res.json();
        setMeta(data);
      } catch (error) {
        console.error("Failed to load maker meta:", error);
        // Fallback to defaults
        setMeta({
          templates: [
            { id: "ticker", name: "Ticker", description: "Rotating single-line items", icon: "radio" },
            { id: "feed", name: "Feed", description: "Scrollable list with images", icon: "list" },
            { id: "cards", name: "Cards", description: "Visual cards in grid layout", icon: "layout-grid" },
            { id: "table", name: "Table", description: "Sortable data grid", icon: "table" },
            { id: "kv", name: "Key-Value", description: "Labeled pairs display", icon: "file-text" },
            { id: "form", name: "Form", description: "Input form with action", icon: "square-pen" },
          ],
          tools: [],
        });
      } finally {
        setMetaLoading(false);
      }
    }
    loadMeta();
  }, []);
  
  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  
  // =============================================================================
  // Chat generation
  // =============================================================================
  
  const generateFromChat = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || isGenerating) return;
    
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsGenerating(true);
    
    try {
      // Determine if this is a refinement (we have an existing bundle and messages)
      const isRefinement = bundle && messages.length > 0;
      
      let res: Response;
      
      if (isRefinement) {
        // Refinement request
        res = await fetch("/api/plugins/maker?action=refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bundle,
            feedback: userMessage,
          }),
        });
      } else {
        // New generation
        res = await fetch("/api/plugins/maker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: userMessage,
          }),
        });
      }
      
      const data = await res.json();
      
      if (!res.ok || !data.bundle) {
        throw new Error(data.error || "Generation failed");
      }
      
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: `Created plugin: **${data.bundle.manifest.name}**\n\nUsing template: \`${data.bundle.template}\`\n\nTools: ${data.bundle.sources.map((s: { tool: string }) => `\`${s.tool}\``).join(", ")}`,
        bundle: data.bundle,
      };
      
      setMessages(prev => [...prev, assistantMsg]);
      setBundle(data.bundle);
      
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I couldn't generate the plugin.",
        error: error instanceof Error ? error.message : "Unknown error",
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [bundle, messages, isGenerating]);
  
  const handleSend = useCallback(() => {
    generateFromChat(input);
  }, [input, generateFromChat]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  
  // =============================================================================
  // Form generation
  // =============================================================================
  
  const generateFromForm = useCallback(async () => {
    if (!selectedTemplate || !formName.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    try {
      const res = await fetch("/api/plugins/maker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formDescription || `A ${selectedTemplate} plugin called "${formName}"`,
          template: selectedTemplate,
          hints: {
            name: formName,
            description: formDescription,
          },
        }),
      });
      
      const data = await res.json();
      
      if (!res.ok || !data.bundle) {
        throw new Error(data.error || "Generation failed");
      }
      
      setBundle(data.bundle);
      
      // Switch to chat mode with the generated bundle
      setMode("chat");
      setMessages([
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Created plugin: **${data.bundle.manifest.name}**\n\nI generated a ${selectedTemplate} widget based on your description. You can refine it by telling me what changes you'd like.`,
          bundle: data.bundle,
        },
      ]);
      
    } catch (error) {
      console.error("Form generation failed:", error);
      alert(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedTemplate, formName, formDescription, isGenerating]);
  
  // =============================================================================
  // Save plugin
  // =============================================================================
  
  const handleSave = useCallback(async () => {
    if (!bundle || saving) return;
    
    setSaving(true);
    try {
      await onSave(bundle);
    } catch (error) {
      console.error("Save failed:", error);
      alert(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [bundle, saving, onSave]);
  
  // =============================================================================
  // Render
  // =============================================================================
  
  if (metaLoading) {
    return (
      <div className="maker-container">
        <div className="maker-loading">
          <span className="maker-icon maker-icon-spin">{icons.loader}</span>
          <span>Loading...</span>
        </div>
      </div>
    );
  }
  
  return (
    <div className="maker-container">
      {/* Header */}
      <div className="maker-header">
        <div className="maker-title">
          <span className="maker-icon">{icons.wand}</span>
          <span>Plugin Maker</span>
        </div>
        <div className="maker-mode-switch">
          <button
            className={`maker-mode-btn ${mode === "form" ? "active" : ""}`}
            onClick={() => setMode("form")}
          >
            <span className="maker-icon">{icons["square-pen"]}</span>
            Form
          </button>
          <button
            className={`maker-mode-btn ${mode === "chat" ? "active" : ""}`}
            onClick={() => setMode("chat")}
          >
            <span className="maker-icon">{icons.message}</span>
            Chat
          </button>
        </div>
        <button className="maker-close" onClick={onCancel}>
          {icons.x}
        </button>
      </div>
      
      {/* Content */}
      <div className="maker-content">
        {mode === "form" ? (
          /* Form Mode */
          <div className="maker-form">
            {/* Template Selection */}
            <div className="maker-section">
              <label className="maker-label">Template</label>
              <div className="maker-templates">
                {meta?.templates.map((t) => (
                  <button
                    key={t.id}
                    className={`maker-template-btn ${selectedTemplate === t.id ? "selected" : ""}`}
                    onClick={() => setSelectedTemplate(t.id)}
                  >
                    <span className="maker-icon">{icons[t.icon] || icons.sparkles}</span>
                    <span className="maker-template-name">{t.name}</span>
                    <span className="maker-template-desc">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Name */}
            <div className="maker-section">
              <label className="maker-label" htmlFor="maker-name">Name</label>
              <input
                id="maker-name"
                type="text"
                className="maker-input"
                placeholder="My Plugin"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            
            {/* Description */}
            <div className="maker-section">
              <label className="maker-label" htmlFor="maker-desc">Description</label>
              <textarea
                id="maker-desc"
                className="maker-textarea"
                placeholder="What should this plugin do? e.g., Show live scores for my favorite team"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            
            {/* Generate Button */}
            <button
              className="maker-btn maker-btn-primary"
              onClick={generateFromForm}
              disabled={!selectedTemplate || !formName.trim() || isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="maker-icon maker-icon-spin">{icons.loader}</span>
                  Generating...
                </>
              ) : (
                <>
                  <span className="maker-icon">{icons.sparkles}</span>
                  Generate Plugin
                </>
              )}
            </button>
          </div>
        ) : (
          /* Chat Mode */
          <div className="maker-chat">
            {/* Messages */}
            <div className="maker-messages">
              {messages.length === 0 && (
                <div className="maker-chat-empty">
                  <span className="maker-icon">{icons.sparkles}</span>
                  <span>Describe the plugin you want to create</span>
                  <span className="maker-chat-hint">
                    e.g., "A ticker showing Arsenal match scores" or "A feed of tech news from Hacker News"
                  </span>
                </div>
              )}
              
              {messages.map((msg) => (
                <div key={msg.id} className={`maker-message maker-message-${msg.role}`}>
                  <div className="maker-message-content">
                    {msg.content}
                  </div>
                  {msg.error && (
                    <div className="maker-message-error">
                      {msg.error}
                    </div>
                  )}
                  {msg.bundle && (
                    <div className="maker-message-bundle">
                      <div className="maker-bundle-preview">
                        <span className="maker-bundle-icon">{icons[msg.bundle.manifest.icon || "sparkles"]}</span>
                        <span className="maker-bundle-name">{msg.bundle.manifest.name}</span>
                        <span className="maker-bundle-template">{msg.bundle.template}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {isGenerating && (
                <div className="maker-message maker-message-assistant maker-message-loading">
                  <span className="maker-icon maker-icon-spin">{icons.loader}</span>
                  <span>Generating plugin...</span>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>
            
            {/* Input */}
            <div className="maker-input-container">
              <textarea
                ref={inputRef}
                className="maker-chat-input"
                placeholder={bundle ? "Describe changes..." : "Describe the plugin you want..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
              />
              <button
                className="maker-send-btn"
                onClick={handleSend}
                disabled={!input.trim() || isGenerating}
              >
                {icons.send}
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer with bundle preview and save */}
      {bundle && (
        <div className="maker-footer">
          <div className="maker-bundle-summary">
            <span className="maker-icon">{icons[bundle.manifest.icon || "sparkles"]}</span>
            <div className="maker-bundle-info">
              <span className="maker-bundle-title">{bundle.manifest.name}</span>
              <span className="maker-bundle-meta">
                {bundle.template} | {bundle.sources.length} source{bundle.sources.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="maker-actions">
            <button
              className="maker-btn maker-btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="maker-btn maker-btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span className="maker-icon maker-icon-spin">{icons.loader}</span>
                  Saving...
                </>
              ) : (
                <>
                  <span className="maker-icon">{icons.check}</span>
                  Save Plugin
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
