// 改版第 5 步 5d #21：後端待辦 → Google 工作表（Google Tasks）「豐有」清單（Lotion 11/04 第 2 題選 A：雲端直接建）
// 純邏輯＋可注入 fetch 的 API 小包裝（單元測試 functions/test/gtasks.test.js，不連網）。
//   fydata/todo 有新卡片 → 建一筆 Google 工作；卡片消失（處理好了）→ 那筆工作打勾完成（不刪除）；同一張卡片又出現 → 取消打勾。
//   對應表 fydata/gtasks/map/<來源~key> = {task, title, done, at}（規則全部 false，只有雲端程式讀寫）
//   每天最多新建 50 筆（主線 11/04）；超過的留到隔天（不會漏，只是晚建）。
//   預設同步全部來源（cfg.srcs 未設定＝全部）；fydata/todo/gtasks 是同步本身的錯誤待辦，不再同步回 Google。
'use strict';

const LIST_TITLE = '豐有';
const DAILY_LIMIT = 50;
const SCOPE = 'https://www.googleapis.com/auth/tasks';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://tasks.googleapis.com/tasks/v1';
const STATE_TTL_MS = 10 * 60 * 1000;

function gid(src, key) { return String(src) + '~' + String(key); }
function okKey(k) { return typeof k === 'string' && /^[^.#$/[\]]{1,200}$/.test(k); }

// fydata/todo 攤平成要同步的清單
function flatten(todo, cfg) {
  const srcs = cfg && cfg.srcs && typeof cfg.srcs === 'object' ? cfg.srcs : null;
  const out = [];
  Object.keys(todo || {}).forEach((src) => {
    if (src === 'gtasks' || !okKey(src)) return;
    if (srcs && !srcs[src]) return;
    const g = todo[src] || {};
    Object.keys(g).forEach((k) => {
      const t = g[k]; if (!t || typeof t !== 'object' || !t.text || !okKey(k)) return;
      out.push({ gid: gid(src, k), title: String(t.text).slice(0, 200), notes: (t.sub ? String(t.sub).slice(0, 200) + '\n' : '') + '（FJ 後端待辦，處理好後會自動打勾）', urgent: !!t.urgent });
    });
  });
  out.sort((a, b) => (b.urgent - a.urgent) || (a.gid < b.gid ? -1 : 1));   // 緊急的先建
  return out;
}

// 算要做什麼：create（新建）、reopen（重新出現：取消打勾）、retitle（文字變了）、complete（消失：打勾）、deferred（超過今天上限）
function plan(items, map, madeToday, limit) {
  map = map || {}; limit = limit == null ? DAILY_LIMIT : limit;
  const room = Math.max(0, limit - (madeToday || 0));
  const now = {}; items.forEach((it) => { now[it.gid] = it; });
  const create = [], reopen = [], retitle = [], complete = [], deferred = [];
  items.forEach((it) => {
    const m = map[it.gid];
    if (!m || !m.task) { if (create.length < room) create.push(it); else deferred.push(it); return; }
    if (m.done) reopen.push({ gid: it.gid, task: m.task, title: it.title });
    else if (m.title !== it.title) retitle.push({ gid: it.gid, task: m.task, title: it.title });
  });
  Object.keys(map).forEach((g) => { const m = map[g]; if (m && m.task && !m.done && !now[g]) complete.push({ gid: g, task: m.task }); });
  return { create, reopen, retitle, complete, deferred };
}

// 授權網址（Lotion 按 FJ「授權 Google 工作表」→ 雲端產生這個網址 → 瀏覽器開啟同意）
function authUrl(clientId, redirect, state) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  return AUTH_URL + '?' + p.toString();
}
function stateOk(saved, got, now) { return !!saved && typeof saved.s === 'string' && saved.s.length >= 20 && saved.s === got && (now - (saved.at || 0)) <= STATE_TTL_MS; }

// API 小包裝：deps = { fetch, clientId, clientSecret, refresh }
function client(deps) {
  let tok = null;
  const f = deps.fetch;
  async function token() {
    if (tok) return tok;
    const r = await f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: deps.clientId, client_secret: deps.clientSecret, refresh_token: deps.refresh, grant_type: 'refresh_token' }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { const e = new Error('Google 授權失效（' + r.status + ' ' + String(j.error || '') + '）'); e.auth = j.error === 'invalid_grant'; throw e; }
    tok = j.access_token; return tok;
  }
  async function call(method, path, body) {
    const r = await f(API + path, { method, headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) return { notFound: true };
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Google 工作表 API ' + r.status + ' ' + String((j.error && j.error.message) || '').slice(0, 120));
    return j;
  }
  return {
    token,
    async ensureList(saved) {
      if (saved) { const g = await call('GET', '/users/@me/lists/' + encodeURIComponent(saved)); if (!g.notFound && g.id) return g.id; }
      const all = await call('GET', '/users/@me/lists?maxResults=100');
      const hit = (all.items || []).find((x) => x && x.title === LIST_TITLE);
      if (hit) return hit.id;
      return (await call('POST', '/users/@me/lists', { title: LIST_TITLE })).id;
    },
    create: (list, it) => call('POST', '/lists/' + encodeURIComponent(list) + '/tasks', { title: it.title, notes: it.notes }),
    patch: (list, task, body) => call('PATCH', '/lists/' + encodeURIComponent(list) + '/tasks/' + encodeURIComponent(task), body),
  };
}
// 用授權碼換 refresh token（只在授權回呼用一次）
async function exchange(f, clientId, clientSecret, redirect, code) {
  const r = await f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, code, grant_type: 'authorization_code' }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error('換取授權失敗（' + r.status + ' ' + String(j.error || '沒有 refresh token') + '）');
  return j.refresh_token;
}

