/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ألوان الهوية من PRD §30
        primary: {
          DEFAULT: '#5B5FEF',
          50: '#EEEFFD',
          100: '#DDE0FB',
          200: '#BFC3F7',
          300: '#9BA1F2',
          400: '#7C82EC',
          500: '#5B5FEF',
          600: '#474BD6',
          700: '#3A3DAE',
          800: '#2E2F85',
          900: '#23245E'
        },
        accent: {
          DEFAULT: '#21C7A8',
          50: '#E6FAF6',
          100: '#C8F2E9',
          200: '#93E5D3',
          300: '#5CD5BA',
          400: '#33D0AC',
          500: '#21C7A8',
          600: '#15A188',
          700: '#127F6C',
          800: '#0F6455',
          900: '#0C4A40'
        },
        danger: {
          DEFAULT: '#E55353',
          50: '#FDECEC',
          100: '#FAD3D3',
          500: '#E55353',
          600: '#D13C3C',
          700: '#AE2F2F'
        },
        warning: {
          DEFAULT: '#F0A202',
          50: '#FEF5E4',
          500: '#F0A202',
          600: '#C98402'
        },
        // ألوان دلالية مربوطة بمتغيرات CSS للثيم الفاتح/الداكن
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        edge: 'var(--edge)',
        ink: 'var(--ink)',
        muted: 'var(--muted)'
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Tahoma', '"Noto Sans Arabic"', 'system-ui', 'sans-serif'],
        mono: ['Consolas', '"Cascadia Mono"', '"Courier New"', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px rgba(16, 24, 40, 0.06)',
        'card-hover': '0 2px 4px rgba(16, 24, 40, 0.06), 0 10px 28px rgba(16, 24, 40, 0.10)',
        pop: '0 12px 40px rgba(10, 12, 20, 0.22)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        }
      },
      animation: {
        'fade-up': 'fade-up .28s ease-out both',
        'fade-in': 'fade-in .2s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  },
  plugins: []
}
