// Lê o site do Caderno de Operação e as planilhas que ele usa, para o painel refletir
// qualquer mudança feita lá: setores, trechos, links do Google Maps, mapas, equipe escalada
// e registros de campo do formulário.
//
// Variáveis de ambiente (opcionais):
//   SITE_URL             endereço do site; padrão https://belemlimpacirio2026.vercel.app
//   CACHE_SITE_SEGUNDOS  cache na CDN da Vercel; padrão 30

const SITE_URL = (process.env.SITE_URL || 'https://belemlimpacirio2026.vercel.app').replace(/\/+$/, '');
const CACHE = Math.max(10, parseInt(process.env.CACHE_SITE_SEGUNDOS || '30', 10) || 30);
const MAX_REG = 12; // registros de campo por setor

let memo = null;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const agora = Date.now();
    let dados;
    if (memo && agora - memo.t < CACHE * 1000) dados = memo.d;
    else {
      dados = await montar();
      memo = { t: agora, d: dados };
    }
    res.statusCode = 200;
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE}, stale-while-revalidate=${CACHE * 10}`);
    res.end(JSON.stringify(dados));
  } catch (e) {
    if (memo) { // devolve a última leitura boa
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify(Object.assign({}, memo.d, { aviso: String(e.message || e) })));
    }
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e) }));
  }
};

async function texto(url) {
  const r = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ao ler ${url.split('?')[0]}`);
  return r.text();
}

async function montar() {
  const html = await texto(SITE_URL + '/?_=' + Date.now());

  // dados dos eventos e setores embutidos no site
  const i = html.indexOf('window.DADOS=');
  if (i < 0) throw new Error('Dados do site não encontrados');
  let fim = html.indexOf('\n', i);
  if (fim < 0) fim = html.indexOf('</script>', i);
  const D = JSON.parse(html.slice(i + 'window.DADOS='.length, fim).trim().replace(/;\s*$/, ''));

  const constante = (nome) => {
    const m = html.match(new RegExp('var\\s+' + nome + "\\s*=\\s*'([^']*)'"));
    return m ? m[1] : '';
  };
  const equipeUrl = constante('EQUIPE_CSV_URL');
  const registrosUrl = constante('CSV_URL');

  const evPorN = {};
  D.eventos.forEach((e) => { evPorN[e.n] = e; });

  const setores = D.setores.map((s) => {
    const e = evPorN[s.ev] || {};
    return {
      id: s.id, ev: s.ev, evento: e.nome || '', evData: e.data || '',
      titulo: s.titulo, sub: s.sub, cod: s.cod, quando: s.quando, local: s.local,
      km: s.km, equip: String(s.equip || '').trim(), agentes: s.agentes,
      mymaps: s.mymaps || '', trechos: (s.trechos || []).map((t) => [t[0], t[1], t[2]]),
    };
  });

  // planilha de equipe: lê direto pelo link da planilha (atualiza na hora);
  // se não der, usa o link "publicado na web" que o site usa (o Google pode levar alguns minutos para atualizar esse)
  const eqLink = constante('EQUIPE_SHEET_LINK');
  const mId = eqLink.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  const mGid = eqLink.match(/gid=(\d+)/);
  const eqDireto = mId ? `https://docs.google.com/spreadsheets/d/${mId[1]}/gviz/tq?tqx=out:csv&headers=1${mGid ? '&gid=' + mGid[1] : ''}` : '';
  const lerEquipe = async () => {
    if (eqDireto) {
      try {
        const t = await texto(eqDireto + '&_=' + Date.now());
        if (!/^\s*</.test(t) && /ENCARREGADO/i.test(t.split('\n')[0])) return t;
      } catch (e) {}
    }
    return equipeUrl ? texto(equipeUrl + (equipeUrl.includes('?') ? '&' : '?') + '_=' + Date.now()).catch(() => '') : '';
  };

  const [eqTxt, regTxt] = await Promise.all([
    lerEquipe(),
    registrosUrl ? texto(registrosUrl + (registrosUrl.includes('?') ? '&' : '?') + '_=' + Date.now()).catch(() => '') : '',
  ]);

  return {
    ok: true,
    url: SITE_URL,
    geradoEm: new Date().toISOString(),
    setores,
    ...(() => { const e = eqTxt ? equipe(eqTxt, D) : { pessoas: {}, previsto: {} }; return { equipe: e.pessoas, previsto: e.previsto }; })(),
    registros: regTxt ? registros(regTxt, D) : {},
  };
}

