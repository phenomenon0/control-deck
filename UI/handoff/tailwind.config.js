/**
 * Tailwind config — Control Deck × Warp
 * ---------------------------------------------------------------
 * Mirrors tokens.standalone.css so Tailwind utility classes
 * resolve to the same values as the raw CSS variables. Use
 * whichever you prefer; they compose.
 *
 *   className="bg-bg-card text-fg-muted border border-border"
 *   // equivalent to:
 *   style={{ background: "var(--bg-card)", color: "var(--fg-muted)", border: "1px solid var(--border)" }}
 *
 * Every color/space/radius below is pointed at a CSS variable,
 * so runtime tweaks (data-warmth, data-accent, data-theme) still
 * work — Tailwind just gives you the shortcut.
 * ---------------------------------------------------------------
 */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,html}",
    "./app/**/*.{js,jsx,ts,tsx,html}",
    "./pages/**/*.{js,jsx,ts,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic — prefer these in components
        bg:         "var(--bg)",
        "bg-card":  "var(--bg-card)",
        "bg-elev":  "var(--bg-elev)",
        "bg-inset": "var(--bg-inset)",
        fg:         "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-dim":   "var(--fg-dim)",
        "fg-faint": "var(--fg-faint)",
        border:         "var(--border)",
        "border-bright": "var(--border-bright)",
        accent:          "var(--accent)",
        "accent-deep":   "var(--accent-deep)",
        "accent-muted":  "var(--accent-muted)",
        "accent-glow":   "var(--accent-glow)",
        ok:   "var(--ok)",
        warn: "var(--warn)",
        err:  "var(--err)",

        // Raw palette — escape hatch
        parchment: "var(--parchment)",
        ash:       "var(--ash)",
        stone:     "var(--stone)",
        mute:      "var(--mute)",
        earth:     "var(--earth)",
        charcoal:  "var(--charcoal)",
        void:      "var(--void)",
        amber: {
          DEFAULT: "var(--amber)",
          deep:    "var(--amber-deep)",
          muted:   "var(--amber-muted)",
          glow:    "var(--amber-glow)",
        },
      },

      fontFamily: {
        sans:    ["var(--font-sans)"],
        mono:    ["var(--font-mono)"],
        display: ["var(--font-display)"],
      },

      fontSize: {
        micro:    ["var(--fs-micro)",   { lineHeight: "1.4" }],
        xs:       ["var(--fs-xs)",      { lineHeight: "1.4" }],
        sm:       ["var(--fs-sm)",      { lineHeight: "1.45" }],
        base:     ["var(--fs-base)",    { lineHeight: "1.45" }],
        md:       ["var(--fs-md)",      { lineHeight: "1.4" }],
        lg:       ["var(--fs-lg)",      { lineHeight: "1.3" }],
        xl:       ["var(--fs-xl)",      { lineHeight: "1.2" }],
        "2xl":    ["var(--fs-2xl)",     { lineHeight: "1.1" }],
        display:  ["var(--fs-display)", { lineHeight: "1.0" }],
      },

      letterSpacing: {
        label:       "var(--label-tracking)",       // 0.2em
        labelTight:  "var(--label-tracking-tight)", // 0.16em
        tight:       "-0.02em",
        tighter:     "-0.03em",
      },

      spacing: {
        0: "var(--sp-0)",
        1: "var(--sp-1)",  // 4
        2: "var(--sp-2)",  // 8
        3: "var(--sp-3)",  // 12
        4: "var(--sp-4)",  // 16
        5: "var(--sp-5)",  // 24
        6: "var(--sp-6)",  // 32
        7: "var(--sp-7)",  // 48
        8: "var(--sp-8)",  // 64
        9: "var(--sp-9)",  // 96
      },

      borderRadius: {
        sm:   "var(--r-sm)",
        md:   "var(--r-md)",
        lg:   "var(--r-lg)",
        xl:   "var(--r-xl)",
        pill: "var(--r-pill)",
      },

      boxShadow: {
        soft:  "var(--shadow-soft)",
        lift:  "var(--shadow-lift)",
        modal: "var(--shadow-modal)",
        inset: "var(--shadow-inset)",
      },

      transitionTimingFunction: {
        out:    "var(--ease-out)",
        spring: "var(--ease-spring)",
      },

      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
      },

      zIndex: {
        nav:    "var(--z-nav)",
        sticky: "var(--z-sticky)",
        modal:  "var(--z-modal)",
        toast:  "var(--z-toast)",
      },

      keyframes: {
        fadeUp:   { from: { opacity: 0, transform: "translateY(8px)" },
                    to:   { opacity: 1, transform: "none" } },
        fadeIn:   { from: { opacity: 0 }, to: { opacity: 1 } },
        pulseSoft:{ "0%,100%": { opacity: 0.6 }, "50%": { opacity: 1 } },
        tick:     { "0%,100%": { transform: "scaleY(0.4)" }, "50%": { transform: "scaleY(1)" } },
        shimmer:  { "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        fadeUp:   "fadeUp 420ms var(--ease-out) both",
        fadeIn:   "fadeIn 300ms ease both",
        pulseSoft:"pulseSoft 1.8s ease-in-out infinite",
        tick:     "tick 900ms ease-in-out infinite",
        shimmer:  "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
