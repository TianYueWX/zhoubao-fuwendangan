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
        'text-subtle': 'var(--color-text-subtle)'
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