// 執行一次同步（I/O 都由參數提供，方便測試）：io = { api, map, listId, madeToday, todo, cfg }
// 回傳 { listId, map（新的對應表）, made, done, errs, deferred }
async function run(io) {
  const items = flatten(io.todo, io.cfg);
  const map = Object.assign({}, io.map || {});
  const p = plan(items, map, io.madeToday, io.limit);
  const listId = await io.api.ensureList(io.listId);
  const errs = []; let made = 0, done = 0;
  const now = io.now || Date.now();
  for (const it of p.create) {
    try { const t = await io.api.create(listId, it); if (t && t.id) { map[it.gid] = { task: t.id, title: it.title, done: false, at: now }; made++; } }
    catch (e) { errs.push(it.gid + '：' + e.message); if (/授權/.test(e.message)) break; }
  }
  for (const x of p.reopen.concat(p.retitle)) {
    try { const r = await io.api.patch(listId, x.task, { status: 'needsAction', title: x.title }); if (r && r.notFound) delete map[x.gid]; else map[x.gid] = Object.assign({}, map[x.gid], { title: x.title, done: false, at: now }); }
    catch (e) { errs.push(x.gid + '：' + e.message); }
  }
  for (const x of p.complete) {
    try { const r = await io.api.patch(listId, x.task, { status: 'completed' }); if (r && r.notFound) delete map[x.gid]; else { map[x.gid] = Object.assign({}, map[x.gid], { done: true, at: now }); done++; } }
    catch (e) { errs.push(x.gid + '：' + e.message); }
  }
  // 打勾超過 30 天的對應紀錄清掉（同一張卡片很久以後又出現就當新的建）
  Object.keys(map).forEach((g) => { const m = map[g]; if (m && m.done && now - (m.at || 0) > 30 * 86400000) delete map[g]; });
  return { listId, map, made, done, errs, deferred: p.deferred.length };
}

function failTodo(errs, now) {
  if (!errs || !errs.length) return null;
  return { fail: { id: 'gtasks_fail', src: 'gtasks', key: 'fail', urgent: false, text: '待辦同步 Google 工作表失敗 ' + errs.length + ' 筆', sub: String(errs[0]).slice(0, 120), go: 'staff', at: now || Date.now() } };
}

module.exports = { flatten, plan, authUrl, stateOk, client, exchange, run, failTodo, gid, LIST_TITLE, DAILY_LIMIT, SCOPE, STATE_TTL_MS };
