// マッスルラボの自動チェック（画面なしで、ルールの部分だけを動かす）
// 使い方: node tools/check.mjs
// index.html の中のスクリプトを取り出して Node.js の中で実行し、
// メニュー作り・回復・レベル・食事の目安・研究発表を、設定の全組み合わせで確かめる。
// 最後に、iOS アプリの中だけ動く部分（記録の控え・触覚・お知らせの予約）を、Capacitor を模した環境で確かめる。
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

// ---- 5. iOS アプリの中の動き（Capacitor を模した環境で確かめる。実機の通知・振動そのものは確かめられない） ----
// アプリ本体を、にせものの window.Capacitor がある環境でもう一度動かし、呼び出しの中身を記録して確かめる。
// 時刻は 2026-11-19 10:00 に固定する（お知らせの予約が、実行した時刻によって変わらないようにするため）。
function makeNative(opt = {}) {
  const calls = [], ls = {}, prefs = Object.assign({}, opt.prefs);
  const state = { perm: opt.perm || 'prompt', grantOnAsk: opt.grantOnAsk !== false, failSchedule: false };
  const rec = (plugin, method, arg, ret) => { calls.push({ plugin, method, arg }); return Promise.resolve(ret); };
  const Plugins = opt.noPlugins ? {} : {
    Haptics: { impact: a => rec('Haptics', 'impact', a) },
    Preferences: {
      get: a => (opt.hang ? new Promise(() => {}) : rec('Preferences', 'get', a, { value: a.key in prefs ? prefs[a.key] : null })),
      set: a => { prefs[a.key] = a.value; return rec('Preferences', 'set', a); },
      remove: a => { delete prefs[a.key]; return rec('Preferences', 'remove', a); },
    },
    LocalNotifications: {
      checkPermissions: () => rec('LocalNotifications', 'checkPermissions', null, { display: state.perm }),
      requestPermissions: () => { if (state.perm === 'prompt') state.perm = state.grantOnAsk ? 'granted' : 'denied'; return rec('LocalNotifications', 'requestPermissions', null, { display: state.perm }); },
      cancel: a => rec('LocalNotifications', 'cancel', a),
      schedule: a => { calls.push({ plugin: 'LocalNotifications', method: 'schedule', arg: a }); return state.failSchedule ? Promise.reject(new Error('fail')) : Promise.resolve({ notifications: a.notifications.map(n => ({ id: n.id })) }); },
    },
  };
  const FIXED = new Date(2026, 10, 19, 10, 0, 0).getTime();
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } }
  let napi = null;
  const nctx = {
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval, Date: FakeDate,
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { Capacitor: { isNativePlatform: () => true, Plugins } },
    __MLAB_TEST__: a => { napi = a; },
  };
  vm.createContext(nctx);
  vm.runInContext(m[1], nctx, { filename: 'index.html<script>' });
  const of = (plugin, method) => calls.filter(c => c.plugin === plugin && (!method || c.method === method));
  return { api: napi, calls, of, ls, prefs, state, FIXED };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'musclelab.v1';
