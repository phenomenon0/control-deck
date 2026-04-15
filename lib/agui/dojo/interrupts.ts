/**
 * AG-UI Interrupts System (Draft)
 * Human-in-the-loop pause/resume workflows
 */

import type {
  RunFinishedEvent,
  InterruptRequest,
  InterruptResponse,
} from "./types";

export type InterruptReason =
  | "human_approval"
  | "user_input_required"
  | "policy_hold"
  | "confirmation_needed"
  | "error_recovery"
  | "multi_step_wizard"
  | string;

export interface InterruptPayload {
  /** What the agent wants to do */
  proposal?: {
    tool?: string;
    action?: string;
    args?: Record<string, unknown>;
  };
  /** Form fields for user input */
  form?: {
    fields: Array<{
      name: string;
      label: string;
      type: "text" | "number" | "email" | "select" | "checkbox" | "textarea";
      required?: boolean;
      options?: string[];
      defaultValue?: unknown;
    }>;
  };
  /** Display message */
  message?: string;
  /** Risk/importance level */
  riskLevel?: "low" | "medium" | "high" | "critical";
  /** Context for the user */
  context?: Record<string, unknown>;
}

export interface InterruptResolution {
  interruptId: string;
  approved?: boolean;
  rejected?: boolean;
  modified?: boolean;
  data?: Record<string, unknown>;
  comment?: string;
}

export type InterruptStatus =
  | "pending"     // Waiting for user
  | "approved"    // User approved
  | "rejected"    // User rejected
  | "modified"    // User modified and approved
  | "timeout"     // Timed out
  | "cancelled";  // Cancelled

export interface InterruptState {
  id: string;
  threadId: string;
  runId: string;
  reason: InterruptReason;
  payload: InterruptPayload;
  status: InterruptStatus;
  resolution?: InterruptResolution;
  createdAt: number;
  resolvedAt?: number;
  timeoutMs?: number;
}

export interface InterruptStore {
  interrupts: Map<string, InterruptState>;
  pending: InterruptState | null;
  
  create(
    threadId: string,
    runId: string,
    reason: InterruptReason,
    payload: InterruptPayload,
    timeoutMs?: number
  ): InterruptState;
  
  resolve(id: string, resolution: InterruptResolution): void;
  cancel(id: string): void;
  get(id: string): InterruptState | undefined;
  getPending(): InterruptState | null;
  subscribe(listener: (store: InterruptStore) => void): () => void;
}

/**
 * Create an interrupt store
 */
