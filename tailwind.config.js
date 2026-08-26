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
        // 朱砂红(主题感知:宣纸 #B23A27 / 墨夜 #D0553F)与朱上文字色
        brand: 'var(--color-brand)',
        'brand-ink': 'var(--color-brand-ink)',
        'brand-soft': 'var(--color-brand-soft)',
        'brand-faint': 'var(--color-brand-faint)',
        // 藤黄点缀(标签/徽章/高亮)
        accent: 'var(--color-accent)',
        'accent-ink': 'var(--color-accent-ink)',
        // 六色域(与 src/utils/palette.ts 的 CARD_COLOR_HEX 对齐,语义固定)
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
          s: '#b23a27',
          a: '#c59b46',
          b: '#3b4a5a',
          c: '#94a3b8'
        },
        delta: {
          up: '#4cc38a',
          down: '#e05d5d',
          flat: '#9aa3b5'
        }
      },
      fontFamily: {
        // 展示字体:中文衬线(刊印/档案感),离线回退系统衬线
        display: [
          '"Noto Serif SC"',
          '"Songti SC"',
          'STSong',
          'SimSun',
          'serif'
        ],
        // 拉丁铭文(报头英文小标)
        latin: [
          'Cinzel',
          'Georgia',
          '"Times New Roman"',
          'serif'
        ],
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace'
        ]
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
