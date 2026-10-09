// Lê a planilha do Google Sheets e devolve os valores exatamente como a planilha calcula.
// O painel não refaz contas: indicadores e avanço por setor vêm da aba Dashboard;
// colunas calculadas (Avanço, Registro atual, Horas, Km acumulados, Avanço acumulado) vêm da aba Monitoramento.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   SHEET_ID        (obrigatória) ID da planilha
//   GOOGLE_API_KEY  (recomendada) chave da Google Sheets API
//   CACHE_SEGUNDOS  (opcional) tempo de cache na CDN da Vercel; padrão 15
//   ABA_MONITORAMENTO / ABA_CADASTRO / ABA_DASHBOARD (opcionais) nomes das abas, se forem renomeadas

const ABA_MON = process.env.ABA_MONITORAMENTO || 'Monitoramento';
const ABA_CAD = process.env.ABA_CADASTRO || 'Cadastro de Setores';
const ABA_DASH = process.env.ABA_DASHBOARD || 'Dashboard';
const CACHE = Math.max(5, parseInt(process.env.CACHE_SEGUNDOS || '15', 10) || 15);

// faixas lidas (linha 5 = primeira linha de dados)
const F_MON = 'A5:S';
const F_CAD = 'A5:F';
const F_IND = 'A5:C14';   // Dashboard: indicadores
const F_SET = 'A17:E';    // Dashboard: acompanhamento por setor

// rótulos da coluna A do Dashboard → chave usada no painel
const INDICADORES = {
  'setores cadastrados': 'cadastrados',
  'setores iniciados': 'iniciados',
  'setores concluidos': 'concluidos',
  'efetivo em campo': 'efetivo',
  'veiculos registrados': 'veiculos',
  'aguardando instrucao': 'aguardandoInstr',
  'avanco medio dos setores': 'avancoMedio',
  'setores em execucao': 'emExecucao',
  'km totais executados': 'km',
  'horas totais de operacao': 'horas',
};

let memo = null; // cache da instância quente

module.exports = async function handler(req, res) {
  const id = (process.env.SHEET_ID || '').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!id) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, erro: 'SHEET_ID não configurado' }));
  }
  try {
    const agora = Date.now();
    let dados;
    if (memo && agora - memo.t < CACHE * 1000) {
      dados = memo.d;
    } else {
      const key = (process.env.GOOGLE_API_KEY || '').trim();
      const abas = key ? await viaSheetsApi(id, key) : await viaCsv(id);
      dados = montar(abas, key ? 'sheets-api' : 'link-publico');
      dados.geradoEm = new Date().toISOString();
      memo = { t: agora, d: dados };
    }
    res.statusCode = 200;
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE}, stale-while-revalidate=${CACHE * 8}`);
    res.end(JSON.stringify(dados));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e) }));
  }
};

/* ---------------- leitura ---------------- */

async function viaSheetsApi(id, key) {
  const q = (aba, faixa) => 'ranges=' + encodeURIComponent(`'${aba.replace(/'/g, "''")}'!${faixa}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet?` +
    [q(ABA_MON, F_MON), q(ABA_CAD, F_CAD), q(ABA_DASH, F_IND), q(ABA_DASH, F_SET)].join('&') +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Sheets API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const [mon, cad, ind, set] = j.valueRanges.map((v) => v.values || []);
  return { mon, cad, ind, set };
}

// Sem chave: lê pelo link público em CSV (valores como aparecem na planilha)
async function viaCsv(id) {
  const ler = async (aba, faixa) => {
    const fim = faixa.replace(/^([A-Z]+\d+:[A-Z]+)$/, '$15000');
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:csv&headers=0` +
      `&sheet=${encodeURIComponent(aba)}&range=${fim}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Google ${r.status} ao ler a aba ${aba}`);
    const t = await r.text();
    if (/^\s*</.test(t)) throw new Error(`A aba ${aba} não está acessível pelo link (verifique o compartilhamento)`);
    return csv(t);
  };
  const [mon, cad, ind, set] = await Promise.all([
    ler(ABA_MON, F_MON), ler(ABA_CAD, F_CAD), ler(ABA_DASH, F_IND), ler(ABA_DASH, F_SET),
  ]);
  return { mon, cad, ind, set };
}

function csv(t) {
  const linhas = [];
  let lin = [], cel = '', aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { lin.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      lin.push(cel); linhas.push(lin); lin = []; cel = '';
    } else cel += c;
  }
  if (cel !== '' || lin.length) { lin.push(cel); linhas.push(lin); }
  return linhas.map((l) => l.map((v) => (v === '' ? null : v)));
}

/* ---------------- montagem ---------------- */

function montar({ mon, cad, ind, set }, fonte) {
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
      avanco: num(r[10]),        // K
      termino: hora(r[11]),
      situacao: txt(r[12]),
      ocorrencias: txt(r[13]),
      fonte: txt(r[14]),
      atual: num(r[15]),         // P
      horas: num(r[16]),         // Q
      kmAcum: num(r[17]),        // R
      avancoAcum: num(r[18]),    // S
    };
    if (o.data || o.setor || o.encarregado || o.situacao) monitoramento.push(o);
  });

  const cadastro = [];
  cad.forEach((r, i) => {
    r = r || [];
    const o = { l: i + 5, setor: txt(r[0]), km: num(r[1]), encarregado: txt(r[2]), telefone: txt(r[3]), base: txt(r[4]), obs: txt(r[5]) };
    if (o.setor) cadastro.push(o);
  });

  const indicadores = {};
  const indicadoresLista = [];
  ind.forEach((r) => {
    r = r || [];
    const nome = txt(r[0]);
    if (!nome) return;
    const valor = num(r[1]);
    indicadoresLista.push({ nome, valor, obs: txt(r[2]) });
    const k = INDICADORES[semAcento(nome).toLowerCase()];
    if (k) indicadores[k] = valor;
  });

  const setores = [];
  set.forEach((r) => {
    r = r || [];
    const o = { setor: txt(r[0]), avanco: num(r[1]), situacao: txt(r[2]), km: num(r[3]), horas: num(r[4]) };
    if (o.setor) setores.push(o);
  });

  return { ok: true, fonte, indicadores, indicadoresLista, setores, monitoramento, cadastro };
}

/* ---------------- conversões ---------------- */

function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

function txt(v) {
  if (v == null) return '';
  return String(v).trim();
}

// aceita número puro ou texto no formato da planilha ("0,96", "50,0%", "1.234,5")
function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = String(v).trim();
  if (!s || /^#/.test(s)) return null;
  const pct = /%$/.test(s);
  s = s.replace(/[%\s]|km|h$/gi, '');
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return pct ? n / 100 : n;
}

const pad = (n) => String(n).padStart(2, '0');

// 'AAAA-MM-DD'
function data(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

// minutos desde 00:00, ou null
function hora(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const f = v - Math.floor(v);
    return Math.round(f * 1440 * 60) / 60;
  }
  const m = String(v).trim().match(/(\d{1,2})\s*[:hH]\s*(\d{2})?(?:\s*:\s*(\d{2}))?/);
  if (m) return ((+m[1]) % 24) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60;
  return null;
}
