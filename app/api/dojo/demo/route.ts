/**
 * AG-UI Dojo Demo API
 * Runs demo scenarios with simulated/real Ollama responses
 */

import { NextRequest, NextResponse } from "next/server";
import { emitDojoEvent } from "../stream/route";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:8080/v1";

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
  | "form"
  | "soccer_scout"
  | "horoscope";

interface DemoRequest {
  threadId: string;
  demo: DemoType;
  model?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: DemoRequest = await request.json();
    const { threadId, demo, model = process.env.LLM_MODEL ?? "llama3.2", input = {} } = body;
    
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
      
      case "soccer_scout":
        await runSoccerScoutDemo(threadId, runId, model, input);
        break;
      
      case "horoscope":
        await runHoroscopeDemo(threadId, runId, model, input);
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
  
  // Try to call LLM for real poetry
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: `Write a short, beautiful poem about: ${topic}. Make it 4-6 lines.` }],
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
        const stripped = line.startsWith("data: ") ? line.slice(6) : line;
        if (!stripped || stripped === "[DONE]") continue;
        try {
          const data = JSON.parse(stripped);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            emitDojoEvent(threadId, {
              type: "TEXT_MESSAGE_CONTENT",
              threadId,
              runId,
              messageId,
              delta,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
            // Partial JSON line from SSE stream — skip
          }
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

// =============================================================================
// Soccer Scouting Report Demo
// =============================================================================

interface ScoutingReport {
  player: {
    name: string;
    age: number;
    position: string;
    currentClub: string;
    nationality: string;
    marketValue: string;
  };
  physicalAttributes: {
    height: string;
    weight: string;
    preferredFoot: string;
    pace: number;
    stamina: number;
    strength: number;
  };
  technicalSkills: {
    passing: number;
    shooting: number;
    dribbling: number;
    firstTouch: number;
    crossing: number;
    heading: number;
  };
  mentalAttributes: {
    vision: number;
    composure: number;
    leadership: number;
    workRate: number;
    positioning: number;
  };
  matchStats: {
    appearances: number;
    goals: number;
    assists: number;
    minutesPlayed: number;
  };
  scoutNotes: string[];
  recommendation: "sign" | "monitor" | "pass";
  overallRating: number;
}

async function runSoccerScoutDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const playerName = (input.player as string) || "Marcus Rashford";
  
  // Initial empty state
  const initialReport: Partial<ScoutingReport> = {
    player: {
      name: playerName,
      age: 0,
      position: "",
      currentClub: "",
      nationality: "",
      marketValue: "",
    },
    physicalAttributes: {
      height: "",
      weight: "",
      preferredFoot: "",
      pace: 0,
      stamina: 0,
      strength: 0,
    },
    technicalSkills: {
      passing: 0,
      shooting: 0,
      dribbling: 0,
      firstTouch: 0,
      crossing: 0,
      heading: 0,
    },
    mentalAttributes: {
      vision: 0,
      composure: 0,
      leadership: 0,
      workRate: 0,
      positioning: 0,
    },
    matchStats: {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutesPlayed: 0,
    },
    scoutNotes: [],
    overallRating: 0,
  };
  
  // Emit initial state snapshot
  emitDojoEvent(threadId, {
    type: "STATE_SNAPSHOT",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    snapshot: initialReport,
  });
  
  await delay(300);
  
  // Show activity - scouting in progress
  const activityId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "ACTIVITY_SNAPSHOT",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    content: {
      title: `Scouting Report: ${playerName}`,
      steps: [
        { id: "1", label: "Gathering player data", status: "in_progress" },
        { id: "2", label: "Analyzing physical attributes", status: "pending" },
        { id: "3", label: "Evaluating technical skills", status: "pending" },
        { id: "4", label: "Assessing mental attributes", status: "pending" },
        { id: "5", label: "Compiling match statistics", status: "pending" },
        { id: "6", label: "Generating recommendation", status: "pending" },
      ],
    },
    replace: true,
    timestamp: new Date().toISOString(),
  });
  
  await delay(600);
  
  // Step 1: Player basic info
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/player/age", value: 26 },
      { op: "replace", path: "/player/position", value: "Left Wing / Striker" },
      { op: "replace", path: "/player/currentClub", value: "Manchester United" },
      { op: "replace", path: "/player/nationality", value: "England" },
      { op: "replace", path: "/player/marketValue", value: "€55M" },
    ],
  });
  
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
  
  await delay(500);
  
  // Step 2: Physical attributes
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/physicalAttributes/height", value: "180 cm" },
      { op: "replace", path: "/physicalAttributes/weight", value: "70 kg" },
      { op: "replace", path: "/physicalAttributes/preferredFoot", value: "Right" },
      { op: "replace", path: "/physicalAttributes/pace", value: 89 },
      { op: "replace", path: "/physicalAttributes/stamina", value: 82 },
      { op: "replace", path: "/physicalAttributes/strength", value: 71 },
    ],
  });
  
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
  
  // Step 3: Technical skills
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/technicalSkills/passing", value: 78 },
      { op: "replace", path: "/technicalSkills/shooting", value: 84 },
      { op: "replace", path: "/technicalSkills/dribbling", value: 86 },
      { op: "replace", path: "/technicalSkills/firstTouch", value: 83 },
      { op: "replace", path: "/technicalSkills/crossing", value: 76 },
      { op: "replace", path: "/technicalSkills/heading", value: 72 },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/2/status", value: "completed" },
      { op: "replace", path: "/steps/3/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Step 4: Mental attributes
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/mentalAttributes/vision", value: 77 },
      { op: "replace", path: "/mentalAttributes/composure", value: 74 },
      { op: "replace", path: "/mentalAttributes/leadership", value: 72 },
      { op: "replace", path: "/mentalAttributes/workRate", value: 85 },
      { op: "replace", path: "/mentalAttributes/positioning", value: 81 },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/3/status", value: "completed" },
      { op: "replace", path: "/steps/4/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Step 5: Match stats
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/matchStats/appearances", value: 38 },
      { op: "replace", path: "/matchStats/goals", value: 17 },
      { op: "replace", path: "/matchStats/assists", value: 6 },
      { op: "replace", path: "/matchStats/minutesPlayed", value: 3124 },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/4/status", value: "completed" },
      { op: "replace", path: "/steps/5/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Step 6: Notes and recommendation
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "add", path: "/scoutNotes/-", value: "Explosive pace, excellent at running behind defenses" },
      { op: "add", path: "/scoutNotes/-", value: "Strong on the ball, good at drawing fouls" },
      { op: "add", path: "/scoutNotes/-", value: "Inconsistent finishing, sometimes wasteful" },
      { op: "add", path: "/scoutNotes/-", value: "High work rate on both sides of the ball" },
      { op: "add", path: "/scoutNotes/-", value: "Academy product with strong mentality" },
      { op: "replace", path: "/recommendation", value: "sign" },
      { op: "replace", path: "/overallRating", value: 82 },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/5/status", value: "completed" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  // Generate form for user input/edits
  emitDojoEvent(threadId, {
    type: "CUSTOM",
    threadId,
    runId,
    name: "generative_ui",
    value: {
      jsonSchema: {
        type: "object",
        title: "Scout Input",
        properties: {
          watchedLive: { type: "boolean", title: "Watched Live?" },
          matchDate: { type: "string", title: "Match Date", format: "date" },
          opposition: { type: "string", title: "Opposition Team" },
          personalNotes: { type: "string", title: "Personal Notes" },
          recommendedFee: { type: "string", title: "Recommended Fee" },
          priority: { type: "string", title: "Signing Priority", enum: ["High", "Medium", "Low"] },
        },
      },
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          { type: "HorizontalLayout", elements: [
            { type: "Control", scope: "#/properties/watchedLive" },
            { type: "Control", scope: "#/properties/matchDate" },
          ]},
          { type: "Control", scope: "#/properties/opposition" },
          { type: "Control", scope: "#/properties/personalNotes", options: { multi: true } },
          { type: "HorizontalLayout", elements: [
            { type: "Control", scope: "#/properties/recommendedFee" },
            { type: "Control", scope: "#/properties/priority" },
          ]},
        ],
      },
      initialData: {},
    },
    timestamp: new Date().toISOString(),
  });
  
  // Final message
  const messageId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
  });
  
  const content = `Scouting report for ${playerName} is complete. Overall rating: 82/100. Recommendation: SIGN. Add your personal observations above.`;
  for (const char of content) {
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId,
      delta: char,
      timestamp: new Date().toISOString(),
    });
    await delay(15);
  }
  
  emitDojoEvent(threadId, {
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId,
    timestamp: new Date().toISOString(),
  });
}

