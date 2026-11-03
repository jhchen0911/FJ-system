// LINE 機器人：Firebase Admin（RTDB／Storage）與 LINE Messaging API 的實作，交給 core.js 使用
'use strict';
const admin = require('firebase-admin');

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA = 'https://api-data.line.me/v2/bot';

function mkDeps(token) {
  const db = admin.database();
  const bucket = admin.storage().bucket();
  const auth = { Authorization: 'Bearer ' + token };
  const lineJson = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('LINE API ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  };
  return {
    getCfg: async () => (await db.ref('fydata/lineCfg').once('value')).val() || {},
    fetchContent: async msgId => {
      const r = await fetch(LINE_DATA + '/message/' + encodeURIComponent(msgId) + '/content', { headers: auth });
      if (!r.ok) throw new Error('LINE content ' + r.status);
      return { buf: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'application/octet-stream' };
    },
    // v6.0.144 審查：認領一筆紀錄（不存在才寫）→ true；已經有人在處理或處理過 → false
    claim: async (path, val) => (await db.ref(path).transaction((cur) => (cur ? undefined : val))).committed,
    putFile: async (path, buf, contentType) => { await bucket.file(path).save(buf, { contentType, resumable: false }); },
    // v6.0.144：串流存檔（大檔不進記憶體）；邊收邊計大小，超過上限就中止並刪掉半截檔 → {tooBig:true,size}；成功 → {size, contentType}
    saveContent: async (msgId, path, max) => {
      const r = await fetch(LINE_DATA + '/message/' + encodeURIComponent(msgId) + '/content', { headers: auth, signal: AbortSignal.timeout(200 * 1000) });   // 審查：傳輸卡住 200 秒就放棄（記 error），不會拖到函式被殺
      if (!r.ok || !r.body) throw new Error('LINE content ' + r.status);
      const len = parseInt(r.headers.get('content-length') || '0', 10) || 0;
      if (len > max) { try { await r.body.cancel(); } catch (e) { console.error('saveContent.cancel', e && e.message); } return { tooBig: true, size: len }; }
      const contentType = r.headers.get('content-type') || 'application/octet-stream';
      const { Readable, Transform } = require('stream');
      const { pipeline } = require('stream/promises');
      let size = 0, over = false;
      const count = new Transform({ transform(ch, enc, cb) { size += ch.length; if (size > max) { over = true; cb(new Error('tooBig')); return; } cb(null, ch); } });
      const file = bucket.file(path);
      try {
        await pipeline(Readable.fromWeb(r.body), count, file.createWriteStream({ contentType, resumable: !len || len > 8 * 1048576 }));
      } catch (e) {
        await file.delete({ ignoreNotFound: true }).catch((e2) => console.error('saveContent.cleanup', e2 && e2.message));
        if (over) return { tooBig: true, size };
        throw e;
      }
      return { size, contentType };
    },
    dbSet: async (path, val) => { await db.ref(path).set(val); },
    dbGet: async path => (await db.ref(path).once('value')).val(),
    reply: (replyToken, text) => lineJson(LINE_API + '/message/reply', { replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    push: (to, text) => lineJson(LINE_API + '/message/push', { to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    // v6.0.134 本月已用的推播則數（LINE 官方帳號額度）；查不到回 null
    quotaUsed: async () => {
      try {
        const r = await fetch(LINE_API + '/message/quota/consumption', { headers: auth, signal: AbortSignal.timeout(5000) });   // 審查：5 秒逾時
        if (!r.ok) { console.error('quotaUsed', r.status); return null; }
        const j = await r.json(); if (typeof j.totalUsage === 'number') return j.totalUsage;
        console.error('quotaUsed: 沒有 totalUsage'); return null;
      } catch (e) { console.error('quotaUsed', e && e.message); return null; }   // 審查：查不到要留紀錄，免得保護靜默失效
    },
    createDraft: async rec => {
      const ref = db.ref('fydata/drafts/' + rec.id);
      // 同一則訊息／同一天只建一次（webhook 重送、排程重跑都不重複）
      const tx = await ref.transaction(cur => (cur ? undefined : rec));
      return tx.committed;
    },
    findAddonDrafts: async (groupId, sinceTs) => {
      const v = (await db.ref('fydata/drafts').orderByChild('at').startAt(sinceTs).once('value')).val() || {};
      return Object.keys(v).map(k => v[k]).filter(d => d && d.type === 'addon' && d.status === 'pending' && d.payload && d.payload.groupId === groupId);
    },
    appendDraftPhotos: async (id, paths) => {
      await db.ref('fydata/drafts/' + id + '/payload/photos').transaction(cur => {
        const a = Array.isArray(cur) ? cur : [];
        paths.forEach(p => { if (a.indexOf(p) < 0) a.push(p); });
        return a.slice(0, 20);
      });
    },
    log: (...a) => console.error(...a),
  };
}

module.exports = { mkDeps };
