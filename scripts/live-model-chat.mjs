/**
 * Chat réel minimal, en flux, pour chaque identifiant texte épinglé.
 * N'utilise une clé que si FSM_OPENROUTER_TEST_KEY est déjà dans l'environnement.
 * Ne lit aucun fichier de secrets, n'affiche jamais la clé, n'envoie aucun contenu client.
 *
 * Sans clé : code de sortie 2, aucun appel.
 * Avec clé : un message « ok », max_tokens 16, arrêt dès la première preuve.
 * Succès seulement si le champ model de la réponse est exactement l'identifiant demandé.
 */
import { readFileSync } from 'node:fs';

const key = process.env.FSM_OPENROUTER_TEST_KEY || '';
if (!key){
  console.log(JSON.stringify({
    tested: false,
    reason: 'Aucune clé de test dans FSM_OPENROUTER_TEST_KEY. Chat réel non exécuté. Ne pas utiliser une clé client.'
  }, null, 2));
  process.exit(2);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function one(re){ const m = html.match(re); if (!m) throw new Error('constante manquante ' + re); return m[1]; }
const ids = [...new Set([
  one(/const PLAN_MODEL = '([^']+)'/),
  one(/const PLAN_MODEL_FREE = '([^']+)'/),
  ...[...one(/const BRAIN_FALLBACK = \{([^}]+)\}/).matchAll(/'([^']+\/[^']+)'/g)].map(m => m[1]),
  ...[...html.matchAll(/botModel\(\) : '([^']+)'/g)].map(m => m[1]),
  ...[...html.matchAll(/return cur && hasParam\(cur, 'tools'\) && !isXai\(cur\.id\) \? cur\.id : '([^']+)'/g)].map(m => m[1])
])];

const results = [];
for (const id of ids){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  const row = { id, ok: false, http: null, resolvedModel: null, sawDelta: false, error: null };
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
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: 'user', content: 'Réponds uniquement : ok' }]
      })
    });
    row.http = res.status;
    if (!res.ok){
      const t = await res.text();
      row.error = t.slice(0, 240).replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-REDACTED');
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (!row.sawDelta){
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
          let j;
          try{ j = JSON.parse(data); }catch{ continue; }
          if (j.error){ row.error = String(j.error.message || j.error).slice(0, 240); break; }
          if (j.model) row.resolvedModel = j.model;
          const d = j.choices?.[0]?.delta || {};
          if (typeof d.content === 'string' && d.content) row.sawDelta = true;
        }
        if (row.error) break;
      }
      try{ await reader.cancel(); }catch{}
      row.ok = row.sawDelta && row.resolvedModel === id && !row.error;
      if (row.resolvedModel && row.resolvedModel !== id) row.error = 'Le modèle résolu ' + row.resolvedModel + ' n\'est pas l\'identifiant demandé.';
      if (!row.sawDelta && !row.error) row.error = 'Flux sans texte du modèle demandé.';
    }
  }catch(e){
    row.error = e.name === 'AbortError' ? 'délai dépassé' : String(e.message || e).slice(0, 240);
  }finally{
    clearTimeout(timer);
    ctl.abort();
  }
  results.push(row);
  console.log(JSON.stringify(row));
}

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ tested: true, count: results.length, failed: failed.length }, null, 2));
if (failed.length) process.exit(1);
