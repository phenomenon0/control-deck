/**
 * 3D-generation providers (image-to-3D, text-to-3D meshes).
 *
 * Today: lib/tools/workflows/index.ts:buildHunyuan3DWorkflow() — Hunyuan 3D
 * v2.1 via ComfyUI, image input, GLB output. Viewed via @google/model-viewer.
 *
 * Planned registrations:
 *   comfyui   — wraps the existing Hunyuan workflow; extends with other
 *               ComfyUI 3D nodes (TripoSR, InstantMesh) when present
 *   meshy     — commercial API, text-to-3D + image-to-3D
 *   luma      — Genie; fast text-to-3D
 *   tripo     — Tripo3D API
 */

export function register3dGenProviders(): void {
  // no-op for step 1
}
