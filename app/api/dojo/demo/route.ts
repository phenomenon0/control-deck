/**
 * AG-UI Dojo Demo API
 * Runs demo scenarios with simulated/real Ollama responses
 */

import { NextRequest, NextResponse } from "next/server";
import { emitDojoEvent } from "../stream/route";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

type DemoType = 
  | "shared_state"
  | "tool_calling"
  | "generative_ui"
  | "reasoning"
  | "interrupt"
  | "activity"
  | "multimodal"
  | "meta_events"
  | "poetry"
  | "travel"
  | "research"
  | "approval"
  | "form";

interface DemoRequest {
  threadId: string;
  demo: DemoType;
  model?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: DemoRequest = await request.json();
    const { threadId, demo, model = "llama3.2", input = {} } = body;
    
    const runId = crypto.randomUUID();
    
    // Emit run started
    emitDojoEvent(threadId, {
      type: "RUN_STARTED",
      threadId,
      runId,
      timestamp: new Date().toISOString(),
    });
    
    // Run the demo
    switch (demo) {
      case "shared_state":
        await runSharedStateDemo(threadId, runId);
        break;
      
      case "tool_calling":
        await runToolCallingDemo(threadId, runId, model);
        break;
      
      case "generative_ui":
        await runGenerativeUIDemo(threadId, runId, model, input);
        break;
      
      case "reasoning":
        await runReasoningDemo(threadId, runId, model, input);
        break;
      
      case "interrupt":
        await runInterruptDemo(threadId, runId);
        break;
      
      case "activity":
        await runActivityDemo(threadId, runId);
        break;
      
      case "multimodal":
        await runMultimodalDemo(threadId, runId);
        break;
      
      case "meta_events":
        await runMetaEventsDemo(threadId, runId);
        break;
      
      case "poetry":
        await runPoetryDemo(threadId, runId, model, input);
        break;
      
      case "travel":
        await runTravelDemo(threadId, runId, model, input);
        break;
      
      case "research":
        await runResearchDemo(threadId, runId, model, input);
        break;
      
      case "approval":
        await runApprovalDemo(threadId, runId);
        break;
      
      case "form":
        await runFormDemo(threadId, runId, model, input);
        break;
      
      default:
        throw new Error(`Unknown demo: ${demo}`);
    }
    
    // Emit run finished
    emitDojoEvent(threadId, {
      type: "RUN_FINISHED",
      threadId,
      runId,
      timestamp: new Date().toISOString(),
      outcome: "success",
    });
    
    return NextResponse.json({ success: true, runId });
  } catch (error) {
    console.error("[Dojo Demo] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// =============================================================================
// Demo Implementations
// =============================================================================

async function runSharedStateDemo(threadId: string, runId: string) {
  // Initial state
  emitDojoEvent(threadId, {
    type: "STATE_SNAPSHOT",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    snapshot: {
      counter: 0,
      items: [],
      user: { name: "Demo User", theme: "dark" },
    },
  });
  
  await delay(500);
  
  // Increment counter
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [{ op: "replace", path: "/counter", value: 1 }],
  });
  
  await delay(300);
  
  // Add item
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [{ op: "add", path: "/items/-", value: { id: "1", text: "First item" } }],
  });
  
  await delay(300);
  
  // Add another item
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/counter", value: 2 },
      { op: "add", path: "/items/-", value: { id: "2", text: "Second item" } },
    ],
  });
}

async function runToolCallingDemo(threadId: string, runId: string, model: string) {
  const toolCallId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  
  // Start message
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  // Stream content
  const content = "Let me search for that information...";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(30);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(200);
  
  // Tool call
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_START",
    threadId,
    runId,
    toolCallId,
    toolCallName: "web_search",
    parentMessageId: messageId,
    timestamp: new Date().toISOString(),
  });
  
  // Stream args
  const args = '{"query": "AG-UI protocol"}';
  for (const char of args) {
    emitDojoEvent(threadId, {
      type: "TOOL_CALL_ARGS",
      threadId,
      runId,
      toolCallId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_END",
    threadId,
    runId,
    toolCallId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Tool result
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_RESULT",
    threadId,
    runId,
    toolCallId,
    messageId: crypto.randomUUID(),
    content: JSON.stringify({
      results: [
        { title: "AG-UI Protocol", url: "https://ag-ui.com" },
        { title: "AG-UI Docs", url: "https://docs.ag-ui.com" },
      ],
    }),
    role: "tool",
    timestamp: new Date().toISOString(),
  });
}

