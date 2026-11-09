#!/usr/bin/env node
// v6.0.190 AI 草稿上傳（指令列）：不再靠操作 FJ 網頁。用 AI 唯讀帳號登入 → 呼叫雲端 fyDraft → 雲端做跟網頁一樣的試算檢查才收。
// 說明見 docs/AI草稿上傳_使用說明.md。只用 Node 18 以上內建的 fetch，不用裝套件。
//
//   node tools/fy-draft.js login     [--env test]     第一次用：輸入 AI 帳號密碼（不顯示、不存密碼，只存登入通行證）
//   node tools/fy-draft.js submit 草稿.json [--env test]
//   node tools/fy-draft.js mine      [--env test]     列出自己還在待確認的草稿
//   node tools/fy-draft.js withdraw <草稿id> [--env test]
//   node tools/fy-draft.js inbox     [--env test]     LINE 收件匣未歸檔的清單（v6.0.191）
//   node tools/fy-draft.js inbox-suggest <收件id> --qid <報價id> | --case <案名> [--why 處理說明] [--note 備註]
//   node tools/fy-draft.js bidstats  [--env test]     報價統計：工項類別、筆數、得標率、平均讓價比例、建議調幅（v6.0.213）
//   node tools/fy-draft.js logout    [--env test]
//
// 預設連正式專案 jhchen-aed9a；--env test 連測試專案 fj-system-test（先在測試專案練習）。
// 通行證存在「使用者資料夾/.fj-draft/<env>.json」（不在 repo 裡、只有自己能讀）；密碼不寫進任何檔案。
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), readline = require('readline');

const args = process.argv.slice(2);
const envI = args.indexOf('--env'); const ENV = envI >= 0 ? String(args[envI + 1] || '') : 'prod';
if (envI >= 0) args.splice(envI, 2);
if (ENV !== 'prod' && ENV !== 'test') die('--env 只能是 prod 或 test');
const cmd = args[0] || 'help';

function die(msg, code) { console.error('✗ ' + msg); process.exit(code || 1); }
function out(o) { console.log(JSON.stringify(o, null, 2)); }

// 專案設定從 app.js 的 FB_CONFIGS 讀（網頁用的公開設定；apiKey 本來就公開在網頁上，不是密鑰）
function cfg() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const blk = src.slice(src.indexOf('const FB_CONFIGS'), src.indexOf('const FB_CONFIG ='));
  const part = blk.slice(blk.indexOf(ENV + ':'));
  const g = (k) => { const m = part.match(new RegExp(k + ':\\s*"([^"]+)"')); return m ? m[1] : ''; };
  const c = { apiKey: g('apiKey'), projectId: g('projectId'), db: g('databaseURL') };
  if (!c.apiKey || !c.projectId) die('讀不到 app.js 裡的 Firebase 設定（' + ENV + '）');
  return c;
}
const C = cfg();
const FN = 'https://asia-southeast1-' + C.projectId + '.cloudfunctions.net/fyDraft';
const DIR = path.join(os.homedir(), '.fj-draft'), TOK = path.join(DIR, ENV + '.json');

function ask(q, hide) {
  if (!hide || !process.stdin.isTTY) return new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });
  // 審查：密碼用原始模式一個字一個字讀，畫面完全不回顯（倒退鍵也不會把已打的字印出來）
  return new Promise((res) => {
    process.stdout.write(q); const st = process.stdin; let buf = '';
    st.setRawMode(true); st.resume(); st.setEncoding('utf8');
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') { st.setRawMode(false); st.pause(); st.removeListener('data', on); process.stdout.write('\n'); res(buf); return; }
        if (c === '\u0003') { st.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    st.on('data', on);
  });
}
async function post(url, body, headers) {
  const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { ok: r.ok, status: r.status, j };
}
async function login() {
  const email = process.env.FY_AI_EMAIL || await ask('AI 帳號 email：');
  const pass = process.env.FY_AI_PASS || await ask('密碼（不會顯示）：', true);
  const r = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + C.apiKey, { email: String(email).trim(), password: pass, returnSecureToken: true });
  if (!r.ok) die('登入失敗：' + ((r.j.error && r.j.error.message) || r.status));
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOK, JSON.stringify({ email: r.j.email, refresh: r.j.refreshToken, project: C.projectId }), { mode: 0o600 });
  out({ ok: true, email: r.j.email, project: C.projectId, saved: TOK });
}
async function idToken() {
  let t; try { t = JSON.parse(fs.readFileSync(TOK, 'utf8')); } catch (e) { die('還沒登入：先跑 node tools/fy-draft.js login' + (ENV === 'test' ? ' --env test' : '')); }
  if (t.project !== C.projectId) die('通行證是別的專案的，請重新 login');
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + C.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(t.refresh) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) die('通行證失效（可能改過密碼）：請重新 login');
  return j.id_token;
}
async function call(body) {
  const tk = await idToken();
  const r = await post(FN, body, { Authorization: 'Bearer ' + tk });
  if (!r.ok) { out({ ok: false, status: r.status, error: (r.j.error && r.j.error.message) || ('HTTP ' + r.status), detail: r.j.detail || undefined }); process.exit(2); }
  out(r.j);
}

(async () => {
  if (cmd === 'login') return login();
  if (cmd === 'logout') { try { fs.unlinkSync(TOK); } catch (e) { /* 本來就沒有 */ } return out({ ok: true }); }
  if (cmd === 'mine') return call({ action: 'mine' });
  if (cmd === 'withdraw') { if (!args[1] || /^--/.test(args[1])) die('要給草稿 id'); return call({ action: 'withdraw', id: args[1] }); }
  if (cmd === 'inbox') return call({ action: 'inboxList' });
  if (cmd === 'bidstats') {   // v6.0.213：讀 private 的 bidStats（管理員裝置上傳時算好；只有類別與比例，沒有案名、業主、金額）
    if (!C.db) die('讀不到資料庫網址');
    const tk = await idToken();
    const r = await fetch(C.db.replace(/\/$/, '') + '/fydata/private/bidStats.json?auth=' + encodeURIComponent(tk));
    const j = await r.json().catch(() => null);
    if (!r.ok) die('讀不到報價統計（HTTP ' + r.status + '）');
    return out(j || { ok: false, error: '還沒有統計（管理員裝置同步一次後才會有）' });
  }
  if (cmd === 'inbox-suggest') {
    if (!args[1] || /^--/.test(args[1])) die('要給收件 id');
    const opt = (k) => { const i = args.indexOf('--' + k), v = i >= 0 ? String(args[i + 1] || '') : ''; return /^--/.test(v) ? '' : v; };   // 審查：下一個是旗標就當沒給
    return call({ action: 'inboxSuggest', id: args[1], qid: opt('qid'), caseName: opt('case'), why: opt('why'), note: opt('note') });
  }
  if (cmd === 'submit') {
    if (!args[1]) die('要給草稿 JSON 檔');
    let d; try { d = JSON.parse(fs.readFileSync(args[1], 'utf8')); } catch (e) { die('讀不到或不是 JSON：' + args[1]); }
    return call(Object.assign({}, d, { action: 'submit' }));
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
})().catch((e) => die(String(e && e.message || e)));
