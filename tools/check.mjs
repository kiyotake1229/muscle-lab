// マッスルラボの自動チェック（画面なしで、ルールの部分だけを動かす）
// 使い方: node tools/check.mjs
// index.html の中のスクリプトを取り出して Node.js の中で実行し、
// メニュー作り・回復・レベル・食事の目安・研究発表を、設定の全組み合わせで確かめる。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
const m = html.match(/<script>\n([\s\S]*?)<\/script>\n<!-- @artifact-end -->/);
if (!m) { console.error('index.html の中にアプリのスクリプトが見つかりません'); process.exit(1); }

let api = null;
const store = {};
const ctx = {
  console, performance, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  __MLAB_TEST__: a => { api = a; },
};
vm.createContext(ctx);
vm.runInContext(m[1], ctx, { filename: 'index.html<script>' });
if (!api) { console.error('テスト用の入口（__MLAB_TEST__）が呼ばれませんでした'); process.exit(1); }

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; if (fails.length < 40) fails.push(msg); } }
const PART_IDS = api.PARTS.map(p => p.id);

// ---- 1. データの整合性 ----
{
  const ids = new Set();
  for (const e of api.EX) {
    ok(!ids.has(e.id), `種目IDの重複: ${e.id}`); ids.add(e.id);
    ok(PART_IDS.includes(e.part), `種目 ${e.id}: 部位が不正`);
    ok(e.sub.every(s => PART_IDS.includes(s) && s !== e.part), `種目 ${e.id}: 補助の部位が不正`);
    ok(['b', 'd', 'g'].includes(e.eq), `種目 ${e.id}: 器具が不正`);
    ok(e.lv >= 1 && e.df >= 1 && e.df <= 5 && e.base >= 3, `種目 ${e.id}: 数値が不正`);
    ok(e.how.length > 10 && e.tip.length > 3, `種目 ${e.id}: 説明が短すぎる`);
  }
  for (const p of PART_IDS) {
    const lv1 = api.EX.filter(e => e.part === p && e.eq === 'b' && e.lv === 1);
    ok(lv1.length >= 2, `部位 ${p}: 自重・Lv.1 の種目が2つ未満`);
  }
  for (const st of ['h', 'c', 'o']) for (const s of api.SLOTS) {
    const n = api.MEALS.filter(x => x.st === st && x.slots.includes(s.id)).length;
    ok(n >= 4, `食事の例が少ない: ${st}/${s.id} = ${n}`);
  }
  for (const x of api.MEALS) ok(x.k > 0 && x.p > 0 && x.items.length > 0, `食事の例の数値が不正: ${x.name}`);
  ok(api.lvInfo(0).lv === 1 && api.lvInfo(59).lv === 1 && api.lvInfo(60).lv === 2 && api.lvInfo(145).lv === 3, 'レベルの境目が想定と違う');
  let prev = 0; for (let e = 0; e < 20000; e += 37) { const l = api.lvInfo(e).lv; ok(l >= prev, 'レベルが経験値に対して単調でない'); prev = l; }
}

