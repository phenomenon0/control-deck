"use client";

import { useState } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import { truncate } from "@/lib/utils";

interface ImageResultCardProps {
  tool: ToolCallData;
}

export function ImageResultCard({ tool }: ImageResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Extract image data from tool
  const prompt = tool.args?.prompt as string || "";
  const artifact = tool.artifacts?.[0];
  const data = tool.result?.data as Record<string, unknown> | undefined;
  const imageUrl: string | undefined = artifact?.url || data?.url as string | undefined;
  const width = data?.width as number | undefined;
  const height = data?.height as number | undefined;
  const model = data?.model as string || "SDXL";

  if (!imageUrl) {
    return (
      <div className="result-card image-card">
        <div className="result-card-header">
          <span className="result-icon">🎨</span>
          <span className="result-title">{tool.name === "edit_image" ? "edit image" : "generate image"}</span>
          <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
        </div>
        <div className="result-card-body">
          <div className="image-prompt">{prompt}</div>
          <div className="empty-hint">Image generation in progress...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="result-card image-card">
        <div className="result-card-header">
          <span className="result-icon">🎨</span>
          <span className="result-title">{tool.name === "edit_image" ? "edit image" : "generate image"}</span>
          <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
        </div>

        <div className="result-card-body">
          <div className="image-prompt">{truncate(prompt, 80)}</div>

          {/* Thumbnail */}
          <div className="image-thumbnail-container">
            <button className="image-thumbnail" onClick={() => setExpanded(true)}>
              {!imageLoaded && <div className="image-skeleton" />}
              <img
                src={imageUrl}
                alt={prompt}
                onLoad={() => setImageLoaded(true)}
                style={{ opacity: imageLoaded ? 1 : 0 }}
              />
              <div className="image-overlay">
                <span>⤢ Expand</span>
              </div>
            </button>
          </div>

          {/* Metadata */}
          <div className="image-meta">
            {width && height && <span>{width}×{height}</span>}
            <span>{model}</span>
            <span>{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
          </div>

          {/* Actions */}
          <div className="result-card-actions">
            <button className="action-btn" onClick={() => setExpanded(true)}>
              ⤢ Expand
            </button>
            <a
              href={imageUrl}
              download={`generated-${Date.now()}.png`}
              className="action-btn"
              onClick={(e) => e.stopPropagation()}
            >
              ⬇ Download
            </a>
            <button
              className="action-btn"
              onClick={() => navigator.clipboard.writeText(prompt)}
              title="Copy prompt"
            >
              📋 Prompt
            </button>
          </div>
        </div>
      </div>

      {/* Full-size Modal */}
      {expanded && (
        <div className="image-modal-overlay" onClick={() => setExpanded(false)}>
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <span className="image-modal-title">Generated Image</span>
              <button className="image-modal-close" onClick={() => setExpanded(false)}>×</button>
            </div>
            <div className="image-modal-content">
              <img src={imageUrl} alt={prompt} />
            </div>
            <div className="image-modal-footer">
              <div className="image-modal-prompt">{prompt}</div>
              <div className="image-modal-meta">
                {width && height && <span>{width}×{height}</span>}
                <span>{model}</span>
              </div>
              <div className="image-modal-actions">
                <a
                  href={imageUrl}
                  download={`generated-${Date.now()}.png`}
                  className="action-btn primary"
                >
                  ⬇ Download
                </a>
                <button
                  className="action-btn"
                  onClick={() => navigator.clipboard.writeText(prompt)}
                >
                  📋 Copy Prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

