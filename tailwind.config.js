/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,ts,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        // 主题色 token(由 src/style.css 中的 CSS 变量驱动,保证主题切换时不需重编译)
        'panel-bg': 'var(--color-panel-bg)',
        'panel-border': 'var(--color-panel-border)',
        'card-bg': 'var(--color-card-bg)',
        'card-border': 'var(--color-card-border)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        'text-subtle': 'var(--color-text-subtle)',
        // v3 语义色(与 src/utils/palette.ts 的 CARD_COLOR_HEX / TIER_COLORS 对齐)
        'brand-gold': '#e8b54a',
        domain: {
          red: '#e2372b',
          green: '#3fa650',
          blue: '#2f7dd1',
          yellow: '#d9a514',
          purple: '#8b48c9',
          orange: '#e2762b',
          colorless: '#94a3b8'
        },
        tier: {
          s: '#e8b54a',
          a: '#e05d5d',
          b: '#5b8def',
          c: '#94a3b8'
        },
        delta: {
          up: '#4cc38a',
          down: '#e05d5d',
          flat: '#9aa3b5'
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif']
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
};
