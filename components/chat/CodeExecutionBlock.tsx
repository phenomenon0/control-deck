"use client";

/**
 * CodeExecutionBlock - Displays code execution results with Canvas
 * Shows: code, output, preview (for React/HTML/Three.js), and images
 */

import { useState } from "react";
import { Canvas } from "../canvas/Canvas";

export interface CodeExecutionData {
  language: string;
  code: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  preview?: {
    html?: string;
    bundled?: string;
  };
  images?: Array<{
    name: string;
    mimeType: string;
    data: string;
  }>;
}

interface CodeExecutionBlockProps {
  data: CodeExecutionData;
  /** Optional: callback to re-run with modified code */
  onRerun?: (code: string) => void;
}

export function CodeExecutionBlock({ data, onRerun }: CodeExecutionBlockProps) {
  const [isRerunning, setIsRerunning] = useState(false);
  const [modifiedCode, setModifiedCode] = useState(data.code);

  const handleRun = async () => {
    if (!onRerun) return;
    setIsRerunning(true);
    try {
      await onRerun(modifiedCode);
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <div style={{ marginTop: 12, maxWidth: 550 }}>
      <Canvas
        code={data.code}
        language={data.language}
        stdout={data.stdout}
        stderr={data.stderr}
        exitCode={data.exitCode}
        durationMs={data.durationMs}
        preview={data.preview}
        images={data.images}
        isRunning={isRerunning}
        onCodeChange={onRerun ? setModifiedCode : undefined}
        onRun={onRerun ? handleRun : undefined}
        className="h-[300px]"
      />
    </div>
  );
}

export default CodeExecutionBlock;