async function runGenerativeUIDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const messageId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "I'll generate a form for you...";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  // Emit generated UI as custom event
  emitDojoEvent(threadId, {
    type: "CUSTOM",
    threadId,
    runId,
    name: "generative_ui",
    value: {
      jsonSchema: {
        type: "object",
        title: "Contact Form",
        properties: {
          name: { type: "string", title: "Name" },
          email: { type: "string", title: "Email", format: "email" },
          message: { type: "string", title: "Message" },
        },
        required: ["name", "email"],
      },
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          { type: "Control", scope: "#/properties/name" },
          { type: "Control", scope: "#/properties/email" },
          { type: "Control", scope: "#/properties/message", options: { multi: true } },
        ],
      },
      initialData: input,
    },
    timestamp: new Date().toISOString(),
  });
}

async function runReasoningDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const reasoningId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  
  // Start reasoning
  emitDojoEvent(threadId, {
    type: "REASONING_START",
    threadId,
    messageId: reasoningId,
    timestamp: new Date().toISOString(),
  });
  
  // Reasoning content
  emitDojoEvent(threadId, {
    type: "REASONING_MESSAGE_START",
    threadId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const reasoning = "Let me think about this step by step...\n1. First, I need to understand the question\n2. Then analyze the context\n3. Finally formulate a response";
  for (const char of reasoning) {
    emitDojoEvent(threadId, {
      type: "REASONING_MESSAGE_CONTENT",
      threadId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "REASONING_MESSAGE_END",
    threadId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  emitDojoEvent(threadId, {
    type: "REASONING_END",
    threadId,
    messageId: reasoningId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  // Final response
  const responseId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId: responseId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const response = "Based on my analysis, here's my response...";
  for (const char of response) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId: responseId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(30);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId: responseId,
    timestamp: new Date().toISOString(),
  });
}

async function runInterruptDemo(threadId: string, runId: string) {
  const messageId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "I need your approval to proceed with this action...";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  // Emit interrupt (via modified RUN_FINISHED)
  emitDojoEvent(threadId, {
    type: "RUN_FINISHED",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    outcome: "interrupt",
    interrupt: {
      id: crypto.randomUUID(),
      reason: "human_approval",
      payload: {
        action: "Delete all files",
        riskLevel: "critical",
        message: "This action cannot be undone. Do you want to proceed?",
      },
    },
  });
}

async function runActivityDemo(threadId: string, runId: string) {
  const activityId = crypto.randomUUID();
  
  // Plan activity
  emitDojoEvent(threadId, {
    type: "ACTIVITY_SNAPSHOT",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    content: {
      title: "Research Task",
      steps: [
        { id: "1", label: "Search for information", status: "in_progress" },
        { id: "2", label: "Analyze results", status: "pending" },
        { id: "3", label: "Generate summary", status: "pending" },
      ],
    },
    replace: true,
    timestamp: new Date().toISOString(),
  });
  
  await delay(1000);
  
  // Update step 1 complete
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/0/status", value: "completed" },
      { op: "replace", path: "/steps/1/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(1000);
  
  // Update step 2 complete
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/1/status", value: "completed" },
      { op: "replace", path: "/steps/2/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(1000);
  
  // All complete
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [{ op: "replace", path: "/steps/2/status", value: "completed" }],
    timestamp: new Date().toISOString(),
  });
}

async function runMultimodalDemo(threadId: string, runId: string) {
  const messageId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "I can see the image you uploaded. It appears to be a diagram showing the AG-UI architecture...";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
}

async function runMetaEventsDemo(threadId: string, runId: string) {
  const messageId = crypto.randomUUID();
  
  // Send a message first
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "Here's my response. Please rate it!";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Send meta events
  emitDojoEvent(threadId, {
    type: "META",
    threadId,
    metaType: "thumbs_up",
    payload: { messageId, userId: "demo_user" },
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  emitDojoEvent(threadId, {
    type: "META",
    threadId,
    metaType: "tag",
    payload: { tags: ["helpful", "accurate"], targetId: messageId },
    timestamp: new Date().toISOString(),
  });
}

async function runPoetryDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const topic = (input.topic as string) || "the beauty of code";
  const messageId = crypto.randomUUID();
  
  // Try to call Ollama for real poetry
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `Write a short, beautiful poem about: ${topic}. Make it 4-6 lines.`,
        stream: true,
      }),
    });
    
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_START",
      threadId,
      runId,
      messageId,
      role: "assistant",
      timestamp: new Date().toISOString(),
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(Boolean);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.response) {
            emitDojoEvent(threadId, {
              type: "TEXT_MESSAGE_CONTENT",
              threadId,
              runId,
              messageId,
              delta: data.response,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {}
      }
    }
    
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_END",
      threadId,
      runId,
      messageId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Fallback to simulated poetry
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_START",
      threadId,
      runId,
      messageId,
      role: "assistant",
      timestamp: new Date().toISOString(),
    });
    
    const poem = `In silicon dreams we write our art,
Lines of logic, beating heart.
Each function crafted with such care,
A digital dance beyond compare.`;
    
    for (const char of poem) {
      emitDojoEvent(threadId, {
        type: "TEXT_MESSAGE_CONTENT",
        threadId,
        runId,
        messageId,
        delta: char,
        timestamp: new Date().toISOString(),
      });
      await delay(30);
    }
    
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_END",
      threadId,
      runId,
      messageId,
      timestamp: new Date().toISOString(),
    });
  }
}

