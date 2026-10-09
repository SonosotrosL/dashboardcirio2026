// Lê a planilha do Google Sheets e devolve os dados já normalizados para o painel.
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   SHEET_ID        (obrigatória) ID da planilha
//   GOOGLE_API_KEY  (recomendada) chave da Google Sheets API — leitura mais rápida e sem perda de tipos
//   CACHE_SEGUNDOS  (opcional) tempo de cache na CDN da Vercel; padrão 15
//   ABA_MONITORAMENTO / ABA_CADASTRO (opcionais) nomes das abas, se forem renomeadas

const ABA_MON = process.env.ABA_MONITORAMENTO || 'Monitoramento';
const ABA_CAD = process.env.ABA_CADASTRO || 'Cadastro de Setores';
const CACHE = Math.max(5, parseInt(process.env.CACHE_SEGUNDOS || '15', 10) || 15);

let memo = null; // cache da instância quente

module.exports = async function handler(req, res) {
  const id = (process.env.SHEET_ID || '').trim();
  if (!id) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, erro: 'SHEET_ID não configurado' }));
  }
  try {
    const agora = Date.now();
    let dados;
    if (memo && agora - memo.t < CACHE * 1000) {
      dados = memo.d;
    } else {
      const key = (process.env.GOOGLE_API_KEY || '').trim();
      dados = key ? await viaSheetsApi(id, key) : await viaGviz(id);
      dados.geradoEm = new Date().toISOString();
      memo = { t: agora, d: dados };
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE}, stale-while-revalidate=${CACHE * 8}`);
    res.end(JSON.stringify(dados));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e) }));
  }
};

/* ---------------- leitura ---------------- */

async function viaSheetsApi(id, key) {
  const q = (s) => encodeURIComponent(`'${s.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet` +
    `?ranges=${q(ABA_MON)}!A5:O&ranges=${q(ABA_CAD)}!A5:F` +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Sheets API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const [mon, cad] = j.valueRanges.map((v) => v.values || []);
  return montar(mon, cad, 'sheets-api');
}

async function viaGviz(id) {
  const ler = async (aba, faixa) => {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json&headers=0` +
      `&sheet=${encodeURIComponent(aba)}&range=${faixa}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Google ${r.status} ao ler a aba ${aba}`);
    const t = await r.text();
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    if (j.status === 'error') throw new Error(`Aba ${aba}: ${(j.errors || []).map((e) => e.detailed_message || e.message).join('; ')}`);
    return (j.table.rows || []).map((row) => (row.c || []).map((c) => (c == null ? null : c.v == null ? (c.f ?? null) : c.v)));
  };
  const [mon, cad] = await Promise.all([ler(ABA_MON, 'A5:O3000'), ler(ABA_CAD, 'A5:F1000')]);
  return montar(mon, cad, 'gviz');
}

/* ---------------- normalização ---------------- */

function montar(mon, cad, fonte) {
  const monitoramento = [];
  mon.forEach((r, i) => {
    r = r || [];
    const o = {
      l: i + 5,
      data: data(r[0]),
      setor: txt(r[1]),
      encarregado: txt(r[2]),
      efetivo: num(r[3]),
      tipo: txt(r[4]),
      placa: txt(r[5]),
      inicio: hora(r[6]),
      atualizacao: hora(r[7]),
      local: txt(r[8]),
      km: num(r[9]),
      termino: hora(r[11]),
      situacao: txt(r[12]),
      ocorrencias: txt(r[13]),
      fonte: txt(r[14]),
    };
    if (o.data || o.setor) monitoramento.push(o);
  });
  const cadastro = [];
  cad.forEach((r, i) => {
    r = r || [];
    const o = { l: i + 5, setor: txt(r[0]), km: num(r[1]), encarregado: txt(r[2]), telefone: txt(r[3]), base: txt(r[4]), obs: txt(r[5]) };
    if (o.setor) cadastro.push(o);
  });
  return { ok: true, fonte, monitoramento, cadastro };
}

function txt(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s|km/gi, '');
  if (!s) return null;
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

const pad = (n) => String(n).padStart(2, '0');

// devolve 'AAAA-MM-DD'
function data(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) return `${m[1]}-${pad(+m[2] + 1)}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

// devolve minutos desde 00:00 (0–1439,99) ou null
function hora(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return (v[0] || 0) * 60 + (v[1] || 0) + (v[2] || 0) / 60;
  if (typeof v === 'number') {
    const f = v - Math.floor(v);
    return Math.round(f * 1440 * 60) / 60;
  }
  const s = String(v).trim();
  let m = s.match(/^Date\(\d+,\d+,\d+(?:,(\d+),(\d+)(?:,(\d+))?)?/);
  if (m) return (+m[1] || 0) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60;
  m = s.match(/(\d{1,2})\s*[:hH]\s*(\d{2})?(?:\s*:\s*(\d{2}))?/);
  if (m) return ((+m[1]) % 24) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60;
  return null;
}
