import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';

// Real app styling. globals.css pulls in Tailwind v4 (via @tailwindcss/postcss,
// which Vite picks up from postcss.config.mjs) plus the deck design tokens.
// blog-theme.css defines the per-theme base palette ([data-theme="light|dark|
// hacker"]); warp.css sets the accent. globals.css derives every surface token
// from those via color-mix, so flipping data-theme re-themes everything.
import '../app/globals.css';
import '../app/warp.css';
import '../app/audio.css';
import '../app/blog-theme.css';
import '@wterm/react/css';
// Imported last so its :root[data-theme=...] palette overrides win.
import './theme-bridge.css';
// Per-regime structural treatments (borders/elevation/brackets).
import './regimes.css';
// Per-theme typographic universe (weights/tracking/leading/type scale).
import './typography.css';
// Per-theme icon treatment (stroke weight, caps/joins, idle contrast).
import './icons.css';

// Theme toolbar — mirrors how the app themes itself (data-theme on <html>).
export const globalTypes = {
  theme: {
    description: 'Deck theme',
    defaultValue: 'dark',
    toolbar: {
      title: 'Theme',
      icon: 'paintbrush',
      items: [
        { value: 'velvet-dark', title: 'VelvetMD · Dark (serif)' },
        { value: 'velvet-deep', title: 'VelvetMD · Deep Narrative' },
        { value: 'velvet-light', title: 'VelvetMD · Light' },
        { value: 'dark', title: 'Deck · Dark' },
        { value: 'light', title: 'Deck · Light' },
        { value: 'hacker', title: 'Deck · Hacker' },
        { value: 'homey', title: 'Regime · Homey' },
        { value: 'academia', title: 'Regime · Academia' },
        { value: 'industrial', title: 'Regime · Industrial' },
        { value: 'claude', title: 'Brand · Claude (warm cream)' },
        { value: 'vercel', title: 'Brand · Vercel (stark white)' },
        { value: 'linear', title: 'Brand · Linear (near-black)' },
        { value: 'spotify', title: 'Brand · Spotify (green/black)' },
        { value: 'elevenlabs', title: 'Brand · ElevenLabs (editorial)' },
        { value: 'stripe', title: 'Brand · Stripe (indigo light)' },
        { value: 'notion', title: 'Brand · Notion (clean paper)' },
        { value: 'ferrari', title: 'Brand · Ferrari (Rosso Corsa)' },
        { value: 'playstation', title: 'Brand · PlayStation (console)' },
      ],
      dynamicTitle: true,
    },
  },
};

const preview: Preview = {
  decorators: [
    (Story, context) => {
      // Apply the selected theme exactly as app/layout.tsx does: data-theme +
      // .dark/.light on <html>, plus the warp accent attrs. The token cascade
      // does the rest, so every token-driven v2 component re-themes for free.
      const theme = (context.globals.theme as string) ?? 'dark';
      // Deck themes are handled by blog-theme/warp; everything else is "bridged"
      // (cd-bridged maps its palette onto warp's surface vars — the contrast fix).
      const DECK_THEMES = new Set(['dark', 'light', 'hacker']);
      const isBridged = !DECK_THEMES.has(theme);
      // Which themes use a light base (drives the .light/.dark body class).
      const LIGHT_THEMES = new Set([
        'light', 'velvet-light', 'homey', 'academia',
        'claude', 'vercel', 'elevenlabs', 'stripe', 'notion',
      ]);
      const isLight = LIGHT_THEMES.has(theme);
      const root = document.documentElement;
      root.dataset.theme = theme;
      root.dataset.accent = 'amber'; // bridge overrides --accent-rgb at higher specificity
      root.dataset.warmth = 'warm';
      root.dataset.type = 'matter';
      root.classList.toggle('dark', !isLight);
      root.classList.toggle('light', isLight);
      root.classList.toggle('cd-bridged', isBridged);
      return (
        <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    backgrounds: { disable: true }, // the theme token owns the background
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
