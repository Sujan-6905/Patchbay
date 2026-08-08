/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        head: ['Bricolage Grotesque', 'Inter', 'sans-serif'],
        accent: ['Instrument Serif', 'Georgia', 'serif'],
      },
      keyframes: {
        // Starts fully visible at full size (not scale-0/opacity-0) so the burst is
        // immediately detectable, including by the E2E test's tight 1s visibility
        // window on a peer that just received the reaction over the data channel, and
        // only fades out at the very end, after the pop + float motion.
        'reaction-pop': {
          '0%': { transform: 'scale(1) translateY(0)', opacity: '1' },
          '15%': { transform: 'scale(1.4) translateY(0)', opacity: '1' },
          '30%': { transform: 'scale(1) translateY(0)', opacity: '1' },
          '75%': { transform: 'scale(1) translateY(-1.25rem)', opacity: '1' },
          '100%': { transform: 'scale(0.85) translateY(-2.5rem)', opacity: '0' },
        },
        'speaking-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(74, 222, 128, 0.45)' },
          '50%': { boxShadow: '0 0 0 6px rgba(74, 222, 128, 0)' },
        },
      },
      animation: {
        'reaction-pop': 'reaction-pop 3.6s ease-out forwards',
        'speaking-pulse': 'speaking-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
