<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CarddexImage from "@/components/carddex/CarddexImage.vue";
import {
  BOOSTER_SETS,
  FINISH_LABELS,
  RARITY_LABELS,
  drawPack,
  loadBoosterCards,
  newId,
  setName,
  type BoosterCard,
  type BoosterSet,
  type OpenedPack,
  type OpeningRecord,
} from "@/tools/booster/model";

const STORAGE_KEY = "riftbound-booster-history-v1";
const BOX_SIZE = 24;
const records = ref<OpeningRecord[]>([]);
const cardPool = ref<BoosterCard[]>([]);
const selectedSeries = ref<BoosterSet>("OGN");
const openKind = ref<"pack" | "box">("pack");
const activeRecordId = ref("");
const activePage = ref<"open" | "history">("open");
const loading = ref(false);
const loadError = ref("");
const storageError = ref("");
const expandedRecords = ref<string[]>([]);
const clearPrompt = ref(false);
const notice = ref("");

const activeRecord = computed(() => records.value.find((record) => record.id === activeRecordId.value) ?? null);
const currentPack = computed(() => {
  const packs = activeRecord.value?.packs;
  return packs?.[packs.length - 1] ?? null;
});
const currentPackRevealed = computed(() => !!currentPack.value?.cards.length && currentPack.value.cards.every((card) => card.revealed));
const inProgressBox = computed(() => records.value.find((record) => record.kind === "box" && record.status === "inProgress") ?? null);
const setCards = computed(() => cardPool.value.filter((card) => card.series === selectedSeries.value));
const setReady = computed(() => {
  const set = new Set(setCards.value.map((card) => card.rarity));
  return ["common", "uncommon", "rare", "epic", "token"].every((rarity) => set.has(rarity as BoosterCard["rarity"]));
});
const currentBoxSummary = computed(() => activeRecord.value?.kind === "box" ? summarize(activeRecord.value.packs) : null);
const historyCount = computed(() => records.value.length);

function safeSave(): void {
  try {
    const snapshots = new Map<string, BoosterCard>();
    const compactRecords = records.value.map((record) => ({
      id: record.id,
      series: record.series,
      kind: record.kind,
      createdAt: record.createdAt,
      status: record.status,
      packs: record.packs.map((pack) => ({
        packNumber: pack.packNumber,
        openedAt: pack.openedAt,
        cards: pack.cards.map((card) => {
          snapshots.set(card.key, {
            key: card.key,
            series: card.series,
            cardId: card.cardId,
            cardNo: card.cardNo,
            name: card.name,
            rarity: card.rarity,
            finish: card.finish,
            categories: card.categories,
            imageUrl: card.imageUrl,
            fallbackUrl: card.fallbackUrl,
            language: card.language,
          });
          return { key: card.key, slot: card.slot, revealed: card.revealed };
        }),
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      cards: [...snapshots.values()],
      records: compactRecords,
    }));
    storageError.value = "";
  } catch {
    storageError.value = "浏览器本地空间不足，部分记录可能没有保存。可删除旧记录后继续。";
  }
}

function loadSavedRecords(): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return;
    const saved = parsed as {
      version?: number;
      cards?: BoosterCard[];
      records?: Array<Omit<OpeningRecord, "packs"> & { packs: Array<{ packNumber: number; openedAt: string; cards: Array<{ key: string; slot: string; revealed: boolean }> }> }>;
    };
    if (saved.version !== 1 || !Array.isArray(saved.cards) || !Array.isArray(saved.records)) return;
    const cardsByKey = new Map(saved.cards.map((card) => [card.key, card]));
    records.value = saved.records.map((record) => ({
      ...record,
      packs: record.packs.map((pack) => ({
        ...pack,
        cards: pack.cards.flatMap((drawn) => {
          const card = cardsByKey.get(drawn.key);
          return card ? [{ ...card, slot: drawn.slot, revealed: drawn.revealed }] : [];
        }),
      })),
    }));
  } catch {
    records.value = [];
  }
}

async function loadCards(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    cardPool.value = await loadBoosterCards();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadSavedRecords();
  void loadCards();
});

function saveAndFocus(record: OpeningRecord): void {
  const index = records.value.findIndex((item) => item.id === record.id);
  if (index >= 0) records.value[index] = record;
  else records.value.unshift(record);
  activeRecordId.value = record.id;
  safeSave();
}

function makeRecord(kind: "pack" | "box"): OpeningRecord {
  const record: OpeningRecord = {
    id: newId(),
    series: selectedSeries.value,
    kind,
    createdAt: new Date().toISOString(),
    status: kind === "pack" ? "complete" : "inProgress",
    packs: [],
  };
  record.packs.push(drawPack(cardPool.value, record.series, 1));
  return record;
}