/* ---------------- equipe (mesma regra do site) ---------------- */

function equipe(txt, D) {
  const rows = csv(txt);
  if (rows.length < 2) return {};
  const head = rows[0];
  const iEv = coluna(head, ['N° EVENTO', 'Nº EVENTO', 'N EVENTO', 'EVENTO N°', 'Numero do Evento']);
  const iEvNome = coluna(head, ['EVENTO', 'Nome do Evento']);
  const iSetor = coluna(head, ['SETOR', 'Código do Setor']);
  const iEnc = coluna(head, ['ENCARREGADO', 'Nome do Encarregado']);
  const iEncFone = coluna(head, ['TELEFONE ENCARREGADO', 'Telefone do Encarregado', 'Fone Encarregado', 'Telefone Encarregado(a)', 'Whatsapp Encarregado', 'Contato Encarregado']);
  const iSup = coluna(head, ['SUPERVISOR', 'Nome do Supervisor']);
  const iSupFone = coluna(head, ['TELEFONE SUPERVISOR', 'Telefone do Supervisor', 'Fone Supervisor', 'Telefone Supervisor(a)', 'Whatsapp Supervisor', 'Contato Supervisor']);
  const iAg = coluna(head, ['AGENTES', 'Agentes previstos', 'Nº DE AGENTES', 'N° DE AGENTES']);
  const iNEq = coluna(head, ['Nº DE EQUIPAMENTO', 'N° DE EQUIPAMENTO', 'N DE EQUIPAMENTO']);
  const iEq = coluna(head, ['EQUIPAMENTO', 'EQUIPAMENTOS']);
  if (iEv < 0 || iSetor < 0) return { pessoas: {}, previsto: {} };

  const idx = {}, unico = {};
  D.setores.forEach((s) => {
    idx[s.ev + '|' + s.cod] = s.id;
    if (s.cod === '') unico[s.ev] = s.id;
  });
  const casar = (ev, evNome, setorTxt) => {
    const t = String(setorTxt || '').trim().toUpperCase();
    const evU = String(evNome || '').toUpperCase();
    if (t === 'SETOR ÚNICO' || t === 'SETOR UNICO') return unico[ev] || null;
    if (t === 'CA1' || t === 'CA2') return idx[ev + '|CA'] || null;
    if (/^SETOR (DIURNO|VESPERTINA|VESPERTINO|MATUTINO|NOTURNO)$/.test(t)) return unico[ev] || null;
    const m = t.match(/^SETOR\s+0*(\d+)$/);
    if (m) {
      const n = m[1].length === 1 ? '0' + m[1] : m[1];
      if (ev === 5 && evU.indexOf('TUR') >= 0) return idx[ev + '|PT' + n] || null;
      if (ev === 10) return idx[ev + '|C' + n] || null;
      return idx[ev + '|' + n] || null;
    }
    const m2 = t.match(/^LP0*(\d+)$/);
    if (m2) return idx[ev + '|LP' + m2[1]] || null;
    return idx[ev + '|' + t] || null;
  };
  const valido = (v) => v && !/^[-–—]$/.test(v);

  const out = {}, previsto = {};
  rows.slice(1).forEach((r) => {
    const ev = parseInt(r[iEv], 10);
    if (!ev) return;
    const sid = casar(ev, iEvNome >= 0 ? r[iEvNome] : '', r[iSetor]);
    if (!sid) return;

    // agentes e equipamentos previstos: primeiro valor preenchido do setor
    const pv = (previsto[sid] = previsto[sid] || { agentes: '', equip: '' });
    const ag = iAg >= 0 ? String(r[iAg] || '').trim() : '';
    if (!pv.agentes && valido(ag)) pv.agentes = ag;
    const nEq = iNEq >= 0 ? String(r[iNEq] || '').trim() : '';
    const eq = iEq >= 0 ? String(r[iEq] || '').trim() : '';
    const eqTxt = [valido(nEq) ? nEq : '', valido(eq) ? eq : ''].filter(Boolean).join(' ');
    if (!pv.equip && eqTxt) pv.equip = eqTxt;

    const enc = iEnc >= 0 ? String(r[iEnc] || '').trim() : '';
    const sup = iSup >= 0 ? String(r[iSup] || '').trim() : '';
    if (!valido(enc) && !valido(sup)) return;
    (out[sid] = out[sid] || []).push({
      enc: valido(enc) ? enc : '',
      encFone: valido(enc) ? String(r[iEncFone] || '').trim() : '',
      sup: valido(sup) ? sup : '',
      supFone: valido(sup) ? String(r[iSupFone] || '').trim() : '',
    });
  });
  return { pessoas: out, previsto };
}

