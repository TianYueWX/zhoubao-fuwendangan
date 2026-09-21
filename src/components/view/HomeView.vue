<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { navigate } from '@/router/hash';
import { editorialUnlocked, knock, resetKnock } from '@/tools/editorialAccess';

const titleCharacters = ['符', '文', '档', '案'];
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function onTitleClick(index: number): void {
  knock(index);
}

function comingSoon(): void {
  notice.value = '敬请期待';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 2400);
}

onUnmounted(() => {
  clearTimeout(noticeTimer);
  resetKnock();
});
</script>

<template>
  <section class="archive-home" aria-label="符文档案首页">
    <div class="archive-frame" aria-hidden="true"></div>
    <div class="archive-watermark" aria-hidden="true">文</div>
    <div class="home-content" :class="{ 'has-editorial': editorialUnlocked }">
      <div class="title-ornament" aria-hidden="true"><span></span><svg viewBox="0 0 32 40"><path d="M16 2 30 20 16 38 2 20Z"/><path d="m16 12 6 8-6 8-6-8Z"/></svg><span></span></div>
      <h1 class="home-title" aria-label="符文档案">
        <button v-for="(character, index) in titleCharacters" :key="character"
          type="button" class="title-character font-display" @click="onTitleClick(index)">
          {{ character }}
        </button>
      </h1>
      <div class="title-rule" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="home-entries" aria-label="档案入口">
        <button type="button" class="entry-card entry-primary" @click="navigate({ view: 'journal' })">
          <svg class="entry-art" viewBox="0 0 160 104" fill="none" aria-hidden="true">
            <path class="art-sheet" d="M35 12h90v80H35z"/><path d="M47 26h42M47 32h25M47 78h66"/>
            <path class="art-bars" d="M51 70V56h10v14m14 0V45h10v25m14 0V36h10v34"/>
            <path class="art-accent" d="m44 56 26-14 21 5 25-27m-11 1 11-1-1 11"/>
          </svg>
          <span class="entry-label font-display">周报分析</span>
          <span class="entry-arrow" aria-hidden="true">↗</span>
        </button>
        <button type="button" class="entry-card" @click="comingSoon">
          <svg class="entry-art" viewBox="0 0 160 104" fill="none" aria-hidden="true">
            <path class="art-sheet" d="M80 28c-15-10-33-13-54-10v64c20-3 38 0 54 10 16-10 34-13 54-10V18c-21-3-39 0-54 10Z"/>
            <path d="M80 28v64M38 35c11 0 21 2 30 6M38 47c11 0 21 2 30 6M38 59c11 0 21 2 30 6M92 41c9-4 19-6 30-6M92 53c9-4 19-6 30-6"/>
            <path class="art-accent" d="M108 16v29l7-5 7 5V16"/>
          </svg>
          <span class="entry-label font-display">规则与 QA 查询</span>
          <span class="entry-status">未开发</span>
        </button>
        <button type="button" class="entry-card" @click="comingSoon">
          <svg class="entry-art" viewBox="0 0 160 104" fill="none" aria-hidden="true">
            <rect class="art-sheet" x="40" y="19" width="52" height="72" rx="4" transform="rotate(-16 66 55)"/>
            <rect class="art-sheet" x="68" y="12" width="52" height="76" rx="4" transform="rotate(10 94 50)"/>
            <path class="art-accent" d="m94 29 13 23-20 17-13-23Z"/><path d="m92 40 6 11-9 8-6-11Z"/>
          </svg>
          <span class="entry-label font-display">卡牌</span>
          <span class="entry-status">未开发</span>
        </button>
        <button v-if="editorialUnlocked" type="button" class="entry-card"
          @click="navigate({ view: 'editorial' })">
          <svg class="entry-art" viewBox="0 0 160 104" fill="none" aria-hidden="true">
            <path class="art-sheet" d="M38 16h66v76H38z"/>
            <path d="M50 34h34M50 46h26M50 72h38"/>
            <path class="art-accent" d="m77 64 34-40 10 9-34 40-15 5Z M105 31l10 9M77 64l10 9"/>
          </svg>
          <span class="entry-label font-display">编辑部</span>
          <span class="entry-arrow" aria-hidden="true">↗</span>
        </button>
      </div>

      <!--
        小工具入口条
        ─────────────────────────────────────────────────────────
        与上面的大卡片分工不同:大卡片是「栏目」(周报 / 规则 / 卡牌),
        这里放不成栏目的单点小工具。第一个是结算链推演,后续小工具
        继续往这一排加即可,不影响大卡片布局。
      -->
      <div class="home-shortcuts" aria-label="小工具">
        <span class="shortcuts-label">小工具</span>
        <button
          type="button"
          class="shortcut-btn"
          title="结算链推演 · 双人对局结算链推演板"
          @click="navigate({ view: 'chain' })"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 3v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v4" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="4" cy="3" r="1.6" stroke-width="1.4"/>
            <rect x="13.8" y="13.8" width="3.4" height="3.4" rx=".8" stroke-width="1.4"/>
          </svg>
          结算链推演
        </button>
      </div>
    </div>
    <div class="home-notice" role="status" aria-live="polite" aria-atomic="true">
      <span v-if="notice">{{ notice }}</span>
    </div>
  </section>
