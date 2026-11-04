// 改版第 5 步：部署 Cloud Functions 前把 calc/（前端與雲端共用的純計算）複製進 functions/calc/。
// firebase.json 的 predeploy 會自動執行（Windows／Mac 都能跑，不用 cp 指令）；functions/calc/ 不進 git（.gitignore）。
// 雲端程式一律 require('./calc/xxx.js')，跟前端算同一份，不在雲端另寫一套。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'calc'), dst = path.join(root, 'functions', 'calc');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.js'));
files.forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dst, f)));
console.log('[copy-calc] 已複製 ' + files.length + ' 個計算檔到 functions/calc/');
