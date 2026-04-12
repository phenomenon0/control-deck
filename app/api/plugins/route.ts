/**
 * Plugin CRUD API
 * 
 * Endpoints:
 * - GET /api/plugins - List all plugins
 * - GET /api/plugins?id=xxx - Get single plugin
 * - POST /api/plugins - Create plugin from bundle
 * - PUT /api/plugins - Update plugin
 * - DELETE /api/plugins?id=xxx - Delete plugin
 * - PATCH /api/plugins/order - Reorder plugins
 */

import { NextRequest, NextResponse } from "next/server";
import { 
  getPlugins, 
  getPlugin, 
  createPlugin, 
  updatePlugin, 
  deletePlugin,
  updatePluginOrder,
  type PluginRow 
} from "@/lib/agui/db";
import { parseBundle, parseBundleFromJson, mergeConfigValues } from "@/lib/plugins/bundle";
import type { PluginBundle, PluginInstance } from "@/lib/plugins/types";

// =============================================================================
// Helpers
// =============================================================================

function rowToInstance(row: PluginRow): PluginInstance {
  const bundle = JSON.parse(row.bundle) as PluginBundle;
  const configValues = JSON.parse(row.config_values) as Record<string, unknown>;
  
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon,
    template: bundle.template,
    bundle,
    configValues: mergeConfigValues(
      bundle.config.schema,
      bundle.config.defaults,
      configValues
    ),
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// GET - List plugins or get single plugin
// =============================================================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const enabledOnly = searchParams.get("enabled") === "true";
    
    if (id) {
      // Get single plugin
      const row = getPlugin(id);
      if (!row) {
        return NextResponse.json(
          { error: "Plugin not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ plugin: rowToInstance(row) });
    }
    
    // List all plugins
    const rows = getPlugins(enabledOnly);
    const plugins = rows.map(rowToInstance);
    
    return NextResponse.json({ plugins });
  } catch (error) {
    console.error("GET /api/plugins error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch plugins" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Create new plugin from bundle
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { bundle: bundleInput, configValues } = body;
    
    if (!bundleInput) {
      return NextResponse.json(
        { error: "Missing bundle in request body" },
        { status: 400 }
      );
    }
    
    // Parse and validate the bundle
    let validationResult;
    if (typeof bundleInput === "string") {
      validationResult = parseBundleFromJson(bundleInput);
    } else {
      validationResult = parseBundle(bundleInput);
    }
    
    if (!validationResult.valid || !validationResult.bundle) {
      return NextResponse.json(
        { 
          error: "Invalid plugin bundle",
          validationErrors: validationResult.errors,
          warnings: validationResult.warnings,
        },
        { status: 400 }
      );
    }
    
    const bundle = validationResult.bundle;
    
    // Check if plugin with this ID already exists
    const existing = getPlugin(bundle.manifest.id);
    if (existing) {
      return NextResponse.json(
        { error: `Plugin with ID "${bundle.manifest.id}" already exists` },
        { status: 409 }
      );
    }
    
    // Create the plugin
    createPlugin({
      id: bundle.manifest.id,
      name: bundle.manifest.name,
      description: bundle.manifest.description,
      icon: bundle.manifest.icon,
      template: bundle.template,
      bundle,
      configValues: configValues ?? {},
      enabled: true,
    });
    
    // Return the created plugin
    const row = getPlugin(bundle.manifest.id);
    if (!row) {
      throw new Error("Failed to retrieve created plugin");
    }
    
    return NextResponse.json(
      { 
        plugin: rowToInstance(row),
        warnings: validationResult.warnings,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/plugins error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create plugin" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PUT - Update existing plugin
// =============================================================================

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: "Missing plugin ID" },
        { status: 400 }
      );
    }
    
    const existing = getPlugin(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Plugin not found" },
        { status: 404 }
      );
    }
    
    // Handle bundle update with validation
    if (updates.bundle) {
      let validationResult;
      if (typeof updates.bundle === "string") {
        validationResult = parseBundleFromJson(updates.bundle);
      } else {
        validationResult = parseBundle(updates.bundle);
      }
      
      if (!validationResult.valid || !validationResult.bundle) {
        return NextResponse.json(
          { 
            error: "Invalid plugin bundle",
            validationErrors: validationResult.errors,
          },
          { status: 400 }
        );
      }
      
      updates.bundle = validationResult.bundle;
    }
    
    // Prepare update object
    const updateData: Parameters<typeof updatePlugin>[1] = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.icon !== undefined) updateData.icon = updates.icon;
    if (updates.template !== undefined) updateData.template = updates.template;
    if (updates.bundle !== undefined) updateData.bundle = updates.bundle;
    if (updates.configValues !== undefined) updateData.configValues = updates.configValues;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;
    if (updates.sortOrder !== undefined) updateData.sort_order = updates.sortOrder;
    
    updatePlugin(id, updateData);
    
    // Return updated plugin
    const row = getPlugin(id);
    if (!row) {
      throw new Error("Failed to retrieve updated plugin");
    }
    
    return NextResponse.json({ plugin: rowToInstance(row) });
  } catch (error) {
    console.error("PUT /api/plugins error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update plugin" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE - Remove a plugin
// =============================================================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json(
        { error: "Missing plugin ID" },
        { status: 400 }
      );
    }
    
    const existing = getPlugin(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Plugin not found" },
        { status: 404 }
      );
    }
    
    deletePlugin(id);
    
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/plugins error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete plugin" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH - Reorder plugins
// =============================================================================

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderedIds } = body;
    
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json(
        { error: "orderedIds must be an array of plugin IDs" },
        { status: 400 }
      );
    }
    
    updatePluginOrder(orderedIds);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/plugins error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder plugins" },
      { status: 500 }
    );
  }
}