</template>

<style scoped>
.archive-home {
  height: 100vh;
  height: 100dvh;
  display: grid;
  place-items: center;
  padding: 48px;
  overflow: hidden;
  position: relative;
  isolation: isolate;
  background: radial-gradient(ellipse at 50% 35%, var(--color-card-bg), transparent 65%);
}
.archive-frame {
  position: absolute;
  inset: 24px;
  border: 1px solid var(--color-panel-border);
  pointer-events: none;
}
.archive-frame::before, .archive-frame::after {
  content: '';
  position: absolute;
  width: 48px;
  height: 48px;
  border-color: var(--color-brand-faint);
}
.archive-frame::before { top: -1px; left: -1px; border-top: 3px solid; border-left: 3px solid; color: var(--color-brand-faint); }
.archive-frame::after { bottom: -1px; right: -1px; border-bottom: 3px solid; border-right: 3px solid; color: var(--color-brand-faint); }
.archive-watermark {
  position: absolute;
  right: -5vw;
  bottom: -18vh;
  font-family: 'Noto Serif SC', 'Songti SC', SimSun, serif;
  font-weight: 900;
  font-size: min(76vh, 60vw);
  line-height: 1;
  color: var(--color-panel-border);
  opacity: .22;
  pointer-events: none;
  z-index: -1;
}
.home-content { width: min(100%, 980px); position: relative; }
.home-content.has-editorial { width: min(100%, 1180px); }
.has-editorial .home-entries { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.has-editorial .entry-card { padding-inline: 18px; }
.has-editorial .entry-label { min-width: 0; overflow-wrap: anywhere; }
.title-ornament { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 22px; color: var(--color-accent); }
.title-ornament span { width: 44px; height: 1px; background: currentColor; opacity: .55; }
.title-ornament svg { width: 24px; height: 30px; fill: none; stroke: currentColor; stroke-width: 1.3; }
.home-title { display: flex; justify-content: center; gap: clamp(12px, 3vw, 36px); }
.title-character {
  font-size: clamp(48px, 7vw, 88px);
  line-height: 1.3;
  font-weight: 900;
  color: var(--color-text-primary);
  transition: color 180ms;
}
.title-character:hover { color: var(--color-brand); }
.title-rule { display: flex; justify-content: center; align-items: center; gap: 7px; margin: 24px auto clamp(28px, 5vh, 52px); }
.title-rule i { width: 3px; height: 3px; background: var(--color-brand); transform: rotate(45deg); }
.title-rule i:nth-child(2) { width: 34px; height: 2px; transform: none; }
.home-entries { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
.entry-card {
  position: relative;
  min-height: 240px;
  padding: 24px 28px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-content: end;
  gap: 12px;
  text-align: left;
  border: 1px solid var(--color-card-border);
  border-radius: 12px;
  background: var(--color-card-bg);
  box-shadow: 0 6px 20px -16px var(--color-shadow);
  transition: border-color 180ms, box-shadow 180ms, transform 180ms;
}
.entry-card::after { content: ''; position: absolute; left: 28px; right: 28px; bottom: 58px; height: 1px; background: var(--color-panel-border); }
.entry-card:hover { border-color: var(--color-brand-faint); box-shadow: 0 12px 28px -16px var(--color-shadow); transform: translateY(-4px); }
.entry-primary { border-top: 3px solid var(--color-brand); }
.entry-art { grid-column: 1 / -1; width: 150px; height: 100px; justify-self: center; margin-bottom: 16px; stroke: var(--color-text-muted); stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; transition: transform 200ms; }
.entry-card:hover .entry-art { transform: translateY(-3px); }
.art-sheet { fill: var(--color-page-bg); }
.art-bars { fill: var(--color-panel-border); }
.art-accent { stroke: var(--color-brand); }
.entry-label { font-size: clamp(17px, 1.7vw, 22px); font-weight: 700; align-self: center; }
.entry-arrow { color: var(--color-brand); font-size: 23px; line-height: 1; align-self: center; }
.entry-status { color: var(--color-text-subtle); font-size: 10px; align-self: center; white-space: nowrap; }

/* ── 小工具入口条 ──
 * 大卡片下方的一排紧凑按钮。收录不成栏目的单点工具,
 * 保持首页的呼吸感,新增小工具只需在这里再加一个按钮。 */
.home-shortcuts {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: clamp(18px, 3vh, 30px);
}
.shortcuts-label {
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
  padding-right: 4px;
  border-right: 1px solid var(--color-panel-border);
  margin-right: 2px;
  line-height: 1.6;
}
.shortcut-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
  font-size: 13.5px;
  font-weight: 600;
  transition: border-color 180ms, color 180ms, transform 180ms, box-shadow 180ms;
}
.shortcut-btn svg {
  width: 17px;
  height: 17px;
  stroke: var(--color-text-subtle);
  transition: stroke 180ms;
}
.shortcut-btn:hover {
  border-color: var(--color-brand-faint);
  color: var(--color-brand);
  transform: translateY(-2px);
  box-shadow: 0 10px 22px -16px var(--color-shadow);
}
.shortcut-btn:hover svg { stroke: var(--color-brand); }
.home-notice { position: absolute; bottom: max(36px, env(safe-area-inset-bottom)); left: 0; right: 0; text-align: center; pointer-events: none; }
.home-notice span { display: inline-block; padding: 10px 24px; border: 1px solid var(--color-brand-faint); border-radius: 12px; background: var(--color-card-bg); color: var(--color-brand); font-size: 14px; }
@media (max-width: 900px) {
  .archive-home { padding: 32px; }
  .archive-frame { inset: 14px; }
  .home-content { max-width: 440px; }
  .home-entries { grid-template-columns: 1fr; gap: 12px; }
  .entry-card { min-height: 94px; padding: 16px; grid-template-columns: 62px 1fr auto; align-items: center; gap: 12px; }
  .entry-art { grid-column: auto; width: 62px; height: 56px; margin: 0; }
  .entry-card::after { display: none; }
  .entry-primary { border-top-width: 1px; border-left: 3px solid var(--color-brand); padding-left: 14px; }
  .entry-label { font-size: 18px; }
  .has-editorial .home-entries { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .has-editorial .entry-card { grid-template-columns: minmax(0, 1fr) auto; min-height: 142px; padding: 14px; gap: 8px; }
  .has-editorial .entry-art { grid-column: 1 / -1; width: 76px; height: 54px; }
  .has-editorial .entry-label { font-size: 16px; }
  .has-editorial .entry-status { font-size: 9px; }
  .archive-watermark { font-size: 65vh; right: -30vw; bottom: -8vh; }
}
@media (max-width: 360px) {
  .archive-home { padding: 26px; }
  .entry-card { grid-template-columns: 44px 1fr auto; gap: 8px; padding: 12px; }
  .entry-art { width: 44px; }
  .entry-label { font-size: 16px; }
}
@media (max-height: 700px) {
  .title-ornament { margin-bottom: 12px; }
  .title-character { font-size: 52px; }
  .title-rule { margin: 16px auto 24px; }
  .entry-card { min-height: 80px; }
}
@media (max-height: 520px) {
  .archive-home { padding: 24px; }
  .archive-frame { inset: 10px; }
  .title-ornament { display: none; }
  .title-character { font-size: 38px; }
  .title-rule { margin: 10px auto 18px; }
  .entry-card { min-height: 58px; padding: 10px 14px; }
  .entry-art { height: 40px; margin-bottom: 8px; }
  .entry-card::after { display: none; }
  .home-entries { gap: 8px; }
  .home-notice { bottom: 10px; }
  .has-editorial .entry-card { min-height: 92px; padding: 8px 12px; gap: 4px; }
  .has-editorial .entry-art { height: 32px; margin-bottom: 0; }
}
</style>