// =============================================================================
// Horoscope / Personality Demo
// =============================================================================

interface PersonalityProfile {
  basics: {
    name: string;
    birthDate: string;
    zodiacSign: string;
    element: string;
    rulingPlanet: string;
  };
  traits: {
    positive: string[];
    negative: string[];
    loveStyle: string;
    careerStrengths: string[];
  };
  compatibility: {
    bestMatches: string[];
    challengingMatches: string[];
    friendshipStyle: string;
  };
  currentForecast: {
    overall: string;
    love: string;
    career: string;
    health: string;
    luckyNumbers: number[];
    luckyColor: string;
  };
  personalityScore: {
    introversion: number;
    intuition: number;
    thinking: number;
    judging: number;
  };
}

const ZODIAC_DATA: Record<string, { element: string; planet: string; traits: { positive: string[]; negative: string[] } }> = {
  aries: { element: "Fire", planet: "Mars", traits: { positive: ["Courageous", "Confident", "Enthusiastic", "Optimistic"], negative: ["Impatient", "Impulsive", "Short-tempered"] } },
  taurus: { element: "Earth", planet: "Venus", traits: { positive: ["Reliable", "Patient", "Devoted", "Practical"], negative: ["Stubborn", "Possessive", "Uncompromising"] } },
  gemini: { element: "Air", planet: "Mercury", traits: { positive: ["Adaptable", "Curious", "Quick-witted", "Expressive"], negative: ["Nervous", "Inconsistent", "Indecisive"] } },
  cancer: { element: "Water", planet: "Moon", traits: { positive: ["Loyal", "Protective", "Intuitive", "Caring"], negative: ["Moody", "Suspicious", "Manipulative"] } },
  leo: { element: "Fire", planet: "Sun", traits: { positive: ["Creative", "Passionate", "Generous", "Warm-hearted"], negative: ["Arrogant", "Stubborn", "Self-centered"] } },
  virgo: { element: "Earth", planet: "Mercury", traits: { positive: ["Analytical", "Practical", "Diligent", "Modest"], negative: ["Worry-prone", "Critical", "Perfectionist"] } },
  libra: { element: "Air", planet: "Venus", traits: { positive: ["Diplomatic", "Fair-minded", "Social", "Cooperative"], negative: ["Indecisive", "Avoids confrontation", "Self-pity"] } },
  scorpio: { element: "Water", planet: "Pluto", traits: { positive: ["Resourceful", "Brave", "Passionate", "Loyal"], negative: ["Jealous", "Secretive", "Resentful"] } },
  sagittarius: { element: "Fire", planet: "Jupiter", traits: { positive: ["Generous", "Idealistic", "Adventurous", "Optimistic"], negative: ["Impatient", "Tactless", "Overconfident"] } },
  capricorn: { element: "Earth", planet: "Saturn", traits: { positive: ["Responsible", "Disciplined", "Self-controlled", "Ambitious"], negative: ["Pessimistic", "Fatalistic", "Condescending"] } },
  aquarius: { element: "Air", planet: "Uranus", traits: { positive: ["Progressive", "Original", "Independent", "Humanitarian"], negative: ["Aloof", "Unpredictable", "Stubborn"] } },
  pisces: { element: "Water", planet: "Neptune", traits: { positive: ["Compassionate", "Artistic", "Intuitive", "Gentle"], negative: ["Fearful", "Overly trusting", "Escapist"] } },
};

