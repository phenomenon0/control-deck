"use client";

import { useState } from "react";

interface ReferenceUploaderProps {
  voiceAssetId: string;
  onUploaded: () => Promise<void> | void;
}

export function ReferenceUploader({ voiceAssetId, onUploaded }: ReferenceUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [speakerName, setSpeakerName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !voiceAssetId) return;
    setBusy(true);
    setError(null);
    try {
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      uploadForm.append("threadId", "voice-studio");
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: uploadForm,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      const refRes = await fetch(`/api/voice/library/${voiceAssetId}/references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: uploadData.id,
          transcript: transcript || null,
          speakerName: speakerName || null,
          sourceType: "upload",
        }),
      });
      const refData = await refRes.json();
      if (!refRes.ok) throw new Error(refData.error || "Reference save failed");

      setFile(null);
      setSpeakerName("");
      setTranscript("");
      await onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-4" onSubmit={handleSubmit}>
      <div>
        <div className="label">Reference audio</div>
        <h3 className="text-sm font-medium text-[var(--text-primary)]">Attach a source clip</h3>
      </div>

      <input
        className="input"
        type="file"
        accept="audio/wav,audio/mp3,audio/mpeg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <input
        className="input"
        value={speakerName}
        onChange={(e) => setSpeakerName(e.target.value)}
        placeholder="Speaker / persona name"
      />

      <textarea
        className="input min-h-24 resize-y"
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Optional transcript for this reference clip"
      />

      {error ? <div className="text-xs text-[var(--error)]">{error}</div> : null}

      <button type="submit" className="btn btn-secondary" disabled={busy || !file || !voiceAssetId}>
        {busy ? "Uploading…" : "Add reference"}
      </button>
    </form>
  );
}
