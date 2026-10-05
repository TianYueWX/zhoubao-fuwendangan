import assert from 'node:assert/strict';
import { cardIndex, newDeck, copyDeck, addEntry, setQuantity, entryKey, entryFromRecord, resolveEntry, moveEntry, changePrint, hasNeeko, validateDeck, countDeck, parseDeck } from '../src/tools/deckbuilder/model.ts';
import { saveDraft, readLibrary, saveLocal, listLocal, deleteLocal, STORAGE_KEY } from '../src/tools/deckbuilder/storage.ts';
import { exportText, importText, exportCode, importCode, exportTTS, importTTS, encodeSnapshot, decodeSnapshot, importAny, fromEventDeck } from '../src/tools/deckbuilder/formats.ts';

let passed=0;
async function test(name,fn){await fn();passed++;console.log(`✓ ${name}`);}
function record(code,name,type,extra={}) {
  const base={id:code,cardNo:code,nameCn:name,nameEn:'',nameKr:'',nameTw:'',subtitleCn:'',subtitleEn:'',subtitleKr:'',subtitleTw:'',colors:['green'],regions:[],tags:[],keywords:[],advancedTags:[],championTag:'',effectCn:'',effectEn:'',effectKr:'',effectTw:'',energy:2,returnEnergy:0,power:3,rarity:'普通',series:'OGN',flavorCn:'',flavorEn:'',banned:false,categories:[type],deckLimit:null,...extra};
  const print={id:code+'SC',cardId:code,cardNo:code,rarity:'普通',extendedRarity:'平卡',language:'SC',imageUrl:'',ttsUrl:'',artist:'',printOrder:0,isDefault:true,isPromo:false,series:'OGN',flavorCn:'',flavorEn:''};
  return {base,prints:[print,{...print,id:code+'aEN',cardNo:code+'a',language:'EN',isDefault:false}]};
}
const neeko=record('OGN-001','妮蔻','传奇'),legend=record('OGN-002','盖伦','传奇',{colors:['orange']}),champion=record('OGN-003','英雄','英雄单位'),unit=record('OGN-004','单位','单位'),spell=record('OGN-005','法术','专属法术'),field=record('OGN-006','战场','战场'),rune=record('OGN-007','符文','符文');
const index=cardIndex([neeko,legend,champion,unit,spell,field,rune]);
const e=(r,q=1,p=r.prints[0])=>entryFromRecord(r,p,q);
function fixture(){let d=newDeck('测试构筑 · 你好');d.description='赛事来源\n测试印版';for(const [z,r,q] of [['legend',neeko,1],['champion',champion,1],['main',champion,2],['main',unit,37],['battlefield',field,3],['rune',rune,12],['side',spell,2],['additional',legend,1]])d=addEntry(d,z,e(r,q));return d;}
function memory(){const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}