async function runTravelDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  // Show activity for planning
  const activityId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_SNAPSHOT",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    content: {
      title: "Planning Your Trip",
      steps: [
        { id: "1", label: "Analyzing preferences", status: "in_progress" },
        { id: "2", label: "Finding destinations", status: "pending" },
        { id: "3", label: "Creating itinerary", status: "pending" },
      ],
    },
    replace: true,
    timestamp: new Date().toISOString(),
  });
  
  await delay(800);
  
  // Step 1 complete
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/0/status", value: "completed" },
      { op: "replace", path: "/steps/1/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(800);
  
  // Step 2 complete
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/1/status", value: "completed" },
      { op: "replace", path: "/steps/2/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Generate form for trip details
  emitDojoEvent(threadId, {
    type: "CUSTOM",
    threadId,
    runId,
    name: "generative_ui",
    value: {
      jsonSchema: {
        type: "object",
        title: "Trip Details",
        properties: {
          destination: { type: "string", title: "Destination" },
          startDate: { type: "string", title: "Start Date", format: "date" },
          endDate: { type: "string", title: "End Date", format: "date" },
          travelers: { type: "number", title: "Number of Travelers" },
          budget: { type: "string", title: "Budget", enum: ["Budget", "Moderate", "Luxury"] },
        },
        required: ["destination", "startDate", "endDate"],
      },
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          { type: "Control", scope: "#/properties/destination" },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/startDate" },
              { type: "Control", scope: "#/properties/endDate" },
            ],
          },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/travelers" },
              { type: "Control", scope: "#/properties/budget" },
            ],
          },
        ],
      },
      initialData: input,
    },
    timestamp: new Date().toISOString(),
  });
  
  // Complete planning
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [{ op: "replace", path: "/steps/2/status", value: "completed" }],
    timestamp: new Date().toISOString(),
  });
}

