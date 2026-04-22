/**
 * 3D-generation invocation surface. Modes: text-to-3D and image-to-3D.
 * Output is a GLB / GLTF / OBJ mesh URL (most providers) or bytes.
 */

export interface ThreeDGenInput {
  /** Text prompt — for text-to-3D mode. */
  prompt?: string;
  /** Reference image — for image-to-3D mode. */
  image?: {
    base64?: string;
    url?: string;
    mimeType?: string;
  };
}

export interface ThreeDGenArgs extends ThreeDGenInput {
  model?: string;
  seed?: number;
  /** Output mesh format hint. Most providers return GLB. */
  format?: "glb" | "gltf" | "obj";
  extras?: Record<string, unknown>;
}

export interface ThreeDGenResult {
  /** Hosted mesh URL (cloud providers). */
  meshUrl?: string;
  /** Inline mesh bytes when the provider returns binary. */
  meshBytes?: ArrayBuffer;
  /** MIME type — e.g. "model/gltf-binary" for GLB. */
  mime: string;
  /** Optional preview image URL some providers surface alongside the mesh. */
  previewUrl?: string;
  providerId: string;
}
