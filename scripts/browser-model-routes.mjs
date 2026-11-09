/**
 * Charge index.html dans Chrome, exécute les tests produit,
 * puis résout le routeur sur le catalogue OpenRouter réel.
 * Aucune clé, aucun contenu client. Le résultat n'est pas un chat réel.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const port = 9333;
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/chrome-fsm-models',
  'http://127.0.0.1:8765/index.html'
], { stdio: 'ignore' });

async function waitJson(){
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline){
    try{
      const r = await fetch(`http://127.0.0.1:${port}/json`);
      if (r.ok){
        const list = await r.json();
        const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    }catch{}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome DevTools injoignable');
}

function cdp(ws){
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)){
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

let ws;
try{
const page = await waitJson();
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
const call = cdp(ws);
await call('Runtime.enable');

async function ev(expression, timeout = 120000){
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (result.exceptionDetails){
    const d = result.exceptionDetails;
    throw new Error(d.text + ' ' + (d.exception?.description || ''));
  }
  return result.result?.value;
}

await ev(`new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => {
    if (typeof S !== 'undefined' && S.models && S.models.length > 50) resolve(S.models.length);
    else if (Date.now() - t0 > 25000) reject(new Error('catalogue non chargé'));
    else setTimeout(tick, 200);
  };
  tick();
})`);

const routes = await ev(`(() => {
  const prompts = [
    ['salut', 'bonjour'],
    ['question courte', 'quelle heure est-il ?'],
    ['code court', 'écris une fonction qui additionne deux nombres'],
    ['code normal', 'Écris un script Python qui lit un fichier CSV de ventes, calcule le total par région et affiche un tableau trié. Ajoute une fonction pour filtrer une région.'],
    ['texte', 'Explique comment fonctionne un four solaire destiné à un particulier, avec les matériaux, les étapes et les précautions.'],
    ['exigeant', "Rédige un rapport détaillé sur la stratégie d'investissement et l'audit fiscal de cette entreprise, avec une analyse approfondie."],
    ['image', "génère une image d'un phare à l'aube"],
    ['video', 'fais une vidéo de vagues']
  ];
  const plans = [
    ['free', ''],
    ['entreprise', 'corser50'], ['entreprise', 'corser55'], ['entreprise', 'corser60'],
    ['competence', 'neural55'], ['competence', 'neural60'],
    ['elite', 'omega80'], ['elite', 'omega90']
  ];
  const saved = { plan: S.set.plan, variant: S.set.variant, keyInfo: S.keyInfo, models: null };
  S.keyInfo = { limit: 18, used: 1, remaining: 17, weekly: 0.1, monthly: 1, t: Date.now() };
  const ids = new Set(S.models.map(m => m.id));
  const out = [];
  try {
    for (const [plan, variant] of plans){
      S.set.plan = plan; S.set.variant = variant;
      for (const [name, text] of prompts){
        let row;
        try {
          const uni = universalRoute(text, [], { messages: [] });
          const model = uni && uni.model;
          row = { plan, variant, name, cat: uni && uni.cat, model: model || null, blocked: !!(uni && uni.blocked), inCatalog: !model || ids.has(model), error: null };
        } catch (e) { row = { plan, variant, name, error: String(e.message || e).slice(0, 180) }; }
        out.push(row);
      }
    }
  } finally {
    S.set.plan = saved.plan; S.set.variant = saved.variant; S.keyInfo = saved.keyInfo;
  }
  return { catalog: S.models.length, rows: out };
})()`);

const tests = await ev(`(async () => {
  const r = await runProductTests();
  return { pass: r.pass, total: r.total, fail: (r.fail || []).slice(0, 20).map(f => ({ name: f.name, detail: String(f.detail || '').slice(0, 180) })) };
})()`, 180000);

const report = { testedAt: new Date().toISOString(), productTests: tests, routes };
const out = process.argv[2] || '/opt/cursor/artifacts/routes-modeles-fsm.json';
writeFileSync(out, JSON.stringify(report, null, 2));
const bad = (routes.rows || []).filter(r => r.error || r.inCatalog === false);
const testFail = tests.total !== tests.pass;
console.log(JSON.stringify({ product: tests.pass + '/' + tests.total, fails: tests.fail, routes: routes.rows.length, unresolved: bad.length, catalog: routes.catalog }, null, 2));
if (testFail || bad.length) process.exitCode = 1;
} finally {
  try{ ws && ws.close(); }catch{}
  chrome.kill();
}