async function runResearchDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const topic = (input.topic as string) || "artificial intelligence";
  
  // Reasoning phase
  const reasoningId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "REASONING_START",
    threadId,
    messageId: reasoningId,
    timestamp: new Date().toISOString(),
  });
  
  const msgId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "REASONING_MESSAGE_START",
    threadId,
    messageId: msgId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const reasoning = `Researching: ${topic}\n1. Identifying key concepts\n2. Finding reliable sources\n3. Synthesizing information`;
  for (const char of reasoning) {
    emitDojoEvent(threadId, {
      type: "REASONING_MESSAGE_CONTENT",
      threadId,
      messageId: msgId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(15);
  }
  
  emitDojoEvent(threadId, {
    type: "REASONING_MESSAGE_END",
    threadId,
    messageId: msgId,
    timestamp: new Date().toISOString(),
  });
  
  emitDojoEvent(threadId, {
    type: "REASONING_END",
    threadId,
    messageId: reasoningId,
    timestamp: new Date().toISOString(),
  });
  
  // Tool call for search
  const toolCallId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_START",
    threadId,
    runId,
    toolCallId,
    toolCallName: "web_search",
    timestamp: new Date().toISOString(),
  });
  
  const args = JSON.stringify({ query: topic, maxResults: 5 });
  for (const char of args) {
    emitDojoEvent(threadId, {
      type: "TOOL_CALL_ARGS",
      threadId,
      runId,
      toolCallId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(10);
  }
  
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_END",
    threadId,
    runId,
    toolCallId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  emitDojoEvent(threadId, {
    type: "TOOL_CALL_RESULT",
    threadId,
    runId,
    toolCallId,
    messageId: crypto.randomUUID(),
    content: JSON.stringify({
      results: [
        { title: `Understanding ${topic}`, snippet: "A comprehensive overview..." },
        { title: `${topic} in Practice`, snippet: "Real-world applications..." },
        { title: `Future of ${topic}`, snippet: "Emerging trends..." },
      ],
    }),
    role: "tool",
    timestamp: new Date().toISOString(),
  });
  
  // Final response
  const responseId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId: responseId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const response = `Based on my research about ${topic}, here are the key findings:\n\n1. **Core Concepts**: The field encompasses...\n2. **Applications**: Used extensively in...\n3. **Future Outlook**: Expected to grow...`;
  for (const char of response) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId: responseId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(15);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId: responseId,
    timestamp: new Date().toISOString(),
  });
}

async function runApprovalDemo(threadId: string, runId: string) {
  const messageId = crypto.randomUUID();
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "I'm about to perform a sensitive operation that requires your approval.";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Interrupt for approval
  emitDojoEvent(threadId, {
    type: "RUN_FINISHED",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    outcome: "interrupt",
    interrupt: {
      id: crypto.randomUUID(),
      reason: "human_approval",
      payload: {
        proposal: {
          tool: "sendEmail",
          args: {
            to: "user@example.com",
            subject: "Important Update",
            body: "This is the email content...",
          },
        },
        message: "Do you approve sending this email?",
        riskLevel: "medium",
      },
    },
  });
}

async function runFormDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const description = (input.description as string) || "A contact form with name, email, and message";
  
  // Generate UI
  emitDojoEvent(threadId, {
    type: "CUSTOM",
    threadId,
    runId,
    name: "generative_ui",
    value: {
      jsonSchema: {
        type: "object",
        title: "Generated Form",
        properties: {
          name: { type: "string", title: "Full Name" },
          email: { type: "string", title: "Email Address", format: "email" },
          phone: { type: "string", title: "Phone Number" },
          message: { type: "string", title: "Your Message" },
          newsletter: { type: "boolean", title: "Subscribe to newsletter" },
        },
        required: ["name", "email", "message"],
      },
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          {
            type: "Group",
            label: "Personal Information",
            elements: [
              { type: "Control", scope: "#/properties/name" },
              { type: "Control", scope: "#/properties/email" },
              { type: "Control", scope: "#/properties/phone" },
            ],
          },
          {
            type: "Group",
            label: "Message",
            elements: [
              { type: "Control", scope: "#/properties/message", options: { multi: true } },
              { type: "Control", scope: "#/properties/newsletter" },
            ],
          },
        ],
      },
      initialData: {},
    },
    timestamp: new Date().toISOString(),
  });
  
  const messageId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = "I've generated a form based on your description. Please fill it out above.";
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(20);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
