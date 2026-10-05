<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ArrowLeft, Plus, Search, SlidersHorizontal, Share2, Save, Library, BarChart3, Maximize2, Minimize2 } from '@lucide/vue';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import { authState, isEditorialAdmin } from '@/tools/sources/auth';
import { readSupabaseConfig } from '@/tools/sources/config';
import { buildDisplayCards, DEFAULT_QUERY, facetOptions, numericBounds } from '@/components/carddex/query';
import CardEffectText from '@/components/carddex/CardEffectText.vue';
import type { CardRecord, CardPrint, CarddexQueryState, SortField } from '@/components/carddex/types';
import CarddexImage from '@/components/carddex/CarddexImage.vue';
import CarddexFilters from '@/components/carddex/CarddexFilters.vue';
import BuilderModal from '@/components/deckbuilder/BuilderModal.vue';
import DeckEntryView from '@/components/deckbuilder/DeckEntry.vue';
import ShareDeck from '@/components/deckbuilder/ShareDeck.vue';
import { useBuilderCatalog } from '@/tools/deckbuilder/catalog';
import { ZONES, LABELS, LIMITS, newDeck, copyDeck, cloneDeck, countZone, countDeck, entryKey, fullName, resolveEntry, entryFromRecord, addEntry, setQuantity, moveEntry, changePrint, hasNeeko, kind, matchesZone, type BuilderDeck, type DeckEntry, type Zone } from '@/tools/deckbuilder/model';
import { validateDeck } from '@/tools/deckbuilder/model';
import { readLibrary, listLocal, saveDraft, saveLocal, clearDraft, deleteLocal } from '@/tools/deckbuilder/storage';
import { cloudIdentity, listCloud, loadCloud, saveCloud, deleteCloud, type CloudDeck } from '@/tools/deckbuilder/cloud';
import { decodeSnapshot, importAny } from '@/tools/deckbuilder/formats';

const assetBase = import.meta.env.BASE_URL;
const { records, index, icons, loading: catalogLoading, sourceNote, reload } = useBuilderCatalog();
const deck = ref<BuilderDeck | null>(null), locals = ref<BuilderDeck[]>([]), clouds = ref<CloudDeck[]>([]);
const tab = ref<'local'|'cloud'>('local'), librarySearch = ref(''), librarySort = ref('updated');
const busy = ref(false), error = ref(''), status = ref(''), baseline = ref(''), draftScope = ref('');
const loadedEditable = ref(false);
const cloudRow = ref<CloudDeck | null>(null), owner = ref(''), recovered = ref(false);
const page = computed(() => store.currentBuilderPage), readonly = computed(() => page.value === 'share');
const inWorkspace = computed(() => page.value !== 'library');
const fingerprint = (d: BuilderDeck): string => JSON.stringify([d.name, d.description, d.zones]);
const dirty = computed(() => Boolean(deck.value && (!deck.value.savedAt || fingerprint(deck.value) !== baseline.value)));
const problems = computed(() => deck.value ? validateDeck(deck.value, index.value) : []);
const neeko = computed(() => Boolean(deck.value && hasNeeko(deck.value, index.value)));
const visibleZones = computed(() => ZONES.filter(z => z !== 'additional' || neeko.value || deck.value?.zones.additional.length));
const zone = ref<Zone>('legend'), graphic = ref(false), expanded = ref<''|'pool'|'deck'>('');
const visualHeight = ref<number|null>(null);
const panel = ref<HTMLElement>(), mobile = ref(false), horizontalRatio = ref(50), verticalRatio = ref(46);
const ratio = computed(() => mobile.value ? verticalRatio.value : horizontalRatio.value);
const layoutStyle = computed(() => ({ '--pool-size': `${ratio.value}fr`, '--deck-size': `${100-ratio.value}fr` }));
const query = reactive<CarddexQueryState>(JSON.parse(JSON.stringify(DEFAULT_QUERY)) as CarddexQueryState);
query.banned = 'all';
const recommended = ref(true), zoneRestricted = ref(true), poolLimit = ref(60), sortField = ref<SortField>('cardNo');
const filterSections = reactive<Record<string, boolean>>({});
const showFilters = ref(false), showShare = ref(false), showStats = ref(false), includeSide = ref(false), showNotes = ref(false);
const importOpen = ref(false), importRaw = ref(''), importPreview = ref<BuilderDeck | null>(null), importNote = ref(''), importError = ref(''), parsing = ref(false);
const editingAction = ref<{ type:'rename'|'delete'; deck:BuilderDeck; cloud:CloudDeck|null } | null>(null), renameValue = ref('');
const detail = ref<{ entry:DeckEntry; zone:Zone|null; context:'deck'|'pool'|'import' } | null>(null), detailPrint = ref<CardPrint | null>(null), matchSearch = ref('');
const detailRecord = computed(() => detail.value ? resolveEntry(detail.value.entry, index.value).record : null);
const scRecords = computed(() => records.value
  .map(record => ({ ...record, prints: record.prints.filter(print => print.language === 'SC') }))
  .filter(record => record.prints.length));