/* ---------------- registros de campo (formulário) ---------------- */

function registros(txt, D) {
  const rows = csv(txt);
  if (rows.length < 2) return {};
  const head = rows[0];
  const iCar = coluna(head, ['Carimbo de data/hora', 'Timestamp', 'Carimbo']);
  const iMom = coluna(head, ['Momento do Registro', 'Momento de Registro', 'Momento']);
  const iEv = coluna(head, ['Evento']);
  const iSet = coluna(head, ['Código do setor', 'Código do Setor', 'Setor']);
  const iNome = coluna(head, ['Nome de quem está registrando', 'Nome']);
  const iFun = coluna(head, ['Função']);
  const iAg = coluna(head, ['Tem quantos agentes em campo?', 'Agentes em campo']);
  const iHora = coluna(head, ['Horário real', 'Hora', 'Horário']);
  const iObs = coluna(head, ['Observação']);
  const iFotos = head.map((h, i) => (/foto/i.test(norm(h)) ? i : -1)).filter((i) => i >= 0);
  if (iSet < 0) return {};

  const evNome = {};
  D.eventos.forEach((e) => { evNome[e.n] = rotulo(e.nome); });
  const porRotulo = {};
  D.setores.forEach((s) => {
    const k = rotulo(s.cod || 'Setor único');
    (porRotulo[k] = porRotulo[k] || []).push(s);
  });

  const out = {};
  rows.slice(1).forEach((r) => {
    const cands = porRotulo[rotulo(r[iSet])] || [];
    const ev = iEv >= 0 ? rotulo(r[iEv]) : '';
    const s = cands.find((c) => !ev || evNome[c.ev] === ev);
    if (!s) return;
    const fotos = [];
    iFotos.forEach((i) => String(r[i] || '').split(/[,\s]+/).forEach((u) => { if (/^https?:\/\//.test(u)) fotos.push(u); }));
    (out[s.id] = out[s.id] || []).push({
      carimbo: iCar >= 0 ? String(r[iCar] || '').trim() : '',
      momento: iMom >= 0 ? String(r[iMom] || '').trim() : '',
      nome: iNome >= 0 ? String(r[iNome] || '').trim() : '',
      funcao: iFun >= 0 ? String(r[iFun] || '').trim() : '',
      agentes: iAg >= 0 ? String(r[iAg] || '').trim() : '',
      hora: iHora >= 0 ? String(r[iHora] || '').trim().replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1') : '',
      obs: iObs >= 0 ? String(r[iObs] || '').trim() : '',
      fotos,
    });
  });
  Object.keys(out).forEach((k) => { out[k] = out[k].slice(-MAX_REG).reverse(); });
  return out;
}

/* ---------------- utilidades ---------------- */

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function rotulo(v) { return String(v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, ''); }
function coluna(head, cands) {
  const h = head.map(norm);
  for (const c of cands) { const i = h.indexOf(norm(c)); if (i >= 0) return i; }
  return -1;
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
  return linhas.filter((r) => r.length > 1 || r[0]);
}
