/**
 * Chat réel minimal pour les identifiants texte réellement retenus par le routeur.
 *
 * Source des identifiants : le JSON produit par scripts/browser-model-routes.mjs
 *   node scripts/live-model-chat.mjs --routes /chemin/routes-modeles-fsm.json
 *
 * FSM_OPENROUTER_TEST_KEY absent : aucun appel, code 2.
 * FSM_TEST_BUDGET_USD absent : les modèles au tarif publié > 0 sont refusés, les gratuits peuvent partir.
 * FSM_TEST_MAX_TOKENS : borne de sortie (défaut 16). Une seule hausse si l'API indique un minimum, et seulement si elle tient dans le budget.
 * Image et vidéo : jamais appelées automatiquement.
 * Aucune clé affichée, aucun contenu client, aucun autre modèle en cascade.
 */
import { readFileSync } from 'node:fs';

const TEXT_CATS = new Set(['chat', 'code', 'reason', 'search', 'vision', 'videoin', 'audio', 'agents']);
const INPUT_TOKEN_BOUND = 64;

function arg(name){
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

function money(n){ return Math.round(n * 1e8) / 1e8; }

function publishedRates(model){
  const p = model?.pricing || {};
  const prompt = Number(p.prompt);
  const completion = Number(p.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  return { prompt, completion };
}

function estimateUsd(rates, outTokens){
  if (!rates) return null;
  return money(rates.prompt * INPUT_TOKEN_BOUND + rates.completion * outTokens);
}

export function selectCalls(rows, catalog, opts){
  const byId = new Map((catalog || []).map(m => [m.id, m]));
  const seen = new Set();
  const plan = [];
  for (const row of rows || []){
    if (!row || row.blocked || !row.model || seen.has(row.model)) continue;
    seen.add(row.model);
    const cat = row.cat || '';
    if (!TEXT_CATS.has(cat)){
      plan.push({ id: row.model, cat, call: false, reason: 'image ou vidéo : pas d\'appel automatique' });
      continue;
    }
    const info = byId.get(row.model);
    const rates = info ? publishedRates(info) : null;
    const est = estimateUsd(rates, opts.maxTokens);
    if (!info || rates == null || est == null){
      plan.push({ id: row.model, cat, call: false, reason: 'tarif publié inconnu : appel refusé' });
      continue;
    }
    const paid = est > 0;
    if (paid && opts.budget == null){
      plan.push({ id: row.model, cat, call: false, estimatedUsd: est, reason: 'budget absent : modèle payant refusé' });
      continue;
    }
    if (paid && est > opts.remaining){
      plan.push({ id: row.model, cat, call: false, estimatedUsd: est, reason: 'budget restant insuffisant pour la borne de tokens' });
      continue;
    }
    plan.push({ id: row.model, cat, call: true, estimatedUsd: est, paid });
    if (paid) opts.remaining = money(opts.remaining - est);
  }
  return plan;
}

function generationQuota(message){
  const t = String(message || '');
  const min = t.match(/(?:at least|minimum|min(?:imum)?(?:\s+of)?|must be(?: at least)?)\s+(\d{2,6})/i)
    || t.match(/max(?:imum)?[_\s-]*tokens[^0-9]{0,40}(\d{2,6})/i);
  const quota = /max(?:imum)?[_\s-]*tokens|output limit|reasoning tokens|token limit|minimum of \d+/i.test(t);
  return { quota, minimum: min ? Number(min[1]) : null };
}

function loadRoutes(file){
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const rows = data.routes?.rows || data.rows;
  if (!Array.isArray(rows)) throw new Error('JSON de routes sans liste rows');
  return rows;
}

function selfCheck(){
  const catalog = [
    { id: 'free/a', pricing: { prompt: '0', completion: '0' } },
    { id: 'paid/b', pricing: { prompt: '0.000002', completion: '0.00001' } },
    { id: 'img/c', pricing: { prompt: '0', completion: '0', image: '0.04' } }
  ];
  const rows = [
    { model: 'free/a', cat: 'chat' },
    { model: 'paid/b', cat: 'code' },
    { model: 'img/c', cat: 'image' },
    { model: 'free/a', cat: 'chat' }
  ];
  const noBudget = selectCalls(rows, catalog, { budget: null, remaining: 0, maxTokens: 16 });
  const withBudget = selectCalls(rows, catalog, { budget: 1, remaining: 1, maxTokens: 16 });
  const est = estimateUsd(publishedRates(catalog[1]), 16);
  const q = generationQuota('max_tokens must be at least 128');
  const ok = noBudget.filter(x => x.call).map(x => x.id).join() === 'free/a'
    && noBudget.find(x => x.id === 'paid/b').reason.includes('budget absent')
    && noBudget.find(x => x.id === 'img/c').reason.includes('image ou vidéo')
    && withBudget.filter(x => x.call).length === 2
    && est > 0 && est < 0.01
    && q.quota && q.minimum === 128;
  console.log(JSON.stringify({ selfCheck: ok, noBudget, paidEstimateUsd: est, quota: q }, null, 2));
  if (!ok) process.exit(1);
}

if (process.argv.includes('--self-check')){
  selfCheck();
  process.exit(0);
}

const key = process.env.FSM_OPENROUTER_TEST_KEY || '';
const routesFile = arg('--routes') || process.env.FSM_TEST_ROUTES || '';
if (!key){
  let candidates = null;
  if (routesFile){
    try{
      const seen = new Set();
      candidates = [];
      for (const r of loadRoutes(routesFile)){
        if (!r.model || r.blocked || seen.has(r.model)) continue;
        seen.add(r.model);
        candidates.push((r.cat || '?') + ':' + r.model);
      }
    }catch(e){ candidates = ['routes illisibles : ' + e.message]; }
  }
  console.log(JSON.stringify({
    tested: false,
    reason: 'Aucune clé de test dans FSM_OPENROUTER_TEST_KEY. Aucun appel. Ne pas utiliser une clé client.',
    routesFile: routesFile || null,
    candidateLabels: candidates
  }, null, 2));
  process.exit(2);
}

if (!routesFile){
  console.log(JSON.stringify({ tested: false, reason: 'Fichier --routes absent. Aucun appel : le runner ne se limite pas aux replis codés en dur.' }, null, 2));
  process.exit(2);
}

const budgetRaw = process.env.FSM_TEST_BUDGET_USD;
const budget = budgetRaw == null || budgetRaw === '' ? null : Number(budgetRaw);
if (budget != null && (!Number.isFinite(budget) || budget < 0)){
  console.log(JSON.stringify({ tested: false, reason: 'FSM_TEST_BUDGET_USD illisible. Aucun appel.' }, null, 2));
  process.exit(2);
}
const maxTokens = Math.max(1, Math.min(512, Number(process.env.FSM_TEST_MAX_TOKENS || 16) || 16));

const catalogRes = await fetch('https://openrouter.ai/api/v1/models?output_modalities=all', { headers: { accept: 'application/json' } });
if (!catalogRes.ok){
  console.log(JSON.stringify({ tested: false, reason: 'Catalogue public illisible, aucun chat lancé.', http: catalogRes.status }, null, 2));
  process.exit(1);
}
const catalog = (await catalogRes.json()).data || [];
const rows = loadRoutes(routesFile);
const plan = selectCalls(rows, catalog, { budget, remaining: budget == null ? 0 : budget, maxTokens });

async function oneCall(id, outTokens){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  const row = { id, http: null, resolvedModel: null, sawDelta: false, finish: null, reasoningTokens: 0, error: null, usageCost: null };
  try{
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        'http-referer': 'https://app.fsmai.app',
        'x-title': 'FSM AI model check'
      },
      body: JSON.stringify({
        model: id,
        stream: true,
        max_tokens: outTokens,
        temperature: 0,
        usage: { include: true },
        messages: [{ role: 'user', content: 'Réponds uniquement : ok' }]
      })
    });
    row.http = res.status;
    if (!res.ok){
      row.error = (await res.text()).slice(0, 300).replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-REDACTED');
      return row;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const take = async () => {
      while (true){
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0){
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let j; try{ j = JSON.parse(data); }catch{ continue; }
          if (j.error){ row.error = String(j.error.message || j.error).slice(0, 300); return; }
          if (j.model) row.resolvedModel = j.model;
          const ch = j.choices?.[0] || {};
          const d = ch.delta || {};
          if (typeof d.content === 'string' && d.content) row.sawDelta = true;
          if (ch.finish_reason) row.finish = ch.finish_reason;
          const rt = j.usage?.completion_tokens_details?.reasoning_tokens;
          if (rt) row.reasoningTokens = rt;
          if (j.usage && j.usage.cost != null) row.usageCost = Number(j.usage.cost);
        }
      }
    };
    await take();
    try{ await reader.cancel(); }catch{}
  }catch(e){
    row.error = e.name === 'AbortError' ? 'délai dépassé' : String(e.message || e).slice(0, 240);
  }finally{
    clearTimeout(timer);
    ctl.abort();
  }
  return row;
}