const detailPrints = computed(() => detailRecord.value?.prints.filter(print => print.language === 'SC') ?? []);
const matchResults = computed(() => matchSearch.value.trim() ? buildDisplayCards(scRecords.value, {...query, search:matchSearch.value, filters:[], numeric:DEFAULT_QUERY.numeric, banned:'all'}).slice(0,30) : []);
const poolRecords = computed(() => {
  const legend = deck.value?.zones.legend[0] ? resolveEntry(deck.value.zones.legend[0], index.value).record : null;
  return scRecords.value.filter(r => {
    if (zoneRestricted.value && !matchesZone(r,zone.value)) return false;
    if (!recommended.value || !legend || !['champion','main','side','rune'].includes(zone.value)) return true;
    if (r.base.colors.some(c => c !== 'colorless' && c !== 'neutral' && !legend.base.colors.includes(c))) return false;
    return zone.value !== 'champion' || !legend.base.championTag || legend.base.championTag === r.base.championTag;
  });
});
const pool = computed(() => buildDisplayCards(poolRecords.value,query));
const poolVisible = computed(() => pool.value.slice(0,poolLimit.value));
const options = computed(() => facetOptions(scRecords.value,query.mode));
const bounds = computed(() => numericBounds(scRecords.value));
const poolQuantities = computed(() => {
  const counts=new Map<string,number>();
  for(const z of ZONES)for(const e of deck.value?.zones[z]??[])counts.set(e.cardNo.toUpperCase(),(counts.get(e.cardNo.toUpperCase())??0)+e.quantity);
  return counts;
});
const libraryItems = computed(() => {
  const list = (tab.value==='local' ? locals.value : clouds.value.map(r=>r.document)).filter(d=>`${d.name} ${d.description}`.toLowerCase().includes(librarySearch.value.trim().toLowerCase()));
  return [...list].sort((a,b)=>librarySort.value==='name' ? a.name.localeCompare(b.name,'zh-CN') : b.updatedAt.localeCompare(a.updatedAt));
});
const stats = computed(() => {
  const costs = new Map<string,number>(), colors = new Map<string,number>(), types = new Map<string,number>();
  for (const z of includeSide.value ? ['champion','main','side'] as const : ['champion','main'] as const) for (const e of deck.value?.zones[z] ?? []) {
    const r=resolveEntry(e,index.value).record;
    const cost=r?.base.energy==null?'?':String(r.base.energy), type=r?kind(r):'未识别';
    costs.set(cost,(costs.get(cost)??0)+e.quantity); types.set(type,(types.get(type)??0)+e.quantity);
    for (const color of r?.base.colors.length ? r.base.colors : ['colorless']) colors.set(color,(colors.get(color)??0)+e.quantity);
  }
  return { costs:[...costs].sort((a,b)=>Number(a[0])-Number(b[0])), colors:[...colors], types:[...types], maximum:Math.max(1,...costs.values()) };
});
let timer: ReturnType<typeof setTimeout>|undefined, routeEpoch=0, importEpoch=0;
const message = (e:unknown):string => e instanceof Error ? e.message : String(e);
function refreshLibrary():void { try { locals.value=listLocal(); } catch(e) { error.value=message(e); } }
function flush():void {
  if(timer) clearTimeout(timer); timer=undefined;
  if(!deck.value || !loadedEditable.value || !draftScope.value || !dirty.value) return;
  try { deck.value.updatedAt=new Date().toISOString(); saveDraft(deck.value,draftScope.value); status.value='草稿已存于本机'; }
  catch(e) { error.value=message(e); status.value='草稿保存失败'; }
}
watch(() => deck.value ? fingerprint(deck.value) : '', () => {
  if (!deck.value || readonly.value || !draftScope.value || !dirty.value) return;
  status.value='正在保存草稿…'; if(timer) clearTimeout(timer); timer=setTimeout(flush,350);
});
watch([()=>JSON.stringify(query),zone,recommended,zoneRestricted],()=>{poolLimit.value=60;});
watch(sortField,field=>{query.sort=[{id:'builder-sort',field,asc:true}];});
function routeLibrary():void { flush(); navigate({view:'builder'}); }
function openDeck(id:string,scope:'local'|'cloud'='local'):void { flush(); navigate({view:'builder',builderPage:scope==='cloud'?'cloud':'edit',builderId:id}); }
function create():void { try { const next=newDeck(); saveDraft(next); openDeck(next.id); } catch(e){error.value=message(e);} }
async function loadRoute():Promise<void> {
  flush(); const epoch=++routeEpoch; loadedEditable.value=false; deck.value=null; draftScope.value=''; baseline.value=''; cloudRow.value=null; recovered.value=false; error.value=''; status.value=''; zone.value='legend'; expanded.value=''; detail.value=null;showShare.value=false;showStats.value=false;showNotes.value=false;
  if(page.value==='library') {refreshLibrary();busy.value=false;return;}
  busy.value=true;
  try {
    if(page.value==='share') {const next=await decodeSnapshot(store.currentBuilderSnapshot);if(epoch===routeEpoch)deck.value=next;return;}
    let saved:BuilderDeck|undefined,scope='';
    if(page.value==='cloud') {
      const who=await cloudIdentity(); const row=await loadCloud(store.currentBuilderId,who);
      if(epoch!==routeEpoch || !isEditorialAdmin.value)return;
      owner.value=who;cloudRow.value=row;saved=row.document;scope=`cloud:${readSupabaseConfig()?.url}:${who}:${row.id}`;
    } else {saved=readLibrary().decks.find(d=>d.id===store.currentBuilderId);scope=`local:${store.currentBuilderId}`;}
    const draft=readLibrary().drafts[scope];
    if(!saved&&!draft) throw new Error('找不到这个卡组。请返回卡组库，或导入分享内容。');
    if(epoch!==routeEpoch)return;
    baseline.value=saved?fingerprint(saved):'';deck.value=cloneDeck(draft??saved!);draftScope.value=scope;loadedEditable.value=true;recovered.value=Boolean(draft);status.value=draft?'已恢复本机草稿':'已载入正式卡组';
  } catch(e){if(epoch===routeEpoch)error.value=message(e);}
  finally{if(epoch===routeEpoch)busy.value=false;}
}
watch([()=>store.currentBuilderPage,()=>store.currentBuilderId,()=>store.currentBuilderSnapshot],()=>{void loadRoute();},{immediate:true});
async function refreshCloud():Promise<void> {
  const epoch=routeEpoch,account=authState.session?.email;busy.value=true;error.value='';
  try{const who=await cloudIdentity();const rows=await listCloud(who);if(epoch===routeEpoch&&isEditorialAdmin.value&&account===authState.session?.email){owner.value=who;clouds.value=rows;}}
  catch(e){error.value=`云端卡组库暂不可用：${message(e)}`;}
  finally{busy.value=false;}
}
watch(tab,value=>{if(value==='cloud')void refreshCloud();else refreshLibrary();});
watch([isEditorialAdmin,()=>authState.session?.email],()=>{
  clouds.value=[];owner.value='';
  if(page.value==='cloud'){
    if(isEditorialAdmin.value)void loadRoute();
    else {flush();routeEpoch++;deck.value=null;draftScope.value='';cloudRow.value=null;loadedEditable.value=false;busy.value=authState.status==='restoring';error.value=busy.value?'':'请先使用管理员账号登录，再打开云端卡组。';}
  }
  if(!isEditorialAdmin.value)tab.value='local';else if(tab.value==='cloud')void refreshCloud();
});
function mutate(next:BuilderDeck):void {if(readonly.value)return;deck.value=next;error.value='';}
function addCard(record:CardRecord,print:CardPrint|null):void {
  if(!deck.value)return;
  mutate(addEntry(deck.value,zone.value,entryFromRecord(record,print),true));
}
function selectZone(value:Zone):void {zone.value=value;}
function groups(z:Zone,d=deck.value):{label:string;entries:DeckEntry[]}[] {
  if(!d)return[];
  if(z!=='main')return[{label:'',entries:d.zones[z]}];
  return ['单位','法术','装备','其他'].map(type=>({label:type,entries:d.zones.main.filter(e=>{const r=resolveEntry(e,index.value).record;const t=r?kind(r):'其他';return (['单位','法术','装备'].includes(t)?t:'其他')===type;})})).filter(g=>g.entries.length);
}
function quantity(z:Zone,e:DeckEntry,n:number):void {if(deck.value)try{mutate(setQuantity(deck.value,z,entryKey(e),n));}catch(errorValue){error.value=message(errorValue);}}
function move(z:Zone,e:DeckEntry,to:Zone):void {if(deck.value)mutate(moveEntry(deck.value,z,to,entryKey(e)));}
function inspect(entry:DeckEntry,z:Zone|null,context:'deck'|'pool'|'import'='deck'):void {detail.value={entry:{...entry},zone:z,context};detailPrint.value=resolveEntry(entry,index.value).print;matchSearch.value='';}
function selectPrint(print:CardPrint,one=false):void {
  const info=detail.value,r=detailRecord.value;if(!info||!r)return;
  detailPrint.value=print;
  if(readonly.value)return;
  if(info.context==='pool'){addCard(r,print);detail.value=null;return;}
  const target=info.context==='import'?importPreview.value:deck.value;if(!target||!info.zone)return;
  const entry=target.zones[info.zone].find(e=>entryKey(e)===entryKey(info.entry));if(!entry)return;
  const next=one&&entry.quantity>1?addEntry(setQuantity(target,info.zone,entryKey(entry),entry.quantity-1),info.zone,entryFromRecord(r,print)):changePrint(target,info.zone,entryKey(entry),print);
  if(info.context==='import')importPreview.value=next;else mutate(next);detail.value=null;
}
function resolveUnknown(record:CardRecord,print:CardPrint|null):void {
  const info=detail.value;if(!info||!info.zone||readonly.value)return;const target=info.context==='import'?importPreview.value:deck.value;if(!target)return;
  const next=addEntry(setQuantity(target,info.zone,entryKey(info.entry),0),info.zone,entryFromRecord(record,print,info.entry.quantity));
  if(info.context==='import')importPreview.value=next;else mutate(next);detail.value=null;
}
async function save(scope:'local'|'cloud'='local',asNew=false):Promise<void> {
  if(!deck.value||readonly.value||busy.value)return;flush();const current=cloneDeck(deck.value),epoch=routeEpoch,account=authState.session?.email;busy.value=true;error.value='';
  try{
    if(scope==='local') {
      const next=page.value==='cloud'?copyDeck(current,current.name):current;const saved=saveLocal(next);
      if(epoch!==routeEpoch)return;
      if(page.value==='cloud')openDeck(saved.id);else{deck.value=saved;baseline.value=fingerprint(saved);recovered.value=false;status.value='已正式保存到本机';refreshLibrary();}
    }else{
      const who=await cloudIdentity();if(account!==authState.session?.email)throw new Error('登录账号已改变，请重新保存');
      const existing=page.value==='cloud'&&!asNew?cloudRow.value:null;
      if(existing&&existing.owner_id!==who)throw new Error('当前账号不拥有此卡组');
      const result=await saveCloud(current,who,existing);
      if(epoch!==routeEpoch||!isEditorialAdmin.value||account!==authState.session?.email)return;
      owner.value=who;
      if(existing){cloudRow.value=result;deck.value=result.document;baseline.value=fingerprint(result.document);clearDraft(draftScope.value);recovered.value=false;status.value='已正式保存到云端';}
      else openDeck(result.id,'cloud');
    }
  }catch(e){if(epoch===routeEpoch)error.value=message(e);}
  finally{if(epoch===routeEpoch)busy.value=false;}
}
function duplicate(d:BuilderDeck):void{try{const next=copyDeck(d);saveDraft(next);openDeck(next.id);}catch(e){error.value=message(e);}}
function restoreSaved():void {
  try{const saved=page.value==='cloud'?cloudRow.value?.document:readLibrary().decks.find(d=>d.id===deck.value?.id);if(!saved)return;if(timer)clearTimeout(timer);deck.value=cloneDeck(saved);baseline.value=fingerprint(saved);clearDraft(draftScope.value);recovered.value=false;status.value='已恢复正式保存的卡组';}catch(e){error.value=message(e);}
}
function libraryOpen(d:BuilderDeck):void{const row=tab.value==='cloud'?clouds.value.find(r=>r.document.id===d.id):null;if(tab.value==='cloud'&&!row)return;openDeck(row?.id??d.id,row?'cloud':'local');}
function action(type:'rename'|'delete',d:BuilderDeck):void{editingAction.value={type,deck:d,cloud:tab.value==='cloud'?clouds.value.find(r=>r.document.id===d.id)??null:null};renameValue.value=d.name;}
async function confirmAction():Promise<void>{
  const target=editingAction.value;if(!target||busy.value)return;busy.value=true;error.value='';
  try{if(target.cloud){const who=await cloudIdentity();if(target.type==='delete')await deleteCloud(target.cloud,who);else{const scope=`cloud:${readSupabaseConfig()?.url}:${who}:${target.cloud.id}`;const next=cloneDeck(target.deck);next.name=renameValue.value.trim()||'未命名卡组';await saveCloud(next,who,target.cloud);const draft=readLibrary().drafts[scope];if(draft){draft.name=next.name;saveDraft(draft,scope);}}await refreshCloud();}
    else{if(target.type==='delete')deleteLocal(target.deck.id);else{const lib=readLibrary(),draft=lib.drafts[`local:${target.deck.id}`];const next=cloneDeck(target.deck);next.name=renameValue.value.trim()||'未命名卡组';if(next.savedAt)saveLocal(next);else saveDraft(next);if(draft){draft.name=next.name;saveDraft(draft);}}refreshLibrary();}editingAction.value=null;
  }catch(e){error.value=message(e);}finally{busy.value=false;}
}
async function parseImport():Promise<void>{const epoch=++importEpoch;parsing.value=true;importError.value='';try{const parsed=await importAny(importRaw.value,index.value);if(epoch===importEpoch){importPreview.value=parsed.deck;importNote.value=parsed.note;}}catch(e){if(epoch===importEpoch)importError.value=message(e);}finally{if(epoch===importEpoch)parsing.value=false;}}
watch(importRaw,()=>{importEpoch++;importPreview.value=null;parsing.value=false;});
function acceptImport():void{if(!importPreview.value)return;try{const next=copyDeck(importPreview.value,importPreview.value.name);saveDraft(next);importOpen.value=false;openDeck(next.id);}catch(e){importError.value=message(e);}}
function previewMove(from:Zone,e:DeckEntry,to:Zone):void{if(importPreview.value)importPreview.value=moveEntry(importPreview.value,from,to,entryKey(e));}
function previewQuantity(z:Zone,e:DeckEntry,n:number):void{if(importPreview.value)try{importPreview.value=setQuantity(importPreview.value,z,entryKey(e),n);}catch(e){importError.value=message(e);}}
function drag(event:PointerEvent):void{if(!panel.value)return;const element=event.currentTarget as HTMLElement;element.setPointerCapture(event.pointerId);}
function dragMove(event:PointerEvent):void{const el=event.currentTarget as HTMLElement;if(!el.hasPointerCapture(event.pointerId)||!panel.value)return;const r=panel.value.getBoundingClientRect();setRatio(mobile.value?(event.clientY-r.top)/r.height*100:(event.clientX-r.left)/r.width*100);}
function setRatio(n:number):void{const clamped=Math.max(20,Math.min(80,n));if(mobile.value)verticalRatio.value=clamped;else horizontalRatio.value=clamped;}
function resizeKey(e:KeyboardEvent):void{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();setRatio(e.key==='Home'?50:ratio.value+(['ArrowLeft','ArrowUp'].includes(e.key)?-5:5));}}
function screen():void{mobile.value=window.innerWidth<=900;visualHeight.value=window.visualViewport?.height??window.innerHeight;}
function remember():void{try{localStorage.setItem('rune.deckbuilder.layout',JSON.stringify({graphic:graphic.value,horizontal:horizontalRatio.value,vertical:verticalRatio.value}));}catch{/* Layout is optional. */}}
onMounted(()=>{screen();window.addEventListener('resize',screen);window.visualViewport?.addEventListener('resize',screen);window.addEventListener('beforeunload',flush);window.addEventListener('storage',refreshLibrary);try{const prefs=JSON.parse(localStorage.getItem('rune.deckbuilder.layout')??'{}') as Record<string,unknown>;graphic.value=prefs.graphic===true;if(typeof prefs.horizontal==='number')horizontalRatio.value=Math.max(20,Math.min(80,prefs.horizontal));if(typeof prefs.vertical==='number')verticalRatio.value=Math.max(20,Math.min(80,prefs.vertical));}catch{/* Use defaults. */}});
watch([graphic,horizontalRatio,verticalRatio],remember);
onBeforeUnmount(()=>{flush();routeEpoch++;importEpoch++;window.removeEventListener('resize',screen);window.visualViewport?.removeEventListener('resize',screen);window.removeEventListener('beforeunload',flush);window.removeEventListener('storage',refreshLibrary);});
</script>

