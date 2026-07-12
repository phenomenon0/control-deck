"use client";

import { useCallback, useState } from "react";

import {
  BridgeClientError,
  callImageTool,
  type BridgeArtifact,
  type BridgeResult,
  type ImageToolName,
} from "./bridgeClient";

export type ImageJobStatus = "running" | "done" | "error";

export interface ImageJob {
  id: string;
  label: string;
  tool: ImageToolName;
  status: ImageJobStatus;
  startedAt: number;
  endedAt?: number;
  artifacts?: BridgeArtifact[];
  result?: BridgeResult;
  error?: string;
  recovery?: string[];
}

interface StartImageJobInput {
  tool: ImageToolName;
  args: Record<string, unknown>;
  label: string;
}

interface UseImageJobsOptions {
  onArtifacts?: (artifacts: BridgeArtifact[], result: BridgeResult) => void;
}

const MAX_JOBS = 20;

export function useImageJobs({ onArtifacts }: UseImageJobsOptions = {}) {
  const [jobs, setJobs] = useState<ImageJob[]>([]);

  const replaceJob = useCallback((next: ImageJob) => {
    setJobs((current) => current.map((job) => job.id === next.id ? next : job));
  }, []);

  const startJob = useCallback(async (input: StartImageJobInput): Promise<ImageJob> => {
    const job: ImageJob = {
      id: randomJobId(),
      label: input.label,
      tool: input.tool,
      status: "running",
      startedAt: Date.now(),
    };

    setJobs((current) => [...current, job].slice(-MAX_JOBS));

    try {
      const result = await callImageTool(input.tool, input.args);
      if (!result.success) {
        const next: ImageJob = {
          ...job,
          status: "error",
          endedAt: Date.now(),
          result,
          error: result.error ?? result.message ?? `${input.tool} failed`,
          recovery: result.recovery,
        };
        replaceJob(next);
        return next;
      }

      const artifacts = result.artifacts ?? [];
      const next: ImageJob = {
        ...job,
        status: "done",
        endedAt: Date.now(),
        result,
        artifacts,
      };
      replaceJob(next);
      if (artifacts.length > 0) onArtifacts?.(artifacts, result);
      return next;
    } catch (error) {
      const bridgeError = error instanceof BridgeClientError ? error : null;
      const result = bridgeError?.result;
      const next: ImageJob = {
        ...job,
        status: "error",
        endedAt: Date.now(),
        error: error instanceof Error ? error.message : `${input.tool} failed`,
        recovery: result?.recovery,
      };
      replaceJob(next);
      return next;
    }
  }, [onArtifacts, replaceJob]);

  const dismissJob = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  return { jobs, startJob, dismissJob };
}

function randomJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
