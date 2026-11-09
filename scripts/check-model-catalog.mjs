/**
 * Vérifie les identifiants de modèles codés dans index.html
 * contre le catalogue public OpenRouter et la page officielle des modèles xAI.
 * Aucune clé, aucun secret, aucun contenu client.
 *
 *   node scripts/check-model-catalog.mjs
 *   node scripts/check-model-catalog.mjs --out /opt/cursor/artifacts/modeles-fsm.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const today = new Date().toISOString().slice(0, 10);

function grab(re, label){
  const m = html.match(re);
  if (!m) throw new Error('Constante introuvable : ' + label);
  return m;
}

const PLAN_MODEL = grab(/const PLAN_MODEL = '([^']+)'/, 'PLAN_MODEL')[1];
const PLAN_MODEL_FREE = grab(/const PLAN_MODEL_FREE = '([^']+)'/, 'PLAN_MODEL_FREE')[1];
const FAST_STT = grab(/const FAST_STT_FALLBACK = '([^']+)'/, 'FAST_STT_FALLBACK')[1];
const brainRaw = grab(/const BRAIN_FALLBACK = \{([^}]+)\}/, 'BRAIN_FALLBACK')[1];
const brains = [...brainRaw.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(s => s.includes('/'));
const fallbacks = [
  ...[...html.matchAll(/botModel\(\) : '([^']+)'/g)].map(m => m[1]),
  ...[...html.matchAll(/!isXai\(cur\.id\) \? cur\.id : '([^']+)'/g)].map(m => m[1])
];
const xaiBlock = html.match(/const XAI_MODELS = \[([\s\S]*?)\n\];/);
if (!xaiBlock) throw new Error('XAI_MODELS introuvable');
const xaiIds = [...xaiBlock[1].matchAll(/\['(grok-[a-z0-9.-]+)'/g)].map(m => m[1]);
const retiredBlock = html.match(/const XAI_RETIRED = Object\.freeze\(\{([^}]+)\}\)/);
if (!retiredBlock) throw new Error('XAI_RETIRED introuvable');
const retired = [...retiredBlock[1].matchAll(/'(grok-[a-z0-9.-]+)': '(grok-[a-z0-9.-]+)'/g)].map(m => ({ from: m[1], to: m[2] }));

const pins = [...new Set([PLAN_MODEL, PLAN_MODEL_FREE, FAST_STT, ...brains, ...fallbacks])];

async function getJson(url){
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  return r.json();
}

const catalog = await getJson('https://openrouter.ai/api/v1/models?output_modalities=all');
const models = new Map((catalog.data || []).map(m => [m.id, m]));
const rows = pins.map(id => {
  const m = models.get(id);
  return {
    id,
    present: !!m,
    name: m?.name || null,
    expiration: m?.expiration_date || null,
    prompt: m?.pricing?.prompt ?? null,
    completion: m?.pricing?.completion ?? null,
    output: (m?.architecture?.output_modalities || []).join(','),
    responseFormat: !!(m?.supported_parameters || []).includes('response_format')
  };
});

const xaiPage = await fetch('https://docs.x.ai/developers/models', { headers: { accept: 'text/html', 'user-agent': 'fsm-ai-model-check' } });
const xaiHtml = xaiPage.ok ? await xaiPage.text() : '';
const xaiNames = new Set([...xaiHtml.matchAll(/"name":"(grok-[^"]+)"/g)].map(m => m[1]));
const xaiRows = xaiIds.map(id => ({ id, listedOnDocs: xaiNames.has(id) }));
const retiredRows = retired.map(r => ({ ...r, fromStillOffered: xaiIds.includes(r.from), replacementListed: xaiNames.has(r.to) }));

const report = {
  checkedAt: new Date().toISOString(),
  date: today,
  sources: {
    openrouter: 'https://openrouter.ai/api/v1/models?output_modalities=all',
    openrouterCount: models.size,
    xaiDocs: 'https://docs.x.ai/developers/models',
    xaiDocsStatus: xaiPage.status,
    xaiNames: xaiNames.size
  },
  openrouterPins: rows,
  xaiOffered: xaiRows,
  xaiRetiredMap: retiredRows,
  notes: [
    'Les identifiants cités seulement dans les jeux d\'essai de la page ne sont pas exigés ici.',
    'Aucun appel facturé : lecture du catalogue public uniquement.'
  ]
};

const missing = rows.filter(r => !r.present).map(r => r.id);
const xaiMissing = xaiPage.ok ? xaiRows.filter(r => !r.listedOnDocs).map(r => r.id) : ['docs xAI injoignables'];
const retiredStillOffered = retiredRows.filter(r => r.fromStillOffered).map(r => r.from);
const badReplacement = retiredRows.filter(r => xaiPage.ok && !r.replacementListed).map(r => r.to);
const freePin = rows.find(r => r.id === PLAN_MODEL_FREE);
const freeOk = !!(freePin && freePin.present && freePin.id.endsWith(':free') && Number(freePin.prompt) === 0 && Number(freePin.completion) === 0 && !freePin.expiration);

report.ok = missing.length === 0 && xaiMissing.length === 0 && retiredStillOffered.length === 0 && badReplacement.length === 0 && freeOk;
report.failures = { missing, xaiMissing, retiredStillOffered, badReplacement, freeOk };

const outIdx = process.argv.indexOf('--out');
const text = JSON.stringify(report, null, 2);
if (outIdx >= 0 && process.argv[outIdx + 1]) writeFileSync(process.argv[outIdx + 1], text);
console.log(text);
if (!report.ok) process.exit(1);