<template>
<div class="deck-builder" :class="{'is-workspace':inWorkspace}" :style="visualHeight?{'--builder-height':`${visualHeight}px`}:{}">
  <header class="builder-header">
    <button class="b-btn back-btn" aria-label="返回首页" @click="flush();navigate({view:'home'})"><ArrowLeft :size="18" /><span>符文档案</span></button>
    <div class="builder-brand"><small>DECK WORKSHOP</small><h1>构筑卡组</h1></div>
    <div class="header-actions"><button v-if="inWorkspace" class="b-btn" @click="routeLibrary"><Library :size="16" /><span>卡组库</span></button><button class="b-btn" @click="importOpen=true"><span>导入</span></button><button v-if="!inWorkspace" class="b-btn b-primary" @click="create"><Plus :size="16" />新建卡组</button></div>
  </header>
  <div v-if="error" class="builder-error" role="alert">{{ error }}<button v-if="inWorkspace&&!deck" class="b-btn" @click="routeLibrary">返回卡组库</button></div>
  <div v-if="!inWorkspace" class="builder-library">
    <div class="library-intro"><div><p class="eyebrow">YOUR COLLECTION</p><h2>我的卡组库</h2><p>把想法留在牌桌上。草稿自动记录，完成后手动保存。</p></div><span class="storage-note">本机卡组保存在当前浏览器</span></div>
    <div class="library-toolbar"><div class="b-tabs"><button class="b-btn" :class="{active:tab==='local'}" @click="tab='local'">本机卡组 <b>{{ locals.length }}</b></button><button v-if="isEditorialAdmin" class="b-btn" :class="{active:tab==='cloud'}" @click="tab='cloud'">我的云端卡组</button></div><label class="search-field"><Search :size="17"/><input v-model="librarySearch" aria-label="搜索卡组" placeholder="搜索卡组名称或说明" /></label><select v-model="librarySort" aria-label="卡组排序"><option value="updated">最近修改</option><option value="name">名称排序</option></select><button v-if="tab==='cloud'" class="b-btn" :disabled="busy" @click="refreshCloud">刷新</button></div>
    <p v-if="busy" class="b-hint" role="status">正在读取云端卡组…</p><p v-if="tab==='cloud'" class="b-hint">仅当前管理员可查看和修改自己的云端卡组。</p>
    <div class="library-grid"><article class="new-deck-tile"><span class="new-mark">＋</span><h3>开始一份新构筑</h3><p>选好传奇，从第一张牌开始。</p><button class="b-btn b-primary" @click="create">新建卡组</button></article>
      <article v-for="item in libraryItems" :key="item.id" class="library-deck"><button class="library-cover" :aria-label="`打开 ${item.name}`" @click="libraryOpen(item)"><CarddexImage v-if="item.zones.legend[0]" :src="resolveEntry(item.zones.legend[0],index).print?.imageUrl || ''" :fallback="resolveEntry(item.zones.legend[0],index).print?.ttsUrl || ''" :alt="item.name"/><span v-else class="cover-empty">符</span><span class="cover-count">主牌 {{countZone(item,'main')}} / 39</span></button><div class="library-deck-body"><button class="deck-title" @click="libraryOpen(item)"><h3>{{ item.name }}</h3></button><p>{{ item.description || '尚未填写说明' }}</p><div class="library-meta"><span>{{ item.savedAt?'已保存':'草稿' }}</span><time>{{new Date(item.updatedAt).toLocaleDateString('zh-CN')}}</time><span>{{ validateDeck(item,index).length }} 项问题</span></div><div class="library-item-actions"><button class="b-btn" @click="libraryOpen(item)">编辑</button><button class="b-btn" @click="duplicate(item)">复制</button><button class="b-btn" @click="action('rename',item)">改名</button><button class="b-btn danger" @click="action('delete',item)">删除</button></div></div></article>
    </div><p v-if="!libraryItems.length&&!busy" class="b-hint">{{librarySearch?'没有找到匹配的卡组。':'这里还没有卡组，也可以从赛事卡组复制，或粘贴卡组码导入。'}}</p>
  </div>
  <p v-else-if="busy&&!deck" class="workspace-loading">正在打开构筑…</p>
  <template v-else-if="deck">
    <div class="deck-toolbar"><div class="deck-name"><input v-if="!readonly" v-model="deck.name" aria-label="卡组名称" maxlength="200" placeholder="卡组名称"/><h2 v-else>{{deck.name}}</h2><span class="save-status" role="status">{{readonly?'分享快照 · 只读':`${page==='cloud'?'云端卡组':'本机构筑'} · ${status || (dirty?'尚未正式保存':'已保存')}`}}</span></div><div class="deck-toolbar-actions"><button class="b-btn" @click="showNotes=true">说明</button><button class="b-btn" @click="showStats=true"><BarChart3 :size="16"/><span>统计</span></button><button class="b-btn" @click="showShare=true"><Share2 :size="16"/><span>分享</span></button><template v-if="!readonly"><button class="b-btn b-primary" :disabled="busy" @click="save(page==='cloud'?'cloud':'local')"><Save :size="16"/>保存{{page==='cloud'?'云端':'本机'}}</button><details class="save-menu"><summary class="b-btn" aria-label="其他保存操作">⋯</summary><div><button v-if="isEditorialAdmin" @click="save('cloud',true)">{{page==='cloud'?'云端另存为新卡组':'保存到云端'}}</button><button v-if="page==='cloud'" @click="save('local')">复制保存到本机</button><button @click="duplicate(deck)">复制为新卡组</button></div></details></template><button v-else class="b-btn b-primary" @click="duplicate(deck)">复制到我的卡组库</button></div></div>
    <div v-if="recovered&&!readonly" class="draft-banner"><span>{{page==='cloud'&&cloudRow&&deck.savedAt!==cloudRow.document.savedAt?'已恢复草稿；云端正式内容已有更新，保存会覆盖当前正式内容。':'已恢复上次未正式保存的草稿。'}}</span><button v-if="deck.savedAt" class="b-btn" @click="restoreSaved">恢复正式保存内容</button></div>
    <div v-if="readonly" class="shared-note">这是一份分享时的独立快照。{{deck.description}}</div>
    <div ref="panel" class="builder-panels" :class="{'read-only':readonly,'expand-pool':expanded==='pool','expand-deck':expanded==='deck'}" :style="layoutStyle">
      <section v-if="!readonly" class="pool-panel" aria-label="卡池">
        <div class="panel-title"><h2>卡池 <small>{{pool.length}} 张</small></h2><span class="zone-destination">加入 → {{LABELS[zone]}}</span><button class="b-btn icon-btn" :aria-label="expanded==='pool'?'恢复分屏':'展开卡池'" @click="expanded=expanded==='pool'?'':'pool'"><Minimize2 v-if="expanded==='pool'" :size="16"/><Maximize2 v-else :size="16"/></button></div>
        <div class="zone-tabs"><button v-for="z in visibleZones" :key="z" :class="{active:zone===z,warning:countZone(deck,z)>LIMITS[z]}" @click="selectZone(z)"><span>{{LABELS[z]}}</span><b>{{countZone(deck,z)}}<small>/{{LIMITS[z]}}</small></b></button></div>
        <div class="pool-search"><label class="search-field"><Search :size="17"/><input v-model="query.search" aria-label="搜索卡牌" placeholder="卡名、编号、效果或英雄…" /></label><button class="b-btn" @click="showFilters=true"><SlidersHorizontal :size="16"/><span>筛选{{query.filters.length?` ${query.filters.length}`:''}}</span></button><select v-model="sortField" aria-label="卡池排序"><option value="cardNo">编号</option><option value="energy">费用</option><option value="name">名称</option><option value="color">颜色</option><option value="category">类型</option></select></div>
        <div class="pool-settings"><label><input v-model="zoneRestricted" type="checkbox"/>分区类型</label><label><input v-model="recommended" type="checkbox"/>传奇颜色／英雄</label><select v-model="query.mode" aria-label="卡池印版模式"><option value="base">基础卡</option><option value="print">全部印版</option></select><select v-model="query.banned" aria-label="禁卡筛选"><option value="all">包含禁卡</option><option value="hide">隐藏禁卡</option><option value="only">只看禁卡</option></select></div>
        <div class="pool-scroll"><p v-if="catalogLoading" class="b-hint">正在载入卡表…</p><div class="pool-grid"><article v-for="card in poolVisible" :key="card.key" class="pool-card" :data-card="card.base.cardNo"><button class="pool-card-art" :aria-label="`加入 ${card.base.nameCn || card.base.nameEn} 到${LABELS[zone]}`" @click="addCard(index.get(card.base.cardNo.toUpperCase())!,card.print)"><CarddexImage :src="card.print?.imageUrl || ''" :fallback="card.print?.ttsUrl || ''" :alt="card.base.nameCn || card.base.nameEn" :landscape="card.base.categories.includes('战场')"/><span v-if="poolQuantities.get(card.base.cardNo.toUpperCase())" class="pool-owned">已选 {{poolQuantities.get(card.base.cardNo.toUpperCase())}}</span><span class="pool-add">＋</span><span v-if="card.base.banned" class="pool-banned">禁卡</span></button><button class="pool-card-label" @click="inspect(entryFromRecord(index.get(card.base.cardNo.toUpperCase())!,card.print),null,'pool')"><strong>{{card.base.nameCn||card.base.nameEn}}<span v-if="card.base.subtitleCn"> · {{card.base.subtitleCn}}</span></strong></button></article></div><p v-if="!pool.length&&!catalogLoading" class="b-hint">暂无匹配卡牌。可以调整搜索、筛选，或关闭分区和传奇条件。</p><button v-if="poolVisible.length<pool.length" class="b-btn load-more" @click="poolLimit+=60">加载更多（{{poolVisible.length}} / {{pool.length}}）</button><p class="catalog-note">{{sourceNote}} <button @click="reload(true)">刷新卡表</button></p></div>
      </section>
      <div v-if="!readonly" class="panel-divider" role="separator" tabindex="0" aria-label="调整卡池与构筑区域大小" :aria-orientation="mobile?'horizontal':'vertical'" :aria-valuenow="Math.round(ratio)" aria-valuemin="20" aria-valuemax="80" @pointerdown.prevent="drag" @pointermove="dragMove" @keydown="resizeKey"><i/></div>
      <section class="deck-panel" aria-label="当前构筑">
        <div class="panel-title"><h2>{{readonly?'构筑清单':'当前构筑'}} <small>{{countDeck(deck)}} 张</small></h2><div class="b-tabs compact"><button class="b-btn" :class="{active:!graphic}" @click="graphic=false">文字</button><button class="b-btn" :class="{active:graphic}" @click="graphic=true">卡图</button></div><button v-if="!readonly" class="b-btn icon-btn" :aria-label="expanded==='deck'?'恢复分屏':'展开构筑'" @click="expanded=expanded==='deck'?'':'deck'"><Minimize2 v-if="expanded==='deck'" :size="16"/><Maximize2 v-else :size="16"/></button></div>
        <div class="deck-scroll"><section v-for="z in visibleZones" :key="z" class="deck-zone" :data-zone="z" :class="{selected:zone===z&&!readonly,inactive:z==='additional'&&!neeko,'identity-zone':!readonly&&(z==='legend'||z==='champion')}"><header><button :disabled="readonly" @click="zone=z"><h3>{{LABELS[z]}} <small>{{countZone(deck,z)}} / {{LIMITS[z]}}</small></h3></button><span v-if="z==='additional'&&!neeko" class="danger">需要妮蔻</span></header><p v-if="!deck.zones[z].length" class="zone-empty">{{readonly?'暂无卡牌':'从卡池添加卡牌'}}</p><p v-if="z==='additional'" class="zone-tip">任意分区含妮蔻时启用，最多 3 张，与主传奇及其他额外传奇不同名。</p><div v-for="group in groups(z)" :key="group.label"><h4 v-if="group.label">{{group.label}} <small>{{group.entries.reduce((n,e)=>n+e.quantity,0)}}</small></h4><div class="deck-entries" :class="{'graphic-entries':graphic}"><DeckEntryView v-for="entry in group.entries" :key="entryKey(entry)" :entry="entry" :zone="z" :index="index" :graphic="graphic" :readonly="readonly" :additional-enabled="neeko" @quantity="quantity(z,entry,$event)" @move="move(z,entry,$event)" @remove="quantity(z,entry,0)" @inspect="inspect(entry,z)"/></div></div></section></div>
        <details class="deck-problems"><summary>{{problems.length?`${problems.length} 项构筑问题 · 点击查看`:'构筑检查通过'}}<span>允许实验构筑</span></summary><ul><li v-for="(problem,i) in problems" :key="i"><button @click="selectZone(problem.zone)">{{problem.message}}</button></li></ul><p>构筑问题不影响保存和分享。</p></details>
      </section>
    </div>
  </template>
  <BuilderModal v-if="showFilters" title="筛选卡池" @close="showFilters=false"><div class="builder-filter-wrap"><CarddexFilters locale="zh" :filters="query.filters" :numeric="query.numeric" :options="options" :bounds="bounds" :sections="filterSections" @section="(type,open)=>filterSections[type]=open" @apply="(filters,numeric)=>{query.filters=filters;query.numeric=numeric;showFilters=false}" @close="showFilters=false"/></div></BuilderModal>
  <BuilderModal v-if="showNotes&&deck" title="卡组说明" @close="showNotes=false"><p class="b-hint">{{readonly?'分享时的卡组说明':'记录思路、测试结果，或保留赛事来源。'}} </p><textarea v-model="deck.description" class="notes-field" aria-label="卡组说明" :readonly="readonly"/><template #footer><button class="b-btn b-primary" @click="showNotes=false">完成</button></template></BuilderModal>
  <BuilderModal v-if="showStats&&deck" title="构筑统计" @close="showStats=false"><label class="b-hint"><input v-model="includeSide" type="checkbox"/>统计包含备牌</label><p class="b-hint">默认统计英雄与主牌堆。多色牌计入每种颜色。</p><h3>费用曲线</h3><div class="cost-chart"><div v-for="[cost,n] in stats.costs" :key="cost" class="cost-column"><span>{{n}}</span><i :style="{height:`${n/stats.maximum*130}px`}"/><b>{{cost}}</b></div><p v-if="!stats.costs.length" class="b-hint">加入英雄或主牌后显示费用分布。</p></div><div class="stat-columns"><div><h3>类型</h3><p v-for="[type,n] in stats.types" :key="type"><span>{{type}}</span><b>{{n}} 张</b></p></div><div><h3>颜色</h3><p v-for="[color,n] in stats.colors" :key="color"><img v-if="color!=='colorless'" :src="`${assetBase}runes/${color}.svg`" :alt="color"/><span v-else>无色</span><b>{{n}} 张</b></p></div></div></BuilderModal>
  <ShareDeck v-if="showShare&&deck" :deck="cloneDeck(deck)" :index="index" :problems="problems.length" @close="showShare=false"/>
  <BuilderModal v-if="importOpen" title="导入卡组" wide @close="importOpen=false"><p class="b-hint">粘贴快照链接、TTS 码、通用卡组码或文字清单。解析后先检查分区，无法识别的卡牌会保留供你修正。</p><textarea v-model="importRaw" class="import-field" aria-label="卡组导入内容" placeholder="在这里粘贴…"/><button class="b-btn" :disabled="parsing||!importRaw.trim()" @click="parseImport">{{parsing?'正在解析…':'解析并预览'}}</button><p v-if="importError" class="b-error" role="alert">{{importError}}</p><template v-if="importPreview"><h3 class="preview-heading">{{importPreview.name}} · {{countDeck(importPreview)}} 张</h3><p class="b-hint">{{importNote}}</p><p class="b-hint">点击未识别条目查找对应卡牌。可以修改数量和分区。</p><section v-for="z in ZONES.filter(value=>importPreview!.zones[value].length)" :key="z" class="import-zone"><h4>{{LABELS[z]}} · {{countZone(importPreview,z)}} 张</h4><div v-for="entry in importPreview.zones[z]" :key="entryKey(entry)" class="import-row"><button class="import-card-name" @click="inspect(entry,z,'import')">{{resolveEntry(entry,index).name}}<small>{{entry.printNo}} / {{entry.language}} {{resolveEntry(entry,index).record?'':'· 未识别'}}</small></button><input :value="entry.quantity" type="number" min="0" max="100000" :aria-label="`${entry.name} 导入数量`" @change="previewQuantity(z,entry,Number(($event.target as HTMLInputElement).value))"/><select :value="z" :aria-label="`${entry.name} 导入分区`" @change="previewMove(z,entry,($event.target as HTMLSelectElement).value as Zone)"><option v-for="target in ZONES" :key="target" :value="target">{{LABELS[target]}}</option></select></div></section></template><template #footer><button class="b-btn" @click="importOpen=false">取消</button><button class="b-btn b-primary" :disabled="!importPreview||parsing" @click="acceptImport">导入为新卡组</button></template></BuilderModal>
  <BuilderModal v-if="detail" :title="resolveEntry(detail.entry,index).name" wide @close="detail=null"><template v-if="detailRecord"><div class="card-detail-layout"><CarddexImage :src="detailPrint?.imageUrl||''" :fallback="detailPrint?.ttsUrl||''" :alt="fullName(detailRecord)" :landscape="kind(detailRecord)==='战场'" eager/><div><p class="b-hint">{{detailRecord.base.cardNo}} · {{detailRecord.base.categories.join(' / ')}} · 费用 {{detailRecord.base.energy??'—'}} · 战力 {{detailRecord.base.power??'—'}}</p><CardEffectText :base="detailRecord.base" :icons="icons"/><p v-if="detailRecord.base.banned" class="b-error">禁卡：可用于实验构筑，会显示检查提示。</p><h3>简中印版</h3><p class="b-hint">{{readonly?'点击印版预览。':'仅提供 SC 简中印版。点击切换整条记录；也可拆分一张，混用不同印版。'}}</p><p v-if="!detailPrints.length" class="b-hint">暂无可用的 SC 简中印版，当前条目已保留。</p><div class="print-options"><div v-for="print in detailPrints" :key="print.id" class="print-option"><button class="b-btn" :class="{active:detailPrint?.id===print.id}" @click="readonly?detailPrint=print:selectPrint(print)">{{print.cardNo}} · {{print.language}} {{print.isPromo?'· 赠卡':''}}</button><button v-if="!readonly&&detail.context!=='pool'&&detail.entry.quantity>1" class="b-btn" @click="selectPrint(print,true)">拆分 1 张</button></div></div><button v-if="detail.context==='pool'&&!readonly" class="b-btn b-primary" @click="addCard(detailRecord,detailPrint);detail=null">加入{{LABELS[zone]}}</button></div></div></template><template v-else><p class="b-hint">暂时无法在卡表中找到 {{detail.entry.cardNo}}。此条目保留在构筑中。</p><template v-if="!readonly"><input v-model="matchSearch" class="match-search" aria-label="查找对应卡牌" placeholder="搜索正确的卡名或编号"/><div class="match-results"><button v-for="card in matchResults" :key="card.key" class="b-btn" @click="resolveUnknown(index.get(card.base.cardNo.toUpperCase())!,card.print)">{{card.base.nameCn||card.base.nameEn}} · {{card.print?.cardNo||card.base.cardNo}}</button></div></template></template></BuilderModal>
  <BuilderModal v-if="editingAction" :title="editingAction.type==='rename'?'修改卡组名称':'删除卡组'" @close="editingAction=null"><input v-if="editingAction.type==='rename'" v-model="renameValue" class="match-search" aria-label="新的卡组名称" maxlength="200"/><p v-else class="b-hint">确定删除「{{editingAction.deck.name}}」及它的草稿？删除后无法恢复。</p><p v-if="error" class="b-error" role="alert">{{error}}</p><template #footer><button class="b-btn" @click="editingAction=null">取消</button><button class="b-btn b-primary" :disabled="busy" @click="confirmAction">{{busy?'处理中…':editingAction.type==='rename'?'保存名称':'确认删除'}}</button></template></BuilderModal>
