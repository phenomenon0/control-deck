// Minimal inline lucide-like icons (sized via prop)
// Stroke-width 1.5, 16px default, matches Control Deck DESIGN.md §6
const I = ({ d, size = 16, className = "", style, sw = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style} aria-hidden="true">
    {d}
  </svg>
);

const Icon = {
  Brain: (p) => <I {...p} d={<><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></>} />,
  Sparkles: (p) => <I {...p} d={<><path d="m12 3-1.9 5.8-5.8 1.9 5.8 1.9L12 18.4l1.9-5.8 5.8-1.9-5.8-1.9Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></>} />,
  Search: (p) => <I {...p} d={<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>} />,
  Code: (p) => <I {...p} d={<><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>} />,
  Wrench: (p) => <I {...p} d={<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>} />,
  Image: (p) => <I {...p} d={<><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></>} />,
  Send: (p) => <I {...p} d={<><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>} />,
  Stop: (p) => <I {...p} d={<rect width="10" height="10" x="7" y="7" rx="1"/>} />,
  Mic: (p) => <I {...p} d={<><rect width="6" height="12" x="9" y="3" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></>} />,
  Paperclip: (p) => <I {...p} d={<path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.48-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>} />,
  Plus: (p) => <I {...p} d={<><path d="M5 12h14"/><path d="M12 5v14"/></>} />,
  Chat: (p) => <I {...p} d={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>} />,
  Grid: (p) => <I {...p} d={<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>} />,
  Terminal: (p) => <I {...p} d={<><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></>} />,
  Layers: (p) => <I {...p} d={<><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></>} />,
  Cpu: (p) => <I {...p} d={<><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></>} />,
  Volume: (p) => <I {...p} d={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></>} />,
  Settings: (p) => <I {...p} d={<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2"/><circle cx="12" cy="12" r="3"/></>} />,
  CommandIcon: (p) => <I {...p} d={<path d="M18 3h-3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-3m0-6V6a3 3 0 0 0-3-3h-3m0 0v3m0 0h-3a3 3 0 0 0-3-3V3m0 0H6a3 3 0 0 0-3 3v3m0 0h3m0 0v3m0 0v3a3 3 0 0 0 3 3h3m0 0v3"/>} />,
  X: (p) => <I {...p} d={<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>} />,
  Check: (p) => <I {...p} d={<path d="M20 6 9 17l-5-5"/>} />,
  Box: (p) => <I {...p} d={<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>} />,
  Waveform: (p) => <I {...p} d={<><path d="M2 12h2"/><path d="M6 6v12"/><path d="M10 3v18"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 12h-2"/></>} />,
  Chevron: (p) => <I {...p} d={<path d="m9 18 6-6-6-6"/>} />,
  Arrow: (p) => <I {...p} d={<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>} />,
  Download: (p) => <I {...p} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>} />,
  Expand: (p) => <I {...p} d={<><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></>} />,
};

window.Icon = Icon;