export function createInterruptStore(): InterruptStore {
  const interrupts = new Map<string, InterruptState>();
  let pending: InterruptState | null = null;
  const listeners = new Set<(store: InterruptStore) => void>();
  
  const store: InterruptStore = {
    interrupts,
    get pending() { return pending; },
    
    create: (threadId, runId, reason, payload, timeoutMs) => {
      const id = crypto.randomUUID();
      const interrupt: InterruptState = {
        id,
        threadId,
        runId,
        reason,
        payload,
        status: "pending",
        createdAt: Date.now(),
        timeoutMs,
      };
      
      interrupts.set(id, interrupt);
      pending = interrupt;
      notify();
      
      // Set up timeout if specified
      if (timeoutMs) {
        setTimeout(() => {
          const current = interrupts.get(id);
          if (current && current.status === "pending") {
            current.status = "timeout";
            current.resolvedAt = Date.now();
            if (pending?.id === id) {
              pending = null;
            }
            notify();
          }
        }, timeoutMs);
      }
      
      return interrupt;
    },
    
    resolve: (id, resolution) => {
      const interrupt = interrupts.get(id);
      if (!interrupt || interrupt.status !== "pending") return;
      
      interrupt.status = resolution.rejected ? "rejected" 
        : resolution.modified ? "modified" 
        : "approved";
      interrupt.resolution = resolution;
      interrupt.resolvedAt = Date.now();
      
      if (pending?.id === id) {
        pending = null;
      }
      notify();
    },
    
    cancel: (id) => {
      const interrupt = interrupts.get(id);
      if (!interrupt || interrupt.status !== "pending") return;
      
      interrupt.status = "cancelled";
      interrupt.resolvedAt = Date.now();
      
      if (pending?.id === id) {
        pending = null;
      }
      notify();
    },
    
    get: (id) => interrupts.get(id),
    
    getPending: () => pending,
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  
  function notify() {
    for (const listener of listeners) {
      listener(store);
    }
  }
  
  return store;
}

/**
 * Create a RUN_FINISHED event with interrupt
 */
export function createInterruptedRunFinished(
  threadId: string,
  runId: string,
  interrupt: InterruptRequest
): RunFinishedEvent {
  return {
    type: "RUN_FINISHED",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    outcome: "interrupt",
    interrupt,
  };
}

/**
 * Check if a RUN_FINISHED event is an interrupt
 */
export function isInterrupt(event: RunFinishedEvent): boolean {
  return event.outcome === "interrupt" && !!event.interrupt;
}

/**
 * Create a resume input for continuing after interrupt
 */
export function createResumeInput(
  interruptId: string,
  payload: unknown
): InterruptResponse {
  return { interruptId, payload };
}

/**
 * Create an approval interrupt for a sensitive action
 */
export function createApprovalInterrupt(
  action: string,
  details: Record<string, unknown>,
  riskLevel: "low" | "medium" | "high" | "critical" = "medium"
): InterruptPayload {
  return {
    proposal: { action, args: details },
    message: `Approval required for: ${action}`,
    riskLevel,
    context: details,
  };
}

/**
 * Create a user input interrupt for gathering data
 */
export function createInputInterrupt(
  message: string,
  fields: NonNullable<InterruptPayload["form"]>["fields"]
): InterruptPayload {
  return {
    message,
    form: { fields },
    riskLevel: "low",
  };
}

/**
 * Create an error recovery interrupt
 */
export function createErrorRecoveryInterrupt(
  error: string,
  options: string[]
): InterruptPayload {
  return {
    message: `Error occurred: ${error}`,
    form: {
      fields: [{
        name: "action",
        label: "How would you like to proceed?",
        type: "select",
        required: true,
        options,
      }],
    },
    riskLevel: "medium",
  };
}

export interface WizardStep {
  id: string;
  title: string;
  fields: NonNullable<InterruptPayload["form"]>["fields"];
  validation?: (data: Record<string, unknown>) => string | null;
}

export interface WizardState {
  steps: WizardStep[];
  currentStep: number;
  data: Record<string, unknown>;
  completed: boolean;
}

/**
 * Create a wizard controller
 */
export function createWizard(steps: WizardStep[]): {
  state: WizardState;
  getCurrentStep: () => WizardStep;
  next: (stepData: Record<string, unknown>) => boolean;
  previous: () => void;
  isComplete: () => boolean;
  getData: () => Record<string, unknown>;
  toInterrupt: () => InterruptPayload;
} {
  const state: WizardState = {
    steps,
    currentStep: 0,
    data: {},
    completed: false,
  };
  
  return {
    state,
    
    getCurrentStep: () => steps[state.currentStep],
    
    next: (stepData) => {
      const step = steps[state.currentStep];
      
      // Validate if validator exists
      if (step.validation) {
        const error = step.validation(stepData);
        if (error) {
          console.warn(`[Wizard] Validation failed: ${error}`);
          return false;
        }
      }
      
      // Save step data
      state.data = { ...state.data, ...stepData };
      
      // Move to next step or complete
      if (state.currentStep < steps.length - 1) {
        state.currentStep++;
      } else {
        state.completed = true;
      }
      
      return true;
    },
    
    previous: () => {
      if (state.currentStep > 0) {
        state.currentStep--;
        state.completed = false;
      }
    },
    
    isComplete: () => state.completed,
    
    getData: () => state.data,
    
    toInterrupt: () => {
      const step = steps[state.currentStep];
      return {
        message: step.title,
        form: { fields: step.fields },
        context: {
          currentStep: state.currentStep + 1,
          totalSteps: steps.length,
          stepId: step.id,
        },
      };
    },
  };
}
