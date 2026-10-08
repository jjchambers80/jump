/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/theme/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          fg: 'var(--brand-fg)',
          link: 'var(--brand-link)',
        },
        // Admin accent: Eventimus lime #c8ff00 for fills (dark text on top)
        // and dark-mode links; 600+ are darker shades that stay readable as
        // link text on white in light mode.
        accent: {
          50: '#f8ffe0',
          100: '#efffb3',
          200: '#e2ff80',
          300: '#c8ff00',
          400: '#c8ff00',
          hover: '#b8eb00',
          500: '#c8ff00',
          600: '#4d6b00',
          700: '#3f5800',
          800: '#2f4200',
          900: '#1f2c00',
          950: '#121a00',
        },
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        // Section cards settle in on first paint. `backwards` fill only: a
        // lingering transform would trap the fixed-position dialogs inside.
        cardIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Full-screen overlays (FloorMapButton): opacity only, so no transform
        // turns the overlay into a containing block for its own fixed sheets.
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // RSVP confirmation stamp (RsvpPass): lands once, settles at its tilt.
        stampIn: {
          '0%': { opacity: '0', transform: 'scale(1.6) rotate(-14deg)' },
          '60%': { opacity: '1', transform: 'scale(0.94) rotate(-5deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-6deg)' },
        },
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.2s ease-out',
        'slide-in-left': 'slideInLeft 0.2s ease-out',
        'card-in': 'cardIn 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) backwards',
        'stamp-in': 'stampIn 0.36s cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'fade-in': 'fadeIn 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
