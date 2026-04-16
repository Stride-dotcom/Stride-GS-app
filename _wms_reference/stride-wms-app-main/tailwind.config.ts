import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
      },
      borderRadius: {
        "3xl": "1rem",
        "2xl": "0.75rem",
        xl: "0.5rem",
        lg: "0.5rem",
        md: "0.375rem",
        DEFAULT: "0.25rem",
        sm: "0.125rem",
        "apple-sm": "10px",
        "apple-md": "16px",
        "apple-lg": "22px",
        "apple-xl": "28px",
      },
      backgroundImage: {
        'gloss-light': 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        'gloss-dark': 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        'gloss-sidebar': 'linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 50%, rgba(0, 0, 0, 0.1) 100%)',
        'gloss-primary': 'linear-gradient(180deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
        'gloss-success': 'linear-gradient(180deg, #34d399 0%, #10b981 100%)',
        'gloss-warning': 'linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%)',
        'gloss-error': 'linear-gradient(180deg, #f87171 0%, #ef4444 100%)',
        'gloss-info': 'linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%)',
      },
      boxShadow: {
        'gloss-inset': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'gloss-inset-light': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.8)',
        'gloss-card': '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)',
        'gloss-card-hover': '0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.9)',
        'gloss-dark-card': '0 4px 12px rgba(0, 0, 0, 0.3), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)',
        'sidebar-gloss': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05), inset 0 -1px 0 0 rgba(0, 0, 0, 0.2)',
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
            opacity: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
            opacity: "1",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
            opacity: "1",
          },
          to: {
            height: "0",
            opacity: "0",
          },
        },
        // Shimmer effect for primary CTA buttons
        shimmer: {
          "0%": {
            transform: "translateX(-100%)",
          },
          "100%": {
            transform: "translateX(100%)",
          },
        },
        // QR Scanner laser animation (Solar Flare orange)
        scan: {
          "0%, 100%": {
            transform: "translateY(0%)",
            opacity: "0.8",
          },
          "50%": {
            transform: "translateY(100%)",
            opacity: "1",
          },
        },
        // Cascade fade-in for table rows (waterfall effect)
        "cascade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(8px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        // Float-in effect for cards
        "float-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(16px) scale(0.98)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
        },
        // Fade-in animation
        "fade-in": {
          "0%": {
            opacity: "0",
          },
          "100%": {
            opacity: "1",
          },
        },
        // Slide-in from bottom
        "slide-in-from-bottom": {
          "0%": {
            transform: "translateY(16px)",
            opacity: "0",
          },
          "100%": {
            transform: "translateY(0)",
            opacity: "1",
          },
        },
        // Pulse glow for status indicators
        "pulse-glow": {
          "0%, 100%": {
            opacity: "1",
            filter: "drop-shadow(0 0 4px hsl(var(--primary) / 0.6))",
          },
          "50%": {
            opacity: "0.7",
            filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.8))",
          },
        },
        // Indicator pill bounce
        "indicator-bounce": {
          "0%": {
            transform: "scaleY(0.8)",
          },
          "50%": {
            transform: "scaleY(1.1)",
          },
          "100%": {
            transform: "scaleY(1)",
          },
        },
        // Banner roll-down/up animations
        "banner-roll-down": {
          "0%": { transform: "translateX(-50%) translateY(-120%) scaleY(0.85)", opacity: "0" },
          "60%": { transform: "translateX(-50%) translateY(6%) scaleY(1.02)", opacity: "1" },
          "100%": { transform: "translateX(-50%) translateY(0) scaleY(1)", opacity: "1" },
        },
        "banner-roll-up": {
          "0%": { transform: "translateX(-50%) translateY(0) scaleY(1)", opacity: "1" },
          "100%": { transform: "translateX(-50%) translateY(-120%) scaleY(0.85)", opacity: "0" },
        },
        // Bottom banner (toast) roll-up / roll-down
        "banner-roll-up-from-bottom": {
          "0%": { transform: "translateX(-50%) translateY(120%) scaleY(0.85)", opacity: "0" },
          "60%": { transform: "translateX(-50%) translateY(-6%) scaleY(1.02)", opacity: "1" },
          "100%": { transform: "translateX(-50%) translateY(0) scaleY(1)", opacity: "1" },
        },
        "banner-roll-down-to-bottom": {
          "0%": { transform: "translateX(-50%) translateY(0) scaleY(1)", opacity: "1" },
          "100%": { transform: "translateX(-50%) translateY(120%) scaleY(0.85)", opacity: "0" },
        },
        "banner-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(59, 130, 246, 0)" },
          "50%": { boxShadow: "0 0 12px 2px rgba(59, 130, 246, 0.3)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 1.5s infinite",
        scan: "scan 2s ease-in-out infinite",
        "cascade-in": "cascade-in 0.4s ease-out forwards",
        "float-in": "float-in 0.5s ease-out forwards",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "slide-in-bottom": "slide-in-from-bottom 0.3s ease-out forwards",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "indicator-bounce": "indicator-bounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "banner-roll-down": "banner-roll-down 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "banner-roll-up": "banner-roll-up 250ms ease-out forwards",
        "banner-roll-up-from-bottom": "banner-roll-up-from-bottom 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "banner-roll-down-to-bottom": "banner-roll-down-to-bottom 250ms ease-out forwards",
        "banner-glow": "banner-glow 3s ease-in-out infinite",
      },
      transitionTimingFunction: {
        bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;