/**
 * AG-UI Dojo API - Main endpoint
 * Handles chat, tool execution, and event streaming
 */

import { NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest) {
  return NextResponse.json({
    name: "AG-UI Dojo API",
    version: "1.0.0",
    endpoints: {
      chat: "POST /api/dojo/chat",
      stream: "GET /api/dojo/stream",
      resume: "POST /api/dojo/resume",
      meta: "POST /api/dojo/meta",
    },
  });
}