function getZodiacSign(month: number, day: number): string {
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return "scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return "sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return "capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return "aquarius";
  return "pisces";
}

async function runHoroscopeDemo(threadId: string, runId: string, model: string, input: Record<string, unknown>) {
  const name = (input.name as string) || "Cosmic Traveler";
  const birthDate = (input.birthDate as string) || "1990-07-15";
  
  const date = new Date(birthDate);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const sign = getZodiacSign(month, day);
  const signData = ZODIAC_DATA[sign];
  
  // Initial form for user input
  emitDojoEvent(threadId, {
    type: "CUSTOM",
    threadId,
    runId,
    name: "generative_ui",
    value: {
      jsonSchema: {
        type: "object",
        title: "Your Cosmic Profile",
        properties: {
          name: { type: "string", title: "Your Name" },
          birthDate: { type: "string", title: "Birth Date", format: "date" },
          birthTime: { type: "string", title: "Birth Time (optional)" },
          birthPlace: { type: "string", title: "Birth Place (optional)" },
          currentMood: { type: "string", title: "Current Mood", enum: ["Excited", "Calm", "Anxious", "Curious", "Hopeful"] },
          focusArea: { type: "string", title: "Focus Area", enum: ["Love", "Career", "Health", "Finances", "Personal Growth"] },
        },
        required: ["name", "birthDate"],
      },
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          { type: "HorizontalLayout", elements: [
            { type: "Control", scope: "#/properties/name" },
            { type: "Control", scope: "#/properties/birthDate" },
          ]},
          { type: "HorizontalLayout", elements: [
            { type: "Control", scope: "#/properties/birthTime" },
            { type: "Control", scope: "#/properties/birthPlace" },
          ]},
          { type: "HorizontalLayout", elements: [
            { type: "Control", scope: "#/properties/currentMood" },
            { type: "Control", scope: "#/properties/focusArea" },
          ]},
        ],
      },
      initialData: { name, birthDate },
    },
    timestamp: new Date().toISOString(),
  });
  
  await delay(500);
  
  // Initial state
  const initialProfile: Partial<PersonalityProfile> = {
    basics: {
      name,
      birthDate,
      zodiacSign: "",
      element: "",
      rulingPlanet: "",
    },
    traits: {
      positive: [],
      negative: [],
      loveStyle: "",
      careerStrengths: [],
    },
    compatibility: {
      bestMatches: [],
      challengingMatches: [],
      friendshipStyle: "",
    },
    currentForecast: {
      overall: "",
      love: "",
      career: "",
      health: "",
      luckyNumbers: [],
      luckyColor: "",
    },
    personalityScore: {
      introversion: 0,
      intuition: 0,
      thinking: 0,
      judging: 0,
    },
  };
  
  emitDojoEvent(threadId, {
    type: "STATE_SNAPSHOT",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    snapshot: initialProfile,
  });
  
  // Activity tracking
  const activityId = crypto.randomUUID();
  emitDojoEvent(threadId, {
    type: "ACTIVITY_SNAPSHOT",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    content: {
      title: "Reading the Stars...",
      steps: [
        { id: "1", label: "Calculating zodiac sign", status: "in_progress" },
        { id: "2", label: "Analyzing personality traits", status: "pending" },
        { id: "3", label: "Determining compatibility", status: "pending" },
        { id: "4", label: "Generating daily forecast", status: "pending" },
        { id: "5", label: "Computing personality matrix", status: "pending" },
      ],
    },
    replace: true,
    timestamp: new Date().toISOString(),
  });
  
  await delay(400);
  
  // Step 1: Zodiac basics
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/basics/zodiacSign", value: sign.charAt(0).toUpperCase() + sign.slice(1) },
      { op: "replace", path: "/basics/element", value: signData.element },
      { op: "replace", path: "/basics/rulingPlanet", value: signData.planet },
    ],
  });
  
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
  
  await delay(400);
  
  // Step 2: Personality traits
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/traits/positive", value: signData.traits.positive },
      { op: "replace", path: "/traits/negative", value: signData.traits.negative },
      { op: "replace", path: "/traits/loveStyle", value: signData.element === "Fire" ? "Passionate and bold" : signData.element === "Earth" ? "Steady and devoted" : signData.element === "Air" ? "Intellectual and playful" : "Deep and emotional" },
      { op: "replace", path: "/traits/careerStrengths", value: ["Leadership", "Creativity", "Persistence", "Adaptability"].slice(0, 3) },
    ],
  });
  
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
  
  await delay(400);
  
  // Step 3: Compatibility
  const compatMap: Record<string, { best: string[]; challenging: string[] }> = {
    Fire: { best: ["Leo", "Sagittarius", "Aries"], challenging: ["Cancer", "Capricorn"] },
    Earth: { best: ["Virgo", "Capricorn", "Taurus"], challenging: ["Gemini", "Sagittarius"] },
    Air: { best: ["Libra", "Aquarius", "Gemini"], challenging: ["Scorpio", "Taurus"] },
    Water: { best: ["Pisces", "Cancer", "Scorpio"], challenging: ["Aries", "Leo"] },
  };
  
  const compat = compatMap[signData.element];
  
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/compatibility/bestMatches", value: compat.best },
      { op: "replace", path: "/compatibility/challengingMatches", value: compat.challenging },
      { op: "replace", path: "/compatibility/friendshipStyle", value: signData.element === "Fire" ? "Adventurous companion" : signData.element === "Earth" ? "Reliable confidant" : signData.element === "Air" ? "Stimulating conversationalist" : "Empathetic listener" },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/2/status", value: "completed" },
      { op: "replace", path: "/steps/3/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(400);
  
  // Step 4: Forecast
  const forecasts = [
    "The stars align in your favor today",
    "New opportunities are on the horizon",
    "Trust your intuition in matters of the heart",
    "Focus on self-care and inner peace",
  ];
  const luckyNums = [Math.floor(Math.random() * 50) + 1, Math.floor(Math.random() * 50) + 1, Math.floor(Math.random() * 50) + 1];
  const colors = ["Royal Blue", "Emerald Green", "Golden Yellow", "Deep Purple", "Coral Pink"];
  
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/currentForecast/overall", value: forecasts[Math.floor(Math.random() * forecasts.length)] },
      { op: "replace", path: "/currentForecast/love", value: "Venus smiles upon your romantic endeavors" },
      { op: "replace", path: "/currentForecast/career", value: "Professional recognition is within reach" },
      { op: "replace", path: "/currentForecast/health", value: "Prioritize rest and mindfulness" },
      { op: "replace", path: "/currentForecast/luckyNumbers", value: luckyNums },
      { op: "replace", path: "/currentForecast/luckyColor", value: colors[Math.floor(Math.random() * colors.length)] },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/3/status", value: "completed" },
      { op: "replace", path: "/steps/4/status", value: "in_progress" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(400);
  
  // Step 5: Personality matrix
  emitDojoEvent(threadId, {
    type: "STATE_DELTA",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    delta: [
      { op: "replace", path: "/personalityScore/introversion", value: Math.floor(Math.random() * 40) + 30 },
      { op: "replace", path: "/personalityScore/intuition", value: Math.floor(Math.random() * 40) + 30 },
      { op: "replace", path: "/personalityScore/thinking", value: Math.floor(Math.random() * 40) + 30 },
      { op: "replace", path: "/personalityScore/judging", value: Math.floor(Math.random() * 40) + 30 },
    ],
  });
  
  emitDojoEvent(threadId, {
    type: "ACTIVITY_DELTA",
    threadId,
    messageId: activityId,
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/4/status", value: "completed" },
    ],
    timestamp: new Date().toISOString(),
  });
  
  await delay(300);
  
  // Final message with AI (if available)
  const messageId = crypto.randomUUID();
  
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: `You are a mystical astrologer. Give a brief, poetic 2-sentence personalized message for ${name}, a ${sign} born on ${birthDate}. Be encouraging and mysterious.` }],
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
        const stripped = line.startsWith("data: ") ? line.slice(6) : line;
        if (!stripped || stripped === "[DONE]") continue;
        try {
          const data = JSON.parse(stripped);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            emitDojoEvent(threadId, {
              type: "TEXT_MESSAGE_CONTENT",
              threadId,
              runId,
              messageId,
              delta,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
            // Partial JSON line from SSE stream — skip
          }
      }
    }

    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_END",
      threadId,
      runId,
      messageId,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Fallback message
    emitDojoEvent(threadId, {
      type: "TEXT_MESSAGE_START",
      threadId,
      runId,
      messageId,
      role: "assistant",
      timestamp: new Date().toISOString(),
    });
    
    const fallback = `Dear ${name}, as a ${sign.charAt(0).toUpperCase() + sign.slice(1)}, the cosmos have aligned to reveal your unique path. Your ${signData.element} energy flows through all you do, guiding you toward your destiny.`;
    for (const char of fallback) {
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
}
