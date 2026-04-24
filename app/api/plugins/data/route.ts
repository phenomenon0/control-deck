/**
 * Plugin Data Fetch API
 * 
 * Fetches data for a plugin's sources.
 * 
 * POST /api/plugins/data
 * Body: { pluginId, bundle, configValues, forceRefresh? }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchPluginData, prepareRenderData } from "@/lib/plugins/runtime";
import { mergeConfigValues } from "@/lib/plugins/bundle";
import type { PluginBundle, PluginInstance } from "@/lib/plugins/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pluginId, bundle, configValues = {}, forceRefresh = false } = body;
    
    if (!pluginId || !bundle) {
      return NextResponse.json(
        { error: "Missing pluginId or bundle" },
        { status: 400 }
      );
    }
    
    // Create a minimal plugin instance for the runtime
    const plugin: PluginInstance = {
      id: pluginId,
      name: bundle.manifest?.name || "Plugin",
      description: bundle.manifest?.description,
      icon: bundle.manifest?.icon || "puzzle",
      template: bundle.template,
      bundle: bundle as PluginBundle,
      configValues: mergeConfigValues(
        bundle.config?.schema || {},
        bundle.config?.defaults,
        configValues
      ),
      enabled: true,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Fetch the data
    const data = await fetchPluginData(plugin, { forceRefresh });
    
    // Prepare rendered data
    const renderedData = prepareRenderData(data, bundle as PluginBundle, plugin.configValues);
    
    return NextResponse.json({
      data,
      renderedData,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/plugins/data error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch plugin data" },
      { status: 500 }
    );
  }
}