// ---- 2. 設定の全組み合わせで、毎日使った場合を 77日ぶん再現する ----
function fresh(profile) {
  api.reset();
  const S = api.defaults();
  Object.assign(S.profile, profile);
  S.onboarded = true; S.created = api.today();
  api.S = api.normalize(S);
}
function noNaN(obj) { return !/NaN|Infinity|null,"exp"/.test(JSON.stringify(obj.parts)) && Number.isFinite(obj.rp); }
const goals = ['bulk', 'cut', 'keep'], equips = ['body', 'dumbbell', 'gym'], mins = [10, 20, 30], freqs = [2, 3, 4, 5, 6];
const feels = ['ok', 'easy', 'ok', 'hard', 'ok'];
let combos = 0, sessionsTotal = 0;
for (const goal of goals) for (const equip of equips) for (const minutes of mins) for (const freq of freqs) {
  combos++;
  const tag = `${goal}/${equip}/${minutes}分/週${freq}`;
  fresh({ goal, equip, minutes, freq, sex: 'm', age: 30, height: 172, weight: 68 });
  const trained = [];
  let lastTotal = 0, weeks = 0;
  for (let day = 0; day < 77; day++) {
    api.startDay();
    const S = api.S, c = S.cur;
    ok(c && c.date === api.today(), `${tag} ${day}日目: 今日の状態が作られていない`);
    if (day === 0) ok(c.type === 'train', `${tag}: 初日が実験の日になっていない`);
    if (c.type === 'train') {
      const ids = c.plan.items.map(i => i.id);
      ok(ids.length >= 1, `${tag} ${day}日目: メニューが空`);
      ok(new Set(ids).size === ids.length, `${tag} ${day}日目: メニューに同じ種目が2回ある`);
      ok(c.plan.est > 0 && c.plan.est <= minutes * 2 + 6, `${tag} ${day}日目: 所要時間が不自然（${c.plan.est}分）`);
      for (const it of c.plan.items) {
        const e = api.EX.find(x => x.id === it.id);
        ok(api.isReady(e.part, c.date), `${tag} ${day}日目: 回復中の部位（${e.part}）がメニューに入っている`);
        ok(it.reps >= 3 && it.reps <= 120 && it.sets >= 2, `${tag} ${day}日目: 回数が不自然（${e.id} ${it.reps}）`);
        const rank = { body: 0, dumbbell: 1, gym: 2 }[equip], er = { b: 0, d: 1, g: 2 }[e.eq];
        ok(er <= rank, `${tag} ${day}日目: 器具の設定にない種目（${e.id}）`);
        ok(e.lv <= api.lvInfo(S.parts[e.part].exp).lv, `${tag} ${day}日目: まだ解放されていない種目（${e.id}）`);
      }
      const r = api.simulate(feels[day % feels.length]);
      ok(r && r.setsDone === r.setsAll && r.rp >= 50, `${tag} ${day}日目: 実験の集計が不正`);
      trained.push(day); sessionsTotal++;
    } else {
      const r = api.restCheckIn();
      ok(r && r.rp === 20, `${tag} ${day}日目: 回復の記録が不正`);
    }
    // 食事: 日によって 0〜4 回記録する
    const nMeal = (day * 7 + freq) % 5;
    api.SLOTS.slice(0, nMeal).forEach(s => api.toggleMeal(s.id));
    ok(noNaN(api.S), `${tag} ${day}日目: 数値が壊れている`);
    ok(api.S.streak.cur === day + 1, `${tag} ${day}日目: 連続日数が ${api.S.streak.cur}（想定 ${day + 1}）`);
    const total = PART_IDS.reduce((s, p) => s + api.S.parts[p].exp, 0);
    ok(total >= lastTotal, `${tag} ${day}日目: 経験値の合計が減った`); lastTotal = total;
    api.shiftDays(1);
  }
  // 続く7日間のどこを取っても、設定した回数を超えて鍛えさせない
  for (let d = 0; d + 7 <= 77; d++) {
    const n = trained.filter(x => x >= d && x < d + 7).length;
    ok(n <= freq, `${tag}: ${d}日目からの7日間に ${n}回（設定は週${freq}回）`);
  }
  // 逆に、少なすぎてもいけない（11週で、設定の8割以上）
  ok(trained.length >= Math.floor(freq * 11 * 0.8), `${tag}: 実験の回数が少ない（${trained.length}回 / 11週）`);
  // 全部位をまんべんなく鍛えている
  for (const p of PART_IDS) ok(api.S.parts[p].exp > 0, `${tag}: ${p} を一度も鍛えていない`);
  const lvs = PART_IDS.map(p => api.lvInfo(api.S.parts[p].exp).lv);
  ok(Math.max(...lvs) - Math.min(...lvs) <= Math.max(4, Math.max(...lvs) * 0.6), `${tag}: 部位のレベルの偏りが大きい（${lvs.join(',')}）`);
  // 研究発表が毎週つく
  weeks = Object.values(api.S.weeks).filter(w => !w.skip).length;
  ok(weeks >= 10, `${tag}: 研究発表が ${weeks}回しかない`);
  ok(Object.values(api.S.weeks).every(w => w.skip || 'SABC'.includes(w.g)), `${tag}: 研究発表の評価が不正`);
  // 保存して読み直しても同じ
  const snap = JSON.stringify(api.S);
  api.save(); api.load();
  ok(JSON.stringify(api.S) === snap, `${tag}: 保存して読み直すと内容が変わる`);
}