</div>
</template>

<style scoped>
.deck-builder{width:100%;min-width:0;color:var(--color-text-primary);background:var(--color-page-bg)}.is-workspace{height:var(--builder-height,100dvh);display:flex;flex-direction:column;overflow:hidden}.builder-header{display:flex;align-items:center;gap:22px;padding:14px 24px;border-bottom:1px solid var(--color-panel-border);background:var(--color-card-bg);flex-shrink:0}.builder-brand{display:flex;align-items:baseline;gap:10px}.builder-brand small,.eyebrow{color:var(--color-brand);font-size:10px;letter-spacing:.15em;font-weight:700}.builder-brand h1{font:700 22px 'Noto Serif SC',serif}.header-actions{margin-left:auto;display:flex;gap:8px}.b-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;min-height:38px;border:1px solid var(--color-panel-border);background:var(--color-card-bg);font-size:12px;white-space:nowrap;cursor:pointer}.b-btn:hover{border-color:var(--color-brand);color:var(--color-brand)}.b-primary,.b-btn.active{background:var(--color-brand);color:var(--color-brand-ink);border-color:var(--color-brand)}.b-primary:hover{color:var(--color-brand-ink);filter:brightness(1.07)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--color-brand);outline-offset:2px}.danger,.builder-error{color:var(--color-brand)}.builder-error{padding:12px 24px;background:var(--color-brand-soft);font-size:13px;overflow-wrap:anywhere}.builder-error .b-btn{margin-left:12px}.b-hint{font-size:13px;line-height:1.7;color:var(--color-text-muted);margin:16px 0}.builder-library{padding:32px 32px 56px}.library-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:28px;border-bottom:2px solid var(--color-text-primary)}.library-intro h2{font:700 34px 'Noto Serif SC',serif;margin:8px 0}.library-intro p:not(.eyebrow){font-size:13px;color:var(--color-text-muted)}.storage-note{font-size:12px;color:var(--color-text-muted)}.library-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:24px 0}.b-tabs{display:flex;gap:6px}.library-toolbar .search-field{margin-left:auto;width:300px}.search-field{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--color-panel-border);background:var(--color-card-bg);min-width:0}.search-field input{min-width:0;width:100%;border:0;background:transparent;font-size:13px;outline:none}.search-field:focus-within{outline:2px solid var(--color-brand);outline-offset:1px}.library-toolbar select,.pool-search select{font-size:12px;padding:9px;border:1px solid var(--color-panel-border);background:var(--color-card-bg)}.library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}.new-deck-tile{min-height:240px;border:1px dashed var(--color-panel-border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;background:var(--color-card-bg)}.new-mark{font:300 42px serif;color:var(--color-brand)}.new-deck-tile h3{font:700 20px 'Noto Serif SC',serif}.new-deck-tile p{font-size:12px;color:var(--color-text-muted)}.library-deck{display:grid;grid-template-columns:104px minmax(0,1fr);border:1px solid var(--color-panel-border);background:var(--color-card-bg);min-width:0}.library-cover{position:relative;overflow:hidden;background:var(--color-brand-soft);min-height:240px;text-align:center}.library-cover :deep(.card-image){height:100%;width:100%;object-fit:cover}.library-cover :deep(img){height:100%;object-fit:cover}.cover-empty{font:700 52px 'Noto Serif SC',serif;color:var(--color-brand);opacity:.4}.cover-count{position:absolute;bottom:0;left:0;right:0;background:#28241ddd;color:#fff;padding:8px 4px;font-size:11px}.library-deck-body{padding:16px;min-width:0;display:flex;flex-direction:column}.deck-title{text-align:left}.deck-title h3{font:700 19px 'Noto Serif SC',serif;overflow-wrap:anywhere}.library-deck-body>p{font-size:12px;color:var(--color-text-muted);margin:12px 0;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.library-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--color-text-muted);margin-top:auto}.library-meta span:first-child{color:var(--color-brand)}.library-item-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:14px}.library-item-actions .b-btn{font-size:11px;padding:5px 8px}.deck-toolbar{display:flex;align-items:center;gap:15px;padding:10px 24px;border-bottom:1px solid var(--color-panel-border);flex-shrink:0}.deck-name{min-width:0;flex:1}.deck-name input,.deck-name h2{width:100%;font:700 22px 'Noto Serif SC',serif;background:transparent;border:0;min-width:0;padding:2px 0}.save-status{font-size:10px;color:var(--color-text-muted)}.deck-toolbar-actions{display:flex;gap:6px;align-items:center}.save-menu{position:relative}.save-menu summary{list-style:none}.save-menu>div{position:absolute;right:0;top:100%;min-width:190px;background:var(--color-card-bg);border:1px solid var(--color-panel-border);box-shadow:0 8px 24px var(--color-shadow);z-index:20;display:grid;padding:5px}.save-menu>div button{text-align:left;padding:10px;font-size:12px}.save-menu>div button:hover{background:var(--color-brand-soft)}.draft-banner,.shared-note{display:flex;align-items:center;justify-content:space-between;padding:7px 24px;background:var(--color-brand-soft);font-size:12px;gap:10px;flex-shrink:0}.draft-banner .b-btn{padding:4px 8px;min-height:30px;font-size:11px}.builder-panels{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,var(--pool-size)) 10px minmax(0,var(--deck-size));overflow:hidden}.pool-panel,.deck-panel{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}.panel-title{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--color-panel-border);background:var(--color-card-bg);flex-shrink:0}.panel-title h2{font:700 18px 'Noto Serif SC',serif}.panel-title small{font:500 11px system-ui;color:var(--color-text-muted)}.zone-destination{font-size:11px;color:var(--color-brand);margin-left:auto}.panel-title .icon-btn{margin-left:auto;padding:5px;min-width:32px;min-height:32px}.panel-title .compact{margin-left:auto}.compact .b-btn{padding:4px 9px;min-height:30px;font-size:11px}.pool-search{display:flex;align-items:stretch;gap:7px;padding:10px 14px 6px}.pool-search .search-field{flex:1}.pool-settings{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:2px 16px 9px;font-size:10px;color:var(--color-text-muted);border-bottom:1px solid var(--color-panel-border)}.pool-settings label{display:flex;align-items:center;gap:4px}.pool-settings select{background:var(--color-card-bg);border:0;padding:4px;font-size:10px;color:inherit}.pool-settings input{accent-color:var(--color-brand)}.pool-scroll,.deck-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px;scrollbar-width:thin}.pool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(116px,1fr));gap:12px}.pool-card{border:1px solid var(--color-panel-border);background:var(--color-card-bg);min-width:0}.pool-card-art{display:flex;align-items:center;width:100%;position:relative;aspect-ratio:744/1040}.pool-card-art :deep(.carddex-image){width:100%}.pool-card-art:hover{outline:2px solid var(--color-brand);outline-offset:-2px}.pool-owned{position:absolute;top:6px;right:6px;background:var(--color-card-bg);color:var(--color-brand);padding:3px 6px;font-size:10px;border:1px solid var(--color-panel-border)}.pool-add{position:absolute;right:6px;bottom:6px;width:27px;height:27px;display:grid;place-items:center;background:var(--color-brand);color:var(--color-brand-ink);font-size:18px}.pool-banned{position:absolute;top:5px;left:5px;background:var(--color-brand);color:var(--color-brand-ink);font-size:10px;padding:2px 5px}.pool-card-label{padding:5px 6px;text-align:left;display:block;width:100%}.pool-card-label strong{font-size:11px;display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.catalog-note{font-size:10px;color:var(--color-text-muted);padding:18px 0}.catalog-note button{margin-left:8px;text-decoration:underline}.load-more{margin:18px auto;display:flex}.panel-divider{background:var(--color-panel-border);cursor:col-resize;display:grid;place-items:center;touch-action:none}.panel-divider i{height:40px;width:3px;background:var(--color-text-subtle);border-radius:2px}.panel-divider:hover,.panel-divider:focus-visible{background:var(--color-brand-soft);outline:none}.panel-divider:hover i,.panel-divider:focus-visible i{background:var(--color-brand)}.zone-tabs{display:flex;overflow-x:auto;flex-shrink:0;border-bottom:1px solid var(--color-panel-border)}.zone-tabs button{flex:1;min-width:60px;display:grid;gap:3px;padding:9px 6px;font-size:11px;border-bottom:2px solid transparent;background:var(--color-card-bg);white-space:nowrap}.zone-tabs b{font-size:13px;font-weight:700}.zone-tabs b small{font-size:9px;font-weight:400;color:var(--color-text-muted)}.zone-tabs .active{color:var(--color-brand);border-bottom-color:var(--color-brand);background:var(--color-brand-soft)}.zone-tabs .warning b{color:var(--color-brand)}.deck-zone{margin-bottom:12px;scroll-margin-top:12px}.deck-zone>header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--color-panel-border);padding:6px 0;margin-bottom:8px}.deck-zone h3{font:700 18px 'Noto Serif SC',serif}.deck-zone h3 small{font:500 11px system-ui;margin-left:6px;color:var(--color-text-muted)}.deck-zone.selected h3{color:var(--color-brand)}.deck-zone h4{font-size:11px;font-weight:700;color:var(--color-text-muted);margin:12px 0 7px}.deck-zone h4 small{margin-left:4px}.deck-entries{display:grid;gap:4px;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr))}.graphic-entries{grid-template-columns:repeat(auto-fill,minmax(min(100%,104px),min(100%,112px)));gap:6px;align-items:start}.zone-empty{font-size:11px;color:var(--color-text-subtle);padding:8px;border:1px dashed var(--color-panel-border)}.zone-tip{font-size:10px;color:var(--color-text-muted);margin:8px 0}.inactive{opacity:.7}.deck-problems{border-top:1px solid var(--color-panel-border);background:var(--color-card-bg);flex-shrink:0;max-height:32%;overflow:auto;font-size:11px}.deck-problems summary{cursor:pointer;padding:11px 16px;color:var(--color-brand);display:flex;justify-content:space-between;gap:8px}.deck-problems summary span{font-size:10px;color:var(--color-text-muted)}.deck-problems ul{padding:0 24px 10px;list-style:disc}.deck-problems li{padding:3px 0}.deck-problems li button{text-align:left}.deck-problems p{padding:0 16px 10px;color:var(--color-text-muted)}.read-only{grid-template-columns:minmax(0,1fr)}.read-only .deck-scroll{padding:20px 24px}.expand-pool{grid-template-columns:1fr}.expand-pool .deck-panel,.expand-pool .panel-divider{display:none}.expand-deck{grid-template-columns:1fr}.expand-deck .pool-panel,.expand-deck .panel-divider{display:none}.workspace-loading{padding:32px;text-align:center;font-size:13px;color:var(--color-text-muted)}.notes-field,.import-field{width:100%;min-height:180px;resize:vertical;font-size:13px;line-height:1.7}.import-field{font-family:monospace;margin-bottom:12px}.preview-heading{font:700 21px 'Noto Serif SC',serif;margin-top:22px}.import-zone{padding:16px 0;border-top:1px solid var(--color-panel-border)}.import-zone h4{font-weight:700;margin-bottom:10px}.import-row{display:grid;grid-template-columns:minmax(0,1fr) 72px 105px;gap:8px;align-items:center;padding:7px 0}.import-card-name{text-align:left;font-size:13px;overflow-wrap:anywhere}.import-card-name small{display:block;font-size:10px;color:var(--color-text-muted)}.card-detail-layout{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:24px;align-items:start}.print-options{display:grid;gap:6px;margin:12px 0}.print-option{display:flex;gap:6px}.print-option .b-btn{font-size:11px}.print-option .active{border-color:var(--color-brand);color:var(--color-brand);background:var(--color-brand-soft)}.match-search{width:100%;font-size:14px}.match-results{display:grid;gap:8px;margin-top:14px}.builder-filter-wrap{height:65dvh}.builder-filter-wrap :deep(.filter-panel){height:100%}.cost-chart{display:flex;align-items:flex-end;gap:14px;min-height:185px;padding:20px 0;overflow:auto}.cost-column{min-width:32px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;font-size:11px}.cost-column i{display:block;width:28px;background:var(--color-brand);min-height:2px}.stat-columns{display:grid;grid-template-columns:1fr 1fr;gap:32px}.stat-columns h3{font-weight:700;margin-bottom:15px}.stat-columns p{display:flex;align-items:center;gap:10px;justify-content:space-between;font-size:13px;margin:10px 0}.stat-columns img{width:24px;height:24px}.stat-columns b{font-weight:600}
.deck-scroll {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  column-gap: 12px;
}
.deck-zone { grid-column: 1 / -1; min-width: 0; container-type: inline-size; }
.identity-zone { grid-column: auto; }
@container (max-width: 230px) {
  .deck-zone :deep(.deck-entry:not(.graphic)) {
    grid-template-columns: 26px minmax(0, 1fr);
  }
  .deck-zone :deep(.deck-entry:not(.graphic) .quantity-controls) {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
@media(min-width:1800px){.pool-grid{grid-template-columns:repeat(auto-fill,minmax(142px,1fr))}}
@media(max-width:900px){.builder-header{padding:9px 12px;gap:12px}.builder-brand small{display:none}.builder-brand h1{font-size:17px}.back-btn{padding:7px}.back-btn span{display:none}.header-actions{gap:5px}.header-actions .b-btn{min-height:36px;padding:6px 9px}.builder-library{padding:24px 16px}.library-intro{align-items:start}.library-intro h2{font-size:28px}.storage-note{display:none}.library-toolbar{gap:8px}.library-toolbar .search-field{margin-left:0;width:auto;flex:1}.library-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}.deck-toolbar{padding:8px 12px;gap:8px;flex-wrap:wrap}.deck-name{flex-basis:100%;display:flex;align-items:center;gap:8px}.deck-name input,.deck-name h2{font-size:18px;flex:1;min-width:0}.save-status{max-width:46%;font-size:9px;line-height:1.5}.deck-toolbar-actions{width:100%;justify-content:flex-end;gap:5px}.deck-toolbar-actions>.b-btn:first-child{margin-right:auto}.deck-toolbar-actions .b-btn{min-height:34px;padding:6px 9px;font-size:11px}.deck-toolbar-actions svg{width:14px}.draft-banner,.shared-note{padding:6px 12px;font-size:10px}.builder-panels{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,var(--pool-size)) 12px minmax(0,var(--deck-size))}.panel-divider{cursor:row-resize}.panel-divider i{width:40px;height:3px}.panel-title{padding:6px 12px;gap:8px}.panel-title h2{font-size:16px}.pool-search{padding:6px 10px;gap:5px}.pool-search .b-btn{padding:5px 8px;min-height:34px}.pool-search .b-btn span{display:none}.pool-search select{padding:6px}.search-field{padding:7px 8px}.pool-settings{padding:1px 10px 5px;gap:8px;font-size:9px}.pool-settings select{padding:3px;font-size:9px}.pool-scroll,.deck-scroll{padding:10px}.pool-grid{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}.pool-card-label{padding:6px}.pool-card-label strong{font-size:10px}.zone-tabs button{padding:6px 5px;min-width:55px;font-size:10px}.zone-tabs b{font-size:12px}.deck-zone h3{font-size:16px}.deck-zone{margin-bottom:10px}.zone-empty{padding:7px 6px;font-size:10px}.deck-problems summary{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));font-size:10px}.read-only,.expand-pool,.expand-deck{grid-template-rows:minmax(0,1fr)}.card-detail-layout{grid-template-columns:1fr;gap:16px}.card-detail-layout>:first-child{max-width:280px;margin:auto;width:100%}.import-row{grid-template-columns:minmax(0,1fr) 60px 88px;gap:5px}.import-row input,.import-row select{font-size:11px;padding:7px}.print-option{flex-wrap:wrap}.builder-error{padding:8px 12px;font-size:11px}}
</style>
