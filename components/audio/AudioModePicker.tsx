"use client";

/**
 * AudioModePicker — small dropdown bound to AudioDockProvider's route id.
 * The visible label is the route label (Hands-free Chat, Control, …); the
 * underlying mode drives transcript routing.
 */

import { useAudioDock } from "./AudioDockProvider";

export function AudioModePicker() {
  const { routeId, route, routes, setRouteId } = useAudioDock();
  return (
    <label className="ad-mode" title={`Mode: ${route.mode}`}>
      <span className="ad-mode__label">Mode</span>
      <select
        className="ad-mode__select"
        value={routeId}
        onChange={(e) => setRouteId(e.target.value)}
      >
        {routes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