function startNative(n, profile) {
  const S = n.api.defaults();
  Object.assign(S.profile, { goal: 'bulk', equip: 'body', minutes: 20, freq: 3, sex: 'm', age: 30, height: 172, weight: 68 }, profile);
  S.onboarded = true;
  n.api.S = n.api.normalize(S);
  n.api.startDay();
}
{
  // Web（Capacitor なし）では何も呼ばない
  ok(api.NATIVE === false, 'Web なのに NATIVE が true になっている');
  ok(api.defaults().set.remind === false && api.defaults().set.remindAt === '19:00', 'お知らせの初期値が OFF・19:00 でない');
  const bad = api.defaults(); bad.set.remind = 'yes'; bad.set.remindAt = '25:99';
  const fixed = api.normalize(JSON.parse(JSON.stringify(bad)));
  ok(fixed.set.remind === false && fixed.set.remindAt === '19:00', 'お知らせの設定の壊れた値が既定値に直らない');
  ok((await api.restoreNative()) === false, 'Web なのに控えから戻そうとした');
  await api.syncRemind();   // 何も起きず、例外も出ないこと

  // 記録の二重保存
  const n = makeNative();
  ok(n.api.NATIVE === true, 'にせものの Capacitor を NATIVE と判定できていない');
  startNative(n);
  const sets = n.of('Preferences', 'set');
  ok(sets.length >= 1 && sets[sets.length - 1].arg.key === KEY, '保存したのに Preferences.set が呼ばれていない');
  ok(n.prefs[KEY] === n.ls[KEY] && n.ls[KEY] === JSON.stringify(n.api.S), 'localStorage と Preferences の中身が同じでない');
  n.api.S.rp = 777; n.api.save();
  ok(JSON.parse(n.prefs[KEY] || '{}').rp === 777, '保存し直した内容が Preferences に入っていない');
  await sleep(1000);   // 保存のあと 0.9秒でお知らせを合わせに行く。OFF なので取り消しだけが呼ばれる
  ok(n.of('LocalNotifications', 'schedule').length === 0 && n.of('LocalNotifications', 'cancel').length === 1, 'お知らせが OFF なのに予約した（または取り消しを呼んでいない）');
  ok(n.of('LocalNotifications', 'requestPermissions').length === 0, '起動しただけで通知の許可をたずねた');

  // localStorage が空のときだけ、控えから戻す
  const snap = n.prefs[KEY];
  const r1 = makeNative({ prefs: { [KEY]: snap } });
  r1.api.load();
  ok(r1.api.S.onboarded === false, '空の localStorage から読んだのに初期状態でない');
  ok((await r1.api.restoreNative()) === true, '控えがあるのに戻せなかった');
  ok(r1.api.S.onboarded === true && r1.api.S.rp === 777 && r1.ls[KEY] === JSON.stringify(r1.api.S), '控えから戻した内容が正しくない（または localStorage に書き戻していない）');
  const r2 = makeNative({ prefs: { [KEY]: snap } });
  startNative(r2); r2.api.S.rp = 5; r2.api.save(); r2.api.load();
  ok((await r2.api.restoreNative()) === false && r2.api.S.rp === 5, 'localStorage に記録があるのに控えで上書きした');
  const r3 = makeNative({ prefs: { [KEY]: '{こわれた' } });
  r3.api.load();
  ok((await r3.api.restoreNative()) === false && r3.api.S.onboarded === false, 'こわれた控えを読み込んだ');
  const r4 = makeNative();
  r4.api.load();
  ok((await r4.api.restoreNative()) === false, '控えが無いのに戻したことになっている');
  const r5 = makeNative({ noPlugins: true });
  r5.api.load();
  ok((await r5.api.restoreNative()) === false, '部品が無いときに控えの読み込みが止まる');
  startNative(r5); r5.api.buzz([30, 50, 30]); await r5.api.syncRemind();
  ok(r5.ls[KEY] === JSON.stringify(r5.api.S), '部品が無いときに localStorage への保存ができない');
  const r6 = makeNative({ hang: true });
  r6.api.load();
  const t0 = performance.now(), back = await r6.api.restoreNative(), waited = performance.now() - t0;
  ok(back === false && waited >= 1500 && waited < 4000, `控えの返事が来ないときに、待ちすぎるか待たずに進む（${Math.round(waited)}ms）`);

  // 記録の消去で、控えも消える
  n.api.reset();
  ok(!(KEY in n.prefs) && !(KEY in n.ls) && n.of('Preferences', 'remove').length === 1, '記録を消しても Preferences に控えが残っている');

  // 触覚: 振動の長さを強さに読み替える
  const h = makeNative();
  startNative(h);
  h.api.buzz(12); h.api.buzz(25); h.api.buzz(60);
  ok(h.of('Haptics').map(c => c.arg.style).join(',') === 'LIGHT,MEDIUM,HEAVY', '振動の強さの読み替えが想定と違う');
  h.calls.length = 0;
  h.api.buzz([30, 50, 30, 50, 80]);
  ok(h.of('Haptics').length === 1, '続けて振動させるとき、最初の1回がすぐ出ていない');
  await sleep(300);
  ok(h.of('Haptics').map(c => c.arg.style).join(',') === 'MEDIUM,MEDIUM,HEAVY', '続けて振動させるときの回数か強さが想定と違う');
  h.calls.length = 0; h.api.S.set.haptic = false; h.api.buzz([60, 60, 60]); await sleep(200);
  ok(h.of('Haptics').length === 0, '振動を OFF にしても Haptics を呼んでいる');

  // お知らせ: 許可・予約・取り消し
  const q = makeNative({ perm: 'prompt' });
  startNative(q);
  await sleep(1000); q.calls.length = 0;
  ok((await q.api.remindAllow()) === true && q.of('LocalNotifications', 'requestPermissions').length === 1, '許可がまだのときに、許可をたずねていない');
  q.api.S.set.remind = true; q.api.S.set.remindAt = '19:00'; q.api.save();
  await q.api.syncRemind();
  let sch = q.of('LocalNotifications', 'schedule');
  ok(sch.length === 1, 'お知らせを ON にしたのに予約していない');
  const list = sch.length ? sch[0].arg.notifications : [];
  ok(list.length === 14 && list.every((x, i) => x.id === 4100 + i), `予約の件数か番号が想定と違う（${list.length}件）`);
  ok(list.every(x => typeof x.title === 'string' && x.title && typeof x.body === 'string' && x.body && !/%/.test(x.title + x.body)), '予約の題名か本文が空（または % を含む）');
  ok(list.every(x => Object.prototype.toString.call(x.schedule.at) === '[object Date]'), '予約の時刻が日付の形（Date）で渡されていない');
  ok(list.every(x => x.sound === ''), '通知音の指定が無い（iOS では指定が無いと無音になる。空の指定で標準の音が鳴る）');
  ok(list.every((x, i) => x.schedule.at.getHours() === 19 && x.schedule.at.getMinutes() === 0 && Math.round((x.schedule.at.getTime() - new Date(2026, 10, 19, 19, 0, 0).getTime()) / 86400000) === i), '予約の日時が「今日から14日ぶんの19:00」になっていない');
  ok(list.length > 0 && list[0].title === '実験の時間です' && /種目（約\d+分）/.test(list[0].body) && list[0].body.includes(q.api.S.profile.name), '今日のぶんの文面に、今日のメニューが入っていない');
  ok(list.length > 1 && list[1].body === 'ラボを開いて、今日のメニューを確かめましょう。', '明日以降の文面が想定と違う');
  ok(q.of('LocalNotifications', 'cancel').length === 1 && q.of('LocalNotifications', 'cancel')[0].arg.notifications.length === 14, '予約し直す前に、前の予約（14件）を取り消していない');
  // 同じ内容なら、呼び直さない
  q.calls.length = 0; await q.api.syncRemind(false);
  ok(q.of('LocalNotifications').length === 0, '内容が変わっていないのに予約し直している');
  // 今日の実験を始めたら、今日のぶんは入れない
  q.api.initProg().sets[0].push(q.api.S.cur.plan.items[0].reps); q.api.save();
  await q.api.syncRemind(false);
  sch = q.of('LocalNotifications', 'schedule');
  ok(sch.length === 1 && sch[0].arg.notifications.length === 13 && sch[0].arg.notifications[0].id === 4101, '実験を始めたあとも、今日のお知らせを予約している');
  // 記録を済ませても同じ（内容が変わらないので呼び直さない）
  q.calls.length = 0; q.api.simulate('ok'); await q.api.syncRemind(false);
  ok(q.api.S.cur.done === true && q.of('LocalNotifications', 'schedule').length === 0, '記録を済ませたあとの予約が想定と違う');
  ok(q.api.remindList().length === 13 && q.api.remindList()[0].id === 4101, '記録を済ませたあとも、今日のお知らせが一覧に入っている');
  // 時刻を過ぎていれば、今日のぶんは入れない（今は 10:00 に固定してある）
  const q2 = makeNative({ perm: 'granted' });
  startNative(q2); q2.api.S.set.remind = true; q2.api.S.set.remindAt = '09:30';
  ok(q2.api.remindList().length === 13 && q2.api.remindList()[0].schedule.at.getTime() > q2.FIXED, '過ぎた時刻のお知らせを予約しようとしている');
  q2.api.S.set.remindAt = '10:00';
  ok(q2.api.remindList().every(x => x.schedule.at.getTime() > q2.FIXED + 59000), '直前の時刻のお知らせを予約しようとしている');
  // 回復日の文面
  q2.api.S.set.remindAt = '21:15'; ok(q2.api.setRestToday(), '回復日に切り替えられない');
  const rl = q2.api.remindList();
  ok(rl.length === 14 && rl[0].title === '今日は回復日です' && rl[0].schedule.at.getHours() === 21 && rl[0].schedule.at.getMinutes() === 15, '回復日の今日のぶんの文面か時刻が想定と違う');
  q2.api.restCheckIn();
  ok(q2.api.remindList().length === 13, '回復を記録したあとも、今日のお知らせが一覧に入っている');
  // 名前に % が入っていても、通知の文面には入れない（iOS が書式の記号として読むおそれがあるため）
  const q3 = makeNative({ perm: 'granted' });
  startNative(q3); q3.api.S.profile.name = '100%マッスル'; q3.api.S.set.remind = true;
  ok(!/%/.test(q3.api.remindList()[0].body) && q3.api.remindList()[0].body.includes('100％マッスル'), '名前の % が通知の文面に残っている');
  // OFF にしたら取り消すだけ
  q.calls.length = 0; q.api.S.set.remind = false; q.api.save(); await q.api.syncRemind();
  ok(q.of('LocalNotifications', 'cancel').length === 1 && q.of('LocalNotifications', 'schedule').length === 0, 'OFF にしたのに取り消していない（または予約した）');
  // 端末の設定で通知を切られていたら、アプリの中の設定も OFF にして、予約しない
  const d = makeNative({ perm: 'denied' });
  startNative(d); d.api.S.set.remind = true; d.api.save();
  await d.api.syncRemind();
  ok(d.api.S.set.remind === false && (JSON.parse(d.prefs[KEY] || '{}').set || {}).remind === false && d.of('LocalNotifications', 'schedule').length === 0, '通知が許可されていないのに、設定が ON のまま（または予約した）');
  ok(d.of('LocalNotifications', 'requestPermissions').length === 0, '起動時の確認で、許可をたずねている');
  ok((await d.api.remindAllow()) === false, '許可されていないのに、許可されたことになっている');
  const d2 = makeNative({ perm: 'prompt', grantOnAsk: false });
  startNative(d2);
  ok((await d2.api.remindAllow()) === false && d2.api.S.set.remind === false, '許可を断られたのに、許可されたことになっている');
  // 予約に失敗しても止まらず、次の機会にやり直す
  const f = makeNative({ perm: 'granted' });
  startNative(f); f.api.S.set.remind = true; f.state.failSchedule = true;
  await f.api.syncRemind();
  f.state.failSchedule = false; f.calls.length = 0;
  await f.api.syncRemind(false);
  ok(f.of('LocalNotifications', 'schedule').length === 1 && f.of('LocalNotifications', 'schedule')[0].arg.notifications.length === 14, '予約に失敗したあと、やり直していない');
}

console.log(`組み合わせ ${combos} 通り × 77日、実験 ${sessionsTotal} 回ぶんを再現`);
if (fail) {
  console.log(`FAIL ${fail} 件（PASS ${pass} 件）`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass} 項目`);