function startOpening(): void {
  notice.value = "";
  if (!setReady.value) {
    notice.value = `${selectedSeries.value} 的卡牌数据不完整，暂时无法模拟开包。`;
    return;
  }
  if (openKind.value === "box" && inProgressBox.value) {
    notice.value = "有一盒尚未开完，请先继续或完成它。";
    return;
  }
  try {
    const record = makeRecord(openKind.value);
    saveAndFocus(record);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function flip(card: OpenedPack["cards"][number]): void {
  card.revealed = !card.revealed;
  if (activeRecord.value) safeSave();
}

function flipAll(pack: OpenedPack): void {
  pack.cards.forEach((card) => { card.revealed = true; });
  safeSave();
}

function nextPack(): void {
  const record = activeRecord.value;
  if (!record || record.kind !== "box" || record.status !== "inProgress") return;
  if (!currentPackRevealed.value) {
    notice.value = "先翻开本包所有卡牌，再开下一包。";
    return;
  }
  notice.value = "";
  try {
    record.packs.push(drawPack(cardPool.value, record.series, record.packs.length + 1));
    if (record.packs.length >= BOX_SIZE) record.status = "complete";
    safeSave();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function openRecoveredBox(): void {
  if (!inProgressBox.value) return;
  activeRecordId.value = inProgressBox.value.id;
  selectedSeries.value = inProgressBox.value.series;
  openKind.value = "box";
  activePage.value = "open";
  notice.value = "已恢复上次开盒进度。";
}

function toggleHistory(id: string): void {
  expandedRecords.value = expandedRecords.value.includes(id)
    ? expandedRecords.value.filter((item) => item !== id)
    : [...expandedRecords.value, id];
}

function deleteRecord(id: string): void {
  records.value = records.value.filter((record) => record.id !== id);
  expandedRecords.value = expandedRecords.value.filter((item) => item !== id);
  if (activeRecordId.value === id) activeRecordId.value = "";
  safeSave();
}

function clearHistory(): void {
  records.value = [];
  expandedRecords.value = [];
  activeRecordId.value = "";
  clearPrompt.value = false;
  safeSave();
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function summarize(packs: OpenedPack[]) {
  const cards = packs.flatMap((pack) => pack.cards);
  const counts = new Map<string, number>();
  cards.forEach((card) => counts.set(card.key, (counts.get(card.key) ?? 0) + 1));
  const uniqueCards = counts.size;
  return {
    cards,
    total: cards.length,
    uniqueCards,
    duplicateCopies: cards.length - uniqueCards,
    common: cards.filter((card) => card.rarity === "common" && card.finish === "base").length,
    uncommon: cards.filter((card) => card.rarity === "uncommon" && card.finish === "base").length,
    rare: cards.filter((card) => card.rarity === "rare" && card.finish === "base").length,
    epic: cards.filter((card) => card.rarity === "epic" && card.finish === "base").length,
    alt: cards.filter((card) => card.finish === "alt").length,
    overnumber: cards.filter((card) => card.finish === "overnumber").length,
    signature: cards.filter((card) => card.finish === "signature").length,
    ultimate: cards.filter((card) => card.finish === "ultimate").length,
    tokenRune: cards.filter((card) => card.slot === "Token／符文").length,
  };
}

function recordSummary(record: OpeningRecord) {
  const summary = summarize(record.packs);
  return `${record.packs.length}${record.kind === "box" ? `/${BOX_SIZE}` : ""} 包 · ${summary.total} 张 · ${summary.signature} 张 Signature`;
}

function statusName(record: OpeningRecord): string {
  return record.status === "complete" ? "已完成" : "进行中";
}

function progressText(record: OpeningRecord): string {
  if (record.kind === "pack") return "单包";
  return `${record.packs.length} / ${BOX_SIZE} 包`;
}

function cardFinishLabel(card: OpenedPack["cards"][number]): string {
  return card.finish === "base" ? RARITY_LABELS[card.rarity] : FINISH_LABELS[card.finish];
}
</script>

<template>
  <main class="booster-page">
    <div class="booster-masthead">
      <div>
        <p class="booster-kicker">RIFTBOUND · SEALED ARCHIVE</p>
        <h1>开卡包</h1>
        <p class="booster-subtitle">挑一个系列，撕开封口，看看这一包会带来什么。</p>
      </div>
      <div class="booster-stamp" aria-hidden="true"><span>随机</span><b>开</b><span>模拟</span></div>
    </div>

    <div class="booster-tabs" role="tablist" aria-label="开包页面">
      <button role="tab" :aria-selected="activePage === 'open'" :class="{ selected: activePage === 'open' }" @click="activePage = 'open'">开包</button>
      <button role="tab" :aria-selected="activePage === 'history'" :class="{ selected: activePage === 'history' }" @click="activePage = 'history'">本地记录 <span>{{ historyCount }}</span></button>
      <span class="booster-tabs__rule"></span>
    </div>

    <section v-if="activePage === 'open'" class="open-workspace">
      <div v-if="loading" class="booster-state" role="status"><span class="state-spinner"></span>正在读取卡牌资料…</div>
      <div v-else-if="loadError" class="booster-state booster-state--error" role="alert">
        <p>读取卡牌资料失败：{{ loadError }}</p>
        <button class="text-action" type="button" @click="loadCards">重新读取</button>
      </div>
      <template v-else>
        <section v-if="!activeRecord" class="sealed-panel">
          <div class="sealed-panel__controls">
            <div class="field-block">
              <span class="field-label">补充包系列</span>
              <div class="set-options">
                <button v-for="set in BOOSTER_SETS" :key="set" type="button" :class="{ selected: selectedSeries === set }" @click="selectedSeries = set">
                  <strong>{{ set }}</strong><small>{{ setName(set) }}</small>
                </button>
              </div>
            </div>
            <div class="field-block">
              <span class="field-label">开包方式</span>
              <div class="kind-options" role="group" aria-label="选择开包数量">
                <button type="button" :class="{ selected: openKind === 'pack' }" @click="openKind = 'pack'">单包</button>
                <button type="button" :class="{ selected: openKind === 'box' }" @click="openKind = 'box'">整盒 <small>24 包</small></button>
              </div>
            </div>
            <div v-if="inProgressBox" class="resume-callout">
              <span><b>{{ inProgressBox.series }}</b> 有一盒未开完 · {{ progressText(inProgressBox) }}</span>
              <button type="button" class="text-action" @click="openRecoveredBox">继续开盒 →</button>
            </div>
            <div class="probability-note">
              <span class="note-seal">估</span>
              <p><strong>概率模型为非官方估算</strong> · 每包 7 普通、3 不凡、2 稀有以上、1 闪卡与 1 Token／符文。Special 卡按系列估算概率替换卡槽；Signature 约 1/720，UNL Ultimate 约 1/1368。整盒不设保底。</p>
            </div>
            <p v-if="notice" class="booster-notice" role="alert">{{ notice }}</p>
            <button class="open-sealed-button" type="button" :disabled="!setReady || (openKind === 'box' && !!inProgressBox)" @click="startOpening">
              <span class="open-sealed-button__icon" aria-hidden="true">✦</span>
              {{ openKind === 'box' ? '开始开一盒' : '开始开一包' }}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <aside class="sealed-art" aria-label="补充包封面">
            <div class="wrapper-seal"><span>RIFTBOUND</span><b>{{ selectedSeries }}</b><small>BOOSTER PACK</small></div>
            <div class="wrapper-shine"></div>
            <div class="wrapper-notch"></div>
          </aside>
        </section>

        <section v-else class="opening-stage">
          <div class="opening-toolbar">
            <button class="text-action" type="button" @click="activeRecordId = ''">← 选择系列</button>
            <div class="opening-identity"><b>{{ activeRecord.series }}</b><span>{{ setName(activeRecord.series) }}</span><i>{{ activeRecord.kind === 'box' ? '整盒' : '单包' }}</i></div>
            <time>{{ formatTime(activeRecord.createdAt) }}</time>
          </div>

          <div class="pack-progress">
            <div><span>{{ activeRecord.kind === 'box' ? '本盒进度' : '补充包' }}</span><strong>{{ activeRecord.kind === 'box' ? `${activeRecord.packs.length} / ${BOX_SIZE}` : '1 包' }}</strong></div>
            <div v-if="activeRecord.kind === 'box'" class="progress-pips" :aria-label="`已开 ${activeRecord.packs.length} 包`">
              <i v-for="n in BOX_SIZE" :key="n" :class="{ filled: n <= activeRecord.packs.length, current: n === activeRecord.packs.length }"></i>
            </div>
          </div>

          <div v-if="currentPack" class="pack-open-card">
            <header class="pack-heading">
              <div><p class="booster-kicker">{{ activeRecord.series }} · {{ activeRecord.kind === 'box' ? `PACK ${String(currentPack.packNumber).padStart(2, '0')}` : 'SINGLE BOOSTER' }}</p><h2>这一包</h2></div>
              <time>{{ formatTime(currentPack.openedAt) }}</time>
            </header>
            <div class="cards-grid">
              <button v-for="(card, index) in currentPack.cards" :key="`${card.key}-${index}`" class="opened-card" :class="[{ flipped: card.revealed }, `rarity-${card.rarity}`, `finish-${card.finish}`]" type="button" :aria-label="card.revealed ? `收起 ${card.name}` : `翻开第 ${index + 1} 张卡牌`" @click="flip(card)">
                <span class="card-face card-face--back"><b>R</b><i>RIFTBOUND</i><small>{{ String(index + 1).padStart(2, '0') }}</small></span>
                <span class="card-face card-face--front">
                  <CarddexImage :src="card.imageUrl" :fallback="card.fallbackUrl" :alt="card.name" :eager="index < 3" />
                  <span v-if="!card.revealed" class="card-caption"><b>{{ card.name }}</b><small>{{ card.cardNo }} · {{ cardFinishLabel(card) }}</small></span>
                  <span v-if="!card.revealed" class="slot-label">{{ card.slot }}</span>
                </span>
              </button>
            </div>
            <div class="pack-actions">
              <span>{{ currentPack.cards.filter((card) => card.revealed).length }} / {{ currentPack.cards.length }} 张已翻开</span>
              <button class="subtle-action" type="button" :disabled="currentPackRevealed" @click="flipAll(currentPack)">一次全部翻开</button>
              <button v-if="activeRecord.kind === 'box' && activeRecord.status === 'inProgress'" class="next-pack-button" type="button" :disabled="!currentPackRevealed" @click="nextPack">
                {{ activeRecord.packs.length >= BOX_SIZE ? '本盒已开完' : `开下一包 · ${String(activeRecord.packs.length + 1).padStart(2, '0')}` }} <span>→</span>
              </button>
              <button v-else-if="activeRecord.kind === 'pack'" class="next-pack-button" type="button" @click="activeRecordId = ''; startOpening()">再开一包 <span>→</span></button>
              <span v-else class="complete-label">本盒已开完</span>
            </div>
            <p v-if="notice" class="booster-notice" role="alert">{{ notice }}</p>
          </div>

          <section v-if="currentBoxSummary" class="box-summary">
            <div class="summary-heading"><div><p class="booster-kicker">BOX CONTENTS</p><h2>整盒汇总</h2></div><span>{{ currentBoxSummary.total }} 张牌</span></div>
            <div class="summary-metrics">
              <div><b>{{ currentBoxSummary.uniqueCards }}</b><span>种不同卡牌</span></div>
              <div><b>{{ currentBoxSummary.duplicateCopies }}</b><span>重复张数</span></div>
              <div><b>{{ currentBoxSummary.signature }}</b><span>Signature</span></div>
              <div><b>{{ currentBoxSummary.ultimate }}</b><span>Ultimate</span></div>
            </div>
            <div class="summary-rarities"><span>普通 <b>{{ currentBoxSummary.common }}</b></span><span>不凡 <b>{{ currentBoxSummary.uncommon }}</b></span><span>稀有 <b>{{ currentBoxSummary.rare }}</b></span><span>史诗 <b>{{ currentBoxSummary.epic }}</b></span><span>异画 <b>{{ currentBoxSummary.alt }}</b></span><span>超编 <b>{{ currentBoxSummary.overnumber }}</b></span><span>Token／符文 <b>{{ currentBoxSummary.tokenRune }}</b></span></div>
          </section>
        </section>
      </template>
      <p v-if="storageError" class="storage-warning" role="alert">{{ storageError }}</p>
    </section>

    <section v-else class="history-page">
      <div class="history-heading"><div><p class="booster-kicker">LOCAL OPENING LOG</p><h2>本地开包记录</h2><p>记录只保存在当前浏览器中，可逐盒回看每一包和每张卡。</p></div>
        <button v-if="records.length" type="button" class="delete-all-button" @click="clearPrompt = !clearPrompt">清空记录</button>
      </div>
      <div v-if="clearPrompt" class="clear-confirm" role="alert"><span>确定删除全部 {{ records.length }} 条本地记录？</span><button type="button" @click="clearHistory">确认清空</button><button type="button" @click="clearPrompt = false">取消</button></div>
      <div v-if="!records.length" class="history-empty"><span>◇</span><h3>还没有开包记录</h3><p>开出第一包后，系列、时间和逐张卡牌都会保存在这里。</p><button class="text-action" type="button" @click="activePage = 'open'">去开一包 →</button></div>
      <div v-else class="history-list">
        <article v-for="record in records" :key="record.id" class="history-record">
          <header class="history-record__head">
            <button type="button" class="history-expand" :aria-expanded="expandedRecords.includes(record.id)" @click="toggleHistory(record.id)">
              <span class="history-chevron">{{ expandedRecords.includes(record.id) ? '⌄' : '›' }}</span>
              <span class="history-set">{{ record.series }}</span><span>{{ setName(record.series) }} · {{ record.kind === 'box' ? '整盒' : '单包' }}</span>
              <span class="history-summary">{{ recordSummary(record) }}</span><time>{{ formatTime(record.createdAt) }}</time>
              <i class="record-status" :class="{ pending: record.status === 'inProgress' }">{{ statusName(record) }}</i>
            </button>
            <button class="delete-record" type="button" :aria-label="`删除 ${record.series} 开包记录`" @click="deleteRecord(record.id)">×</button>
          </header>
          <div v-if="expandedRecords.includes(record.id)" class="history-detail">
            <div v-if="record.kind === 'box'" class="history-box-summary">
              <span><b>{{ summarize(record.packs).total }}</b> 张卡</span>
              <span><b>{{ summarize(record.packs).uniqueCards }}</b> 种不同卡牌</span>
              <span><b>{{ summarize(record.packs).duplicateCopies }}</b> 张重复</span>
              <span><b>{{ summarize(record.packs).signature }}</b> 张 Signature</span>
              <span><b>{{ summarize(record.packs).ultimate }}</b> 张 Ultimate</span>
            </div>
            <section v-for="pack in record.packs" :key="`${record.id}-${pack.packNumber}`" class="history-pack">
              <header><strong>{{ record.kind === 'box' ? `第 ${pack.packNumber} 包` : '单包结果' }}</strong><time>{{ formatTime(pack.openedAt) }}</time></header>
              <div class="history-cards">
                <div v-for="(card, index) in pack.cards" :key="`${card.key}-${index}`" class="history-card">
                  <CarddexImage :src="card.imageUrl" :fallback="card.fallbackUrl" :alt="card.name" />
                  <b>{{ card.name }}</b><small>{{ card.cardNo }}</small><small>{{ card.slot }} · {{ cardFinishLabel(card) }}</small>
                </div>
              </div>
            </section>
            <button v-if="record.status === 'inProgress'" class="resume-record" type="button" @click="openRecoveredBox">继续这盒 →</button>
          </div>
        </article>
      </div>
      <p v-if="storageError" class="storage-warning" role="alert">{{ storageError }}</p>
    </section>
    <footer class="booster-footer"><span>概率仅供娱乐，不代表官方公布出率。</span><span>RIFTBOUND · COLLECTOR'S LOG</span></footer>
  </main>
</template>

<style scoped>
.booster-page { --pack-ink: #17252c; --pack-muted: #748078; --pack-line: #d9d6c9; --pack-paper: #f5f3ea; --pack-green: #2d6657; --pack-gold: #c1a36b; color: var(--color-text-primary); padding: clamp(20px, 4vw, 48px); background: var(--color-page-bg); }
.booster-masthead { display: flex; justify-content: space-between; align-items: center; gap: 24px; max-width: 1120px; margin: 0 auto 27px; padding: 6px 0 24px; border-bottom: 2px solid var(--pack-ink); }
.booster-kicker { margin: 0 0 7px; color: var(--pack-green); font: 700 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .19em; }
.booster-masthead h1 { margin: 0; color: var(--pack-ink); font: 800 clamp(34px, 5vw, 54px)/1.04 "Noto Serif SC", "Songti SC", serif; letter-spacing: -.045em; }
.booster-subtitle { margin: 10px 0 0; color: var(--pack-muted); font-size: 13px; }
.booster-stamp { display: flex; width: 70px; height: 70px; flex: none; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--pack-green); border-radius: 50%; color: var(--pack-green); transform: rotate(8deg); }
.booster-stamp span { font-size: 8px; letter-spacing: .08em; }.booster-stamp b { font: 900 24px/1.15 "Noto Serif SC", "Songti SC", serif; }
.booster-tabs { position: relative; display: flex; max-width: 1120px; gap: 22px; margin: 0 auto 24px; border-bottom: 1px solid var(--pack-line); }
.booster-tabs > button { position: relative; border: 0; padding: 10px 3px 12px; background: transparent; color: var(--pack-muted); font-size: 12px; cursor: pointer; }
.booster-tabs > button.selected { color: var(--pack-ink); font-weight: 800; }.booster-tabs > button.selected::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--pack-green); content: ""; }
.booster-tabs > button span { margin-left: 5px; color: var(--pack-green); font: 11px ui-monospace, monospace; }.booster-tabs__rule { flex: 1; }
.open-workspace, .history-page { max-width: 1120px; margin: 0 auto; }
.booster-state { display: flex; min-height: 260px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--pack-muted); font-size: 13px; }
.booster-state--error { color: #9b4938; }.booster-state--error p { margin: 0; }.state-spinner { width: 21px; height: 21px; border: 2px solid var(--pack-line); border-top-color: var(--pack-green); border-radius: 50%; animation: spin 850ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.sealed-panel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(210px, 300px); min-height: 430px; border: 1px solid var(--pack-line); background: var(--pack-paper); }
.sealed-panel__controls { display: flex; flex-direction: column; padding: clamp(20px, 4vw, 42px); }
.field-block + .field-block { margin-top: 25px; }.field-label { display: block; margin-bottom: 11px; color: var(--pack-muted); font-size: 10px; font-weight: 700; letter-spacing: .11em; }
.set-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.set-options button { min-height: 65px; border: 1px solid var(--pack-line); padding: 10px 7px; background: transparent; color: var(--pack-ink); text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
.set-options button.selected { border-color: var(--pack-green); background: rgba(45, 102, 87, .07); box-shadow: inset 0 -2px var(--pack-green); }
.set-options strong, .set-options small { display: block; }.set-options strong { font: 800 13px ui-monospace, monospace; }.set-options small { margin-top: 5px; color: var(--pack-muted); font-size: 9px; }
.kind-options { display: flex; width: min(100%, 300px); border: 1px solid var(--pack-line); }.kind-options button { flex: 1; border: 0; padding: 10px 12px; background: transparent; color: var(--pack-muted); font-size: 12px; cursor: pointer; }.kind-options button + button { border-left: 1px solid var(--pack-line); }.kind-options button.selected { background: var(--pack-ink); color: #f7f2e6; }.kind-options small { margin-left: 4px; opacity: .72; }
.resume-callout { display: flex; justify-content: space-between; gap: 12px; margin-top: 19px; border-left: 2px solid var(--pack-gold); padding: 9px 12px; background: rgba(193, 163, 107, .1); color: var(--pack-muted); font-size: 11px; }.resume-callout b { color: var(--pack-ink); }
.probability-note { display: flex; align-items: flex-start; gap: 10px; margin-top: auto; padding-top: 25px; }.probability-note p { margin: 0; color: var(--pack-muted); font-size: 10px; line-height: 1.75; }.probability-note strong { color: var(--pack-ink); }.note-seal { display: grid; width: 24px; height: 24px; flex: none; place-items: center; border: 1px solid var(--pack-gold); color: #8d7040; font: 12px "Noto Serif SC", serif; }
.open-sealed-button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: min(100%, 340px); min-height: 48px; margin-top: 24px; border: 0; padding: 0 16px; background: var(--pack-green); color: white; font-size: 13px; font-weight: 800; cursor: pointer; transition: background .15s, transform .15s; }.open-sealed-button:hover:not(:disabled) { background: #214e43; transform: translateY(-1px); }.open-sealed-button:disabled { opacity: .42; cursor: not-allowed; }.open-sealed-button__icon { color: #f0d99f; }
.sealed-art { position: relative; display: grid; min-height: 360px; place-items: center; overflow: hidden; background: #1a282b; }.sealed-art::before, .sealed-art::after { position: absolute; width: 320px; height: 320px; border: 1px solid rgba(214, 188, 129, .25); border-radius: 50%; content: ""; }.sealed-art::after { width: 250px; height: 250px; }.wrapper-seal { z-index: 1; display: flex; width: 160px; height: 240px; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(240, 217, 159, .68); outline: 7px solid rgba(220, 205, 167, .09); background: linear-gradient(145deg, #264d47, #17342f 55%, #142a31); color: #f3e8cc; box-shadow: 0 22px 50px rgba(0, 0, 0, .4); transform: rotate(-5deg); }.wrapper-seal::before, .wrapper-seal::after { position: absolute; right: 10px; left: 10px; height: 3px; border-top: 1px solid rgba(240, 217, 159, .4); border-bottom: 1px solid rgba(240, 217, 159, .4); content: ""; }.wrapper-seal::before { top: 12px; }.wrapper-seal::after { bottom: 12px; }.wrapper-seal span { font: 700 8px ui-monospace, monospace; letter-spacing: .24em; }.wrapper-seal b { margin: 21px 0 4px; color: #e0c486; font: 900 43px/1 ui-monospace, monospace; letter-spacing: -.09em; }.wrapper-seal small { font: 8px ui-monospace, monospace; letter-spacing: .22em; }.wrapper-shine { position: absolute; top: 6%; left: 0; width: 170%; height: 30%; background: linear-gradient(105deg, transparent 25%, rgba(255,255,255,.12), transparent 63%); transform: rotate(-27deg); }.wrapper-notch { position: absolute; bottom: 15px; right: 17px; width: 31px; height: 31px; border: 1px solid rgba(240, 217, 159, .4); border-radius: 50%; }.wrapper-notch::after { position: absolute; top: 8px; left: 8px; width: 13px; height: 13px; border: 1px solid rgba(240, 217, 159, .4); border-radius: 50%; content: ""; }
.booster-notice { margin: 12px 0 0; color: #a34737; font-size: 12px; }.text-action { border: 0; padding: 0; background: transparent; color: var(--pack-green); font-size: 11px; font-weight: 700; cursor: pointer; }.text-action:hover { text-decoration: underline; }
.opening-toolbar { display: flex; align-items: center; gap: 20px; border-bottom: 1px solid var(--pack-line); padding: 3px 0 14px; }.opening-identity { display: flex; align-items: baseline; gap: 8px; }.opening-identity b { color: var(--pack-ink); font: 800 14px ui-monospace, monospace; }.opening-identity span, .opening-toolbar time { color: var(--pack-muted); font-size: 10px; }.opening-identity i { border: 1px solid var(--pack-line); padding: 2px 6px; color: var(--pack-green); font-size: 9px; font-style: normal; }.opening-toolbar time { margin-left: auto; }
.pack-progress { margin: 18px 0 24px; }.pack-progress > div:first-child { display: flex; justify-content: space-between; color: var(--pack-muted); font-size: 10px; }.pack-progress strong { color: var(--pack-ink); font: 700 12px ui-monospace, monospace; }.progress-pips { display: grid; grid-template-columns: repeat(24, 1fr); gap: 4px; margin-top: 8px; }.progress-pips i { height: 3px; background: var(--pack-line); }.progress-pips i.filled { background: #8ca79b; }.progress-pips i.current { background: var(--pack-green); }
.pack-open-card { border: 1px solid var(--pack-line); padding: clamp(16px, 3vw, 28px); background: var(--pack-paper); }.pack-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }.pack-heading h2, .summary-heading h2, .history-heading h2 { margin: 0; color: var(--pack-ink); font: 800 24px/1.2 "Noto Serif SC", "Songti SC", serif; }.pack-heading time { color: var(--pack-muted); font-size: 10px; }
.cards-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }.opened-card { position: relative; aspect-ratio: 744 / 1040; min-width: 0; border: 0; padding: 0; background: transparent; perspective: 900px; cursor: pointer; }.opened-card:focus-visible { outline: 2px solid var(--pack-green); outline-offset: 3px; }.card-face { position: absolute; inset: 0; display: block; overflow: hidden; border: 1px solid #c9c4b3; background: #e9e5d9; backface-visibility: hidden; transition: transform .45s cubic-bezier(.2,.7,.2,1); }.card-face--back { display: flex; flex-direction: column; align-items: center; justify-content: center; border-color: #b39b64; background: repeating-linear-gradient(135deg, #243e3a 0 9px, #294741 9px 10px); color: #e7d6ad; box-shadow: inset 0 0 0 4px #213b37, inset 0 0 0 5px rgba(231, 214, 173, .62); }.card-face--back b { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid rgba(231,214,173,.8); border-radius: 50%; font: 700 20px/1 Georgia, serif; }.card-face--back i { margin-top: 10px; font: 7px ui-monospace, monospace; font-style: normal; letter-spacing: .16em; }.card-face--back small { position: absolute; bottom: 11px; font: 8px ui-monospace, monospace; opacity: .7; }.card-face--front { transform: rotateY(180deg); }.opened-card.flipped .card-face--back { transform: rotateY(-180deg); }.opened-card.flipped .card-face--front { transform: rotateY(0); }.card-caption { position: absolute; right: 0; bottom: 0; left: 0; display: block; padding: 22px 5px 5px; background: linear-gradient(transparent, rgba(14, 23, 23, .88)); color: white; text-align: left; }.card-caption b, .card-caption small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.card-caption b { font-size: 10px; }.card-caption small { margin-top: 3px; font-size: 8px; opacity: .78; }.slot-label { position: absolute; top: 4px; left: 4px; max-width: calc(100% - 8px); overflow: hidden; border: 1px solid rgba(255,255,255,.5); padding: 2px 4px; background: rgba(18, 32, 29, .78); color: white; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.finish-signature .card-face--front, .finish-ultimate .card-face--front { box-shadow: inset 0 0 0 3px #d8b761; }.finish-overnumber .card-face--front { box-shadow: inset 0 0 0 2px #b65b45; }
.pack-actions { display: flex; align-items: center; gap: 12px; margin-top: 17px; }.pack-actions > span:first-child { margin-right: auto; color: var(--pack-muted); font-size: 10px; }.subtle-action { border: 1px solid var(--pack-line); padding: 8px 11px; background: transparent; color: var(--pack-ink); font-size: 10px; cursor: pointer; }.subtle-action:disabled { opacity: .4; cursor: default; }.next-pack-button { border: 0; padding: 10px 14px; background: var(--pack-green); color: white; font-size: 11px; font-weight: 700; cursor: pointer; }.next-pack-button:disabled { opacity: .4; cursor: not-allowed; }.next-pack-button span { margin-left: 14px; }.complete-label { color: var(--pack-green); font-size: 11px; font-weight: 800; }
.box-summary { margin-top: 22px; border-top: 2px solid var(--pack-ink); border-bottom: 1px solid var(--pack-line); padding: 21px 0; }.summary-heading { display: flex; align-items: flex-end; justify-content: space-between; }.summary-heading > span { color: var(--pack-muted); font: 11px ui-monospace, monospace; }.summary-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin: 18px 0 14px; background: var(--pack-line); border: 1px solid var(--pack-line); }.summary-metrics div { display: flex; flex-direction: column; gap: 3px; padding: 12px; background: var(--color-page-bg); }.summary-metrics b { color: var(--pack-ink); font: 800 24px ui-monospace, monospace; }.summary-metrics span, .summary-rarities { color: var(--pack-muted); font-size: 10px; }.summary-rarities { display: flex; flex-wrap: wrap; gap: 7px 18px; }.summary-rarities b { margin-left: 4px; color: var(--pack-ink); font-family: ui-monospace, monospace; }
.history-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; border-bottom: 2px solid var(--pack-ink); padding-bottom: 16px; }.history-heading h2 { font-size: 27px; }.history-heading p:not(.booster-kicker) { margin: 7px 0 0; color: var(--pack-muted); font-size: 11px; }.delete-all-button, .delete-record { border: 1px solid var(--pack-line); padding: 7px 10px; background: transparent; color: var(--pack-muted); font-size: 10px; cursor: pointer; }.delete-all-button:hover, .delete-record:hover { border-color: #a34838; color: #a34838; }.clear-confirm { display: flex; align-items: center; gap: 12px; margin: 14px 0; border: 1px solid #d8b9a8; padding: 12px; background: #fbf0e9; color: #773b30; font-size: 11px; }.clear-confirm span { margin-right: auto; }.clear-confirm button { border: 1px solid #d8b9a8; padding: 6px 9px; background: transparent; color: inherit; font-size: 10px; cursor: pointer; }
.history-empty { display: flex; min-height: 290px; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.history-empty > span { color: var(--pack-gold); font: 40px Georgia, serif; }.history-empty h3 { margin: 8px 0; color: var(--pack-ink); font: 700 18px "Noto Serif SC", "Songti SC", serif; }.history-empty p { color: var(--pack-muted); font-size: 11px; }.history-list { display: grid; gap: 9px; margin-top: 15px; }.history-record { border: 1px solid var(--pack-line); background: var(--pack-paper); }.history-record__head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }.history-expand { display: flex; min-width: 0; flex: 1; align-items: center; gap: 9px; border: 0; padding: 3px; background: transparent; color: var(--pack-muted); text-align: left; cursor: pointer; }.history-chevron { width: 14px; color: var(--pack-green); font: 20px/1 ui-monospace, monospace; }.history-set { color: var(--pack-ink); font: 800 12px ui-monospace, monospace; }.history-summary { margin-left: auto; color: var(--pack-ink); font-size: 10px; }.history-expand time { color: var(--pack-muted); font-size: 9px; white-space: nowrap; }.record-status { border: 1px solid #8eaa98; padding: 3px 6px; color: var(--pack-green); font-size: 8px; font-style: normal; white-space: nowrap; }.record-status.pending { border-color: var(--pack-gold); color: #8d7040; }.delete-record { border: 0; font-size: 17px; line-height: 1; }.history-detail { border-top: 1px solid var(--pack-line); padding: 16px; }.history-box-summary { display: flex; flex-wrap: wrap; gap: 8px 17px; border-bottom: 1px solid var(--pack-line); padding-bottom: 12px; color: var(--pack-muted); font-size: 9px; }.history-box-summary b { color: var(--pack-ink); font: 700 11px ui-monospace, monospace; }.history-pack + .history-pack { margin-top: 20px; border-top: 1px solid var(--pack-line); padding-top: 14px; }.history-pack > header { display: flex; justify-content: space-between; margin-bottom: 9px; color: var(--pack-ink); font-size: 10px; }.history-pack > header time { color: var(--pack-muted); font-weight: 400; }.history-cards { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }.history-card { min-width: 0; }.history-card :deep(.carddex-image) { border: 1px solid var(--pack-line); }.history-card > b, .history-card > small { display: block; overflow: hidden; margin-top: 4px; color: var(--pack-ink); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.history-card > small { color: var(--pack-muted); font-size: 8px; }.resume-record { margin-top: 15px; border: 0; padding: 8px 11px; background: var(--pack-green); color: white; font-size: 10px; cursor: pointer; }.storage-warning { margin: 12px auto 0; color: #9b4938; font-size: 11px; text-align: center; }
.booster-footer { display: flex; justify-content: space-between; gap: 12px; max-width: 1120px; margin: 35px auto 0; border-top: 1px solid var(--pack-line); padding-top: 11px; color: var(--pack-muted); font: 8px ui-monospace, monospace; letter-spacing: .07em; }.booster-footer span:first-child { font-family: inherit; letter-spacing: 0; }
@media (max-width: 800px) { .sealed-panel { grid-template-columns: minmax(0, 1fr) 210px; }.cards-grid, .history-cards { grid-template-columns: repeat(5, minmax(0, 1fr)); }.history-summary { display: none; } }
@media (max-width: 620px) { .booster-page { padding: 17px 13px 28px; }.booster-stamp { width: 55px; height: 55px; }.booster-stamp b { font-size: 19px; }.sealed-panel { grid-template-columns: 1fr; }.sealed-art { min-height: 205px; }.wrapper-seal { width: 105px; height: 155px; }.wrapper-seal b { margin-top: 12px; font-size: 29px; }.wrapper-seal span { font-size: 6px; }.wrapper-seal small { font-size: 6px; }.cards-grid, .history-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }.pack-actions { flex-wrap: wrap; }.pack-actions > span:first-child { width: 100%; }.next-pack-button { margin-left: auto; }.history-expand { flex-wrap: wrap; gap: 5px 8px; }.history-expand time { order: 3; }.record-status { margin-left: auto; }.summary-metrics { grid-template-columns: repeat(2, 1fr); }.opening-toolbar { flex-wrap: wrap; gap: 7px 13px; }.opening-toolbar time { width: 100%; margin-left: 0; }.progress-pips { gap: 2px; }.booster-footer { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
</style>