const results = [];
let spent = 0;
for (const item of plan){
  if (!item.call){
    results.push({ id: item.id, cat: item.cat, tested: false, reason: item.reason, estimatedUsd: item.estimatedUsd ?? null });
    console.log(JSON.stringify(results[results.length - 1]));
    continue;
  }
  let outTokens = maxTokens;
  let attempt = await oneCall(item.id, outTokens);
  let quotaNote = null;
  const q = generationQuota(attempt.error || '');
  const emptyReasoning = !attempt.sawDelta && !attempt.error && (attempt.finish === 'length' || attempt.reasoningTokens > 0);
  if (!attempt.sawDelta && (q.quota || emptyReasoning)){
    const next = q.minimum && q.minimum > outTokens ? q.minimum : Math.min(256, Math.max(64, outTokens * 8));
    const info = catalog.find(m => m.id === item.id);
    const est2 = estimateUsd(publishedRates(info), next);
    const room = budget == null ? 0 : money(budget - spent);
    if (est2 == null || (est2 > 0 && (budget == null || est2 > room))){
      quotaNote = 'plafond de génération, pas une indisponibilité ; réessai non lancé car il sortirait du budget';
    } else if (next !== outTokens){
      attempt = await oneCall(item.id, next);
      outTokens = next;
      quotaNote = 'un seul réessai avec max_tokens ' + next;
    }
  }
  const resolvedOk = !attempt.resolvedModel || attempt.resolvedModel === item.id;
  const ok = attempt.sawDelta && resolvedOk && !attempt.error && attempt.http === 200;
  let reason = null;
  if (!ok){
    if (quotaNote && !attempt.sawDelta) reason = quotaNote;
    else if (q.quota || emptyReasoning) reason = 'plafond de génération ou raisonnement, pas une preuve d\'indisponibilité';
    else if (attempt.resolvedModel && attempt.resolvedModel !== item.id) reason = 'modèle résolu ' + attempt.resolvedModel + ' différent de l\'identifiant demandé';
    else reason = attempt.error || 'flux sans texte';
  }
  const actual = Number.isFinite(attempt.usageCost) ? attempt.usageCost : (ok || attempt.http === 200 ? item.estimatedUsd : 0);
  if (actual > 0) spent = money(spent + actual);
  const out = {
    id: item.id, cat: item.cat, tested: true, ok, http: attempt.http, resolvedModel: attempt.resolvedModel,
    maxTokens: outTokens, estimatedUsd: item.estimatedUsd, usageCost: attempt.usageCost, reason, quotaNote
  };
  results.push(out);
  console.log(JSON.stringify(out));
}

const called = results.filter(r => r.tested);
const failed = called.filter(r => !r.ok && !(r.reason || '').includes('plafond de génération') && !(r.reason || '').includes('réessai non lancé'));
console.log(JSON.stringify({
  tested: called.length > 0,
  called: called.length,
  skipped: results.length - called.length,
  inconclusiveGenerationQuota: called.filter(r => (r.reason || '').includes('plafond de génération') || (r.reason || '').includes('réessai')).length,
  failed: failed.length,
  spentUsdAccounted: spent,
  budgetUsd: budget,
  note: 'Couverture = identifiants uniques du fichier de routes, pas l\'ensemble du catalogue.'
}, null, 2));
if (failed.length) process.exit(1);