// ---- 3. 気まぐれな使い方（休む・サボる・やり直す）でも壊れない ----
{
  fresh({ goal: 'bulk', equip: 'body', minutes: 20, freq: 3, sex: 'x', age: 25, height: 165, weight: 60 });
  let r = 12345;
  const rand = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let day = 0; day < 200; day++) {
    api.startDay();
    const c = api.S.cur, x = rand();
    if (x < 0.25) { /* 開いただけで何もしない */ }
    else if (c.type === 'train') {
      if (x < 0.35) { ok(api.setRestToday(), '「今日は休む」に切り替えられない'); api.restCheckIn(); }
      else if (x < 0.5) {
        // 途中までやって、感想を答えずに閉じる（翌日に自動で集計される）
        const pr = api.initProg(); pr.sets[0].push(c.plan.items[0].reps);
      } else { api.swapItem(0); api.simulate(['easy', 'ok', 'hard'][day % 3]); }
    } else {
      if (x < 0.45 && api.setTrainToday()) api.simulate('ok'); else api.restCheckIn();
    }
    if (rand() < 0.5) api.toggleMeal('b');
    if (rand() < 0.2) api.toggleMeal('b');
    ok(noNaN(api.S), `気まぐれ ${day}日目: 数値が壊れている`);
    ok(api.S.rp >= 0 && PART_IDS.every(p => api.S.parts[p].exp >= 0), `気まぐれ ${day}日目: マイナスの値がある`);
    api.shiftDays(rand() < 0.15 ? 3 : 1);
  }
  ok(api.S.totals.sessions > 20, '気まぐれ: 実験の回数が数えられていない');
  ok(api.S.streak.best >= api.S.streak.cur, '気まぐれ: 最長記録が現在の連続より短い');
}

// ---- 4. 食事の目安 ----
{
  for (const sex of ['m', 'f', 'x']) for (const goal of goals) for (const weight of [40, 55, 70, 95, 130]) for (const age of [15, 30, 70]) {
    fresh({ goal, equip: 'body', minutes: 20, freq: 3, sex, age, height: sex === 'f' ? 158 : 172, weight });
    api.startDay();
    const n = api.nutrition(), tag = `${sex}/${goal}/${weight}kg/${age}歳`;
    ok(n.k >= 1200 && n.k <= 4500, `${tag}: カロリーが範囲外（${n.k}）`);
    ok(n.k >= n.bmr - 25, `${tag}: 基礎代謝を下回っている`);
    ok(n.p >= 55 && n.p <= 200 && n.f >= 30 && n.c >= 50, `${tag}: 栄養素が不自然（P${n.p} F${n.f} C${n.c}）`);
    ok(Math.abs(n.p * 4 + n.f * 9 + n.c * 4 - n.k) <= 60, `${tag}: 栄養素の合計がカロリーと合わない`);
    if (goal === 'cut' && age < 18) ok(n.k >= n.tdee - 30, `${tag}: 18歳未満なのに減らしている`);
    for (const st of ['h', 'c', 'o']) for (const s of api.SLOTS) {
      const tg = api.slotTarget(s.id);
      for (let k = 0; k < 3; k++) {
        const o = api.mealPick(s.id, st, api.today(), k);
        ok(o && o.k > 0 && o.p > 0 && o.items.length > 0, `${tag}: 食事の例が出ない（${st}/${s.id}）`);
      }
      // いちばん合う例は、目安から大きく外れない（間食は幅を広めに見る）
      const best = api.mealOptions(s.id, st)[0], tolK = s.id === 's' ? 1.0 : 0.6;
      ok(Math.abs(best.k - tg.k) / tg.k <= tolK, `${tag}: ${st}/${s.id} の例がカロリーの目安から遠い（${best.k} / ${Math.round(tg.k)}）`);
    }
  }
}

console.log(`組み合わせ ${combos} 通り × 77日、実験 ${sessionsTotal} 回ぶんを再現`);
if (fail) {
  console.log(`FAIL ${fail} 件（PASS ${pass} 件）`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass} 項目`);
