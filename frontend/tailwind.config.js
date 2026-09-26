/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
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
        // Section cards settle in on first paint. `backwards` fill only: a
        // lingering transform would trap the fixed-position dialogs inside.
        cardIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
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
        'card-in': 'cardIn 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) backwards',
        'stamp-in': 'stampIn 0.36s cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
      },
    },
  },
  plugins: [],
};
