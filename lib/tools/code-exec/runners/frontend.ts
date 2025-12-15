/**
 * Frontend Runner - Generate HTML previews for React, HTML, CSS, Three.js, WebGL
 * 
 * These don't execute server-side - they generate bundled HTML for iframe preview
 */

import type { CodeRunner, CodeExecRequest, CodeExecResult, ExecContext, Language, CodeExecPreview } from "../types";

// CDN URLs for common libraries
const CDN = {
  react: "https://unpkg.com/react@18/umd/react.production.min.js",
  reactDom: "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  babel: "https://unpkg.com/@babel/standalone/babel.min.js",
  three: "https://unpkg.com/three@0.160.0/build/three.min.js",
  threeOrbitControls: "https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js",
};

// HTML template for React
const REACT_TEMPLATE = (code: string, title: string = "React Preview") => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="${CDN.react}"></script>
  <script src="${CDN.reactDom}"></script>
  <script src="${CDN.babel}"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { min-height: 100vh; }
    .error { color: red; padding: 20px; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    try {
      ${code}
      
      // Auto-render if there's an App or default export
      if (typeof App !== 'undefined') {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<App />);
      }
    } catch (e) {
      document.getElementById('root').innerHTML = '<div class="error">' + e.message + '</div>';
      console.error(e);
    }
  </script>
</body>
</html>
`;

// HTML template for Three.js
const THREEJS_TEMPLATE = (code: string, title: string = "Three.js Preview") => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; }
    body { overflow: hidden; }
    canvas { display: block; }
    .error { color: red; padding: 20px; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <script src="${CDN.three}"></script>
  <script>
    // Make THREE available globally
    window.THREE = THREE;
    
    // Helper to create default scene
    function createDefaultScene() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      
      const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.z = 5;
      
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      document.body.appendChild(renderer.domElement);
      
      // Handle resize
      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });
      
      return { scene, camera, renderer };
    }
    
    try {
      ${code}
    } catch (e) {
      document.body.innerHTML = '<div class="error">' + e.message + '</div>';
      console.error(e);
    }
  </script>
</body>
</html>
`;

// Plain HTML template (wraps user HTML with proper document structure if needed)
const HTML_TEMPLATE = (code: string) => {
  // Check if it's already a full HTML document
  if (code.trim().toLowerCase().startsWith("<!doctype") || 
      code.trim().toLowerCase().startsWith("<html")) {
    return code;
  }
  
  // Check if it has a head/body
  if (code.includes("<head") || code.includes("<body")) {
    return `<!DOCTYPE html>\n<html>\n${code}\n</html>`;
  }
  
  // Wrap bare content
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; }
  </style>
</head>
<body>
${code}
</body>
</html>
`;
};

export class FrontendRunner implements CodeRunner {
  language: Language[] = ["html", "react", "threejs"];
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "html" || 
           req.language === "react" || 
           req.language === "threejs";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const startTime = Date.now();
    
    try {
      let bundledHtml: string;
      
      switch (req.language) {
        case "react":
          bundledHtml = REACT_TEMPLATE(req.code);
          break;
          
        case "threejs":
          bundledHtml = THREEJS_TEMPLATE(req.code);
          break;
          
        case "html":
        default:
          bundledHtml = HTML_TEMPLATE(req.code);
          break;
      }
      
      const preview: CodeExecPreview = {
        html: req.code,
        bundled: bundledHtml,
      };
      
      return {
        success: true,
        exitCode: 0,
        stdout: `Preview generated for ${req.language}`,
        stderr: "",
        durationMs: Date.now() - startTime,
        preview,
      };
      
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: errMsg,
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
    }
  }
}

export const frontendRunner = new FrontendRunner();