await test('任意分区里的妮蔻开启额外传奇，移除后保留条目和提示',()=>{
  for(const z of ['legend','champion','main','battlefield','rune','side','additional']) assert.equal(hasNeeko(addEntry(newDeck(),z,e(neeko)),index),true);
  let d=fixture();d=setQuantity(d,'legend',entryKey(d.zones.legend[0]),0);assert.equal(hasNeeko(d,index),false);assert.equal(d.zones.additional.length,1);assert(validateDeck(d,index).some(p=>p.message.includes('需要妮蔻')));
  d=addEntry(d,'side',e(neeko));assert(!validateDeck(d,index).some(p=>p.message.includes('需要妮蔻')));
  const mention=record('OGN-009','妮蔻的礼物','法术',{effectCn:'妮蔻'});const idx=cardIndex([mention]);assert.equal(hasNeeko(addEntry(newDeck(),'main',e(mention)),idx),false);
});
await test('额外传奇同名和容量检查，不限制颜色',()=>{
  let d=fixture();assert(!validateDeck(d,index).some(p=>p.zone==='additional'));
  d=addEntry(d,'additional',e(legend,3));assert(validateDeck(d,index).some(p=>p.message.includes('超过 3')));assert(validateDeck(d,index).some(p=>p.message.includes('同名')));
  d=addEntry(fixture(),'additional',e(neeko));assert(validateDeck(d,index).some(p=>p.message.includes('同名')));
});
await test('英雄、主牌、备牌与不同印版合计同名张数',()=>{
  let d=addEntry(fixture(),'side',e(champion,1,champion.prints[1]));assert(validateDeck(d,index).some(p=>p.message.includes('英雄 合计 4')));
  d=changePrint(d,'main',entryKey(d.zones.main[0]),champion.prints[1]);assert.equal(d.zones.main[0].quantity,37);assert.equal(d.zones.main[1].language,'EN');
  d=moveEntry(d,'side','main',entryKey(d.zones.side[1]));assert.equal(d.zones.main[1].quantity,3);assert.equal(d.zones.side.length,1);
});
await test('禁卡、未完成、超限构筑仍可正式保存；数量输入有效性检查',()=>{
  const banned=record('OGN-008','禁卡','单位',{banned:true});const d=addEntry(newDeck(),'main',e(banned,9));assert(validateDeck(d,cardIndex([banned])).some(p=>p.message.includes('禁卡')));const store=memory();assert.equal(saveLocal(d,store).zones.main[0].quantity,9);assert.throws(()=>setQuantity(d,'main',entryKey(d.zones.main[0]),NaN));assert.throws(()=>parseDeck({...d,formatVersion:2}));
});
await test('正式保存与草稿隔离，多卡组复制、删除和存储失败保留数据',()=>{
  const store=memory();const original=saveLocal(fixture(),store);const changed=addEntry(original,'side',e(unit));changed.name='草稿名称';saveDraft(changed,undefined,store);const lib=readLibrary(store);assert.equal(lib.decks[0].name,original.name);assert.equal(lib.drafts['local:'+original.id].name,'草稿名称');const copy=copyDeck(changed);saveDraft(copy,undefined,store);assert.notEqual(copy.id,original.id);assert.equal(listLocal(store).length,2);copy.zones.side[0].quantity=77;assert.notEqual(changed.zones.side[0].quantity,77);saveLocal(changed,store);assert.equal(readLibrary(store).drafts['local:'+original.id],undefined);deleteLocal(copy.id,store);assert.equal(listLocal(store).length,1);
  store.setItem(STORAGE_KEY,'{broken');assert.throws(()=>saveLocal(original,store));assert.equal(store.getItem(STORAGE_KEY),'{broken');assert.throws(()=>saveDraft(original,undefined,{getItem:()=>null,setItem:()=>{throw new Error('quota');}}),/保存失败/);
});
await test('文字清单和压缩快照完整保留分区、语言、混用印版与未知条目',async()=>{
  let d=fixture();d=addEntry(d,'main',e(unit,1,unit.prints[1]));d=addEntry(d,'side',{cardNo:'XXX-999',printNo:'XXX-999a',language:'TW',quantity:2,name:'尚未收录的卡'});
  const text=importText(exportText(d),index);assert.deepEqual(text.zones,d.zones);assert.equal(text.name,d.name);assert.equal(text.description,d.description);
  const snapshot=await encodeSnapshot(d);const received=await decodeSnapshot(snapshot);assert.deepEqual(received.zones,d.zones);assert.notEqual(received.id,d.id);const imported=await importAny('https://example.org/#/builder/share?s='+snapshot,index);assert.deepEqual(imported.deck.zones,d.zones);received.zones.side[0].quantity=99;assert.notEqual(d.zones.side[0].quantity,99);await assert.rejects(()=>decodeSnapshot('DB9.fake'));await assert.rejects(()=>decodeSnapshot('DB1.invalid'));
  const unknown=importText('主牌堆:\n2 未知中文名',index);assert.equal(unknown.zones.main[0].name,'未知中文名');assert.equal(resolveEntry(unknown.zones.main[0],index).record,null);assert.throws(()=>importText('2 单位\n无法解析的行',index),/第 2 行/);
});
await test('通用 v6 码恢复额外传奇，不吞掉英雄的主牌剩余副本',()=>{
  const d=fixture(),decoded=importCode(exportCode(d),index);assert.equal(decoded.zones.champion[0].quantity,1);assert.equal(decoded.zones.main.find(e=>e.cardNo===champion.base.cardNo).quantity,2);assert.equal(decoded.zones.additional[0].cardNo,legend.base.cardNo);assert.equal(countDeck(decoded),countDeck(d));
});
await test('TTS 每项一张，额外传奇按类型恢复，不把末段生成参数当张数',()=>{
  const d=fixture(),text=exportTTS(d),decoded=importTTS(text,index);assert.equal(countDeck(decoded),countDeck(d));assert.deepEqual(decoded.zones,d.zones);assert.equal(countDeck(importTTS('OGN-001-8 OGN-003-1 OGN-004-3',index)),3);assert.throws(()=>exportTTS(importText('2 未知卡',index)),/不能生成/);
});
await test('赛事卡组复制保留跨分区同卡数量及来源，编辑不影响来源',()=>{
  const source={hero:'英雄',playerName:'测试选手',activityName:'测试赛事',date:'2026-10-05',rank:1,cardTokens:['OGN-001','OGN-003',...Array(39).fill('OGN-004'),...Array(3).fill('OGN-006'),...Array(12).fill('OGN-007'),'OGN-004'],cards:new Map([['OGN-004',40]])};const d=fromEventDeck(source,index);assert.equal(d.zones.main[0].quantity,39);assert.equal(d.zones.side[0].quantity,1);assert(d.description.includes('测试赛事'));d.zones.main[0].quantity=3;assert.equal(source.cardTokens.length,57);assert.equal(source.cards.get('OGN-004'),40);
});
console.log(`\n${passed} 项构筑核心检查通过。`);
