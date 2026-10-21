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
    putFile: async (path, buf, contentType) => { await bucket.file(path).save(buf, { contentType, resumable: false }); },
    dbSet: async (path, val) => { await db.ref(path).set(val); },
    dbGet: async path => (await db.ref(path).once('value')).val(),
    reply: (replyToken, text) => lineJson(LINE_API + '/message/reply', { replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    push: (to, text) => lineJson(LINE_API + '/message/push', { to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
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
