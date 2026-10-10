(function () {
  'use strict';

  var INTERVALO = 30000;           // atualização automática (ms)
  var CHAVE_CACHE = 'painel-cirio-2026:dados-v2';
  var PASSO_TABELA = 40;

  var CHAVE_SITE = 'painel-cirio-2026:site';
  var INTERVALO_SITE = 60000;
  var SITE = { url: '', setores: [], equipe: {}, registros: {}, previsto: {} };
  var $ = function (id) { return document.getElementById(id) || document.createElement('div'); };

  var estado = {
    bruto: null,          // resposta da API
    calc: null,           // resultado dos cálculos
    filtro: 'todos',
    busca: '',
    limiteTabela: PASSO_TABELA,
    ultimaOk: 0,
    carregando: false,
    aberto: null
  };

  /* ================= utilidades ================= */
  function html(id, h) { var el = document.getElementById(id); if (el) el.innerHTML = h; }
  function lerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function chave(s) { return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nf(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function pct(v) { return v == null || v === '' ? '—' : nf(v * 100, 1) + '%'; }
  function hhmm(min) {
    if (min == null) return '—';
    var m = Math.round(min) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function dataCurta(iso) { if (!iso) return '—'; var p = iso.split('-'); return p[2] + '/' + p[1]; }

  /* ================= setores do Caderno (mapas) ================= */
  // "ROTA T03" → T3 · "LAVAGEM - SETOR LT1" → LT1 · "LP01" → LP1 · "ROTA P12" → P12
  function codigoDe(nome) {
    var s = semAcento(nome).toUpperCase();
    var re = /(?:^|[^A-Z0-9])(LT|LP|PT|CA|T|P|C)\s*-?\s*0*(\d{1,2})(?![0-9])/g, m, ult = null;
    while ((m = re.exec(s))) ult = m[1] + (+m[2]);
    if (ult) return ult;
    if (/\bCA\b|COLETA ANTECIPADA/.test(s)) return 'CA';
    return null;
  }
  var SITE_POR_COD = {}, SITE_POR_TIT = {}, cacheSite = {};
  function indexarSite(d) {
    SITE = { url: d.url || '', setores: d.setores || [], equipe: d.equipe || {}, registros: d.registros || {}, previsto: d.previsto || {} };
    SITE_POR_COD = {}; SITE_POR_TIT = {}; cacheSite = {};
    SITE.setores.forEach(function (s) {
      var c = s.cod && /[A-Z]/i.test(s.cod) ? codigoDe(s.cod) || chave(s.cod) : null;
      if (c && !SITE_POR_COD[c]) SITE_POR_COD[c] = s;
      SITE_POR_TIT[chave(semAcento(s.titulo)).replace(/[–-]/g, '-')] = s;
    });
  }
  function mapaUrl(site) { return SITE.url + '/mapas/' + site.id + '.webp'; }
  function siteDe(nome) {
    var k = chave(nome);
    if (k in cacheSite) return cacheSite[k];
    var c = codigoDe(nome), r = null;
    if (c && SITE_POR_COD[c]) r = SITE_POR_COD[c];
    if (!r) r = SITE_POR_TIT[chave(semAcento(nome)).replace(/[–-]/g, '-')] || null;
    cacheSite[k] = r;
    return r;
  }
  function rotuloCurto(nome) {
    var c = codigoDe(nome);
    if (!c) return nome.length > 6 ? nome.slice(0, 6) : nome;
    return c.replace(/^([A-Z]+)(\d)$/, '$10$2');
  }
  function mapsViewer(u) { return u ? u.replace('/maps/d/edit?', '/maps/d/viewer?') : ''; }

  /* ================= situação ================= */
  var SIT = {
    'concluído': { cls: 'conc', txt: 'Concluído' },
    'em execução': { cls: 'exec', txt: 'Em execução' },
    'aguardando': { cls: 'agu', txt: 'Aguardando' },
    'aguardando instrução': { cls: 'ins', txt: 'Aguardando instrução' },
    'remanejado': { cls: 'rem', txt: 'Remanejado' },
    'conclusão com km pendente': { cls: 'pen', txt: 'Conclusão com km pendente' },
    'sem registro': { cls: 'sem', txt: 'Sem registro' },
    '': { cls: 'sem', txt: 'Sem situação' }
  };
  function sitInfo(t) {
    var k = String(t || '').trim().toLowerCase();
    return SIT[k] || { cls: 'agu', txt: t };
  }
  function sitChip(t) { var s = sitInfo(t); return '<span class="sit sit-' + s.cls + '">' + esc(s.txt) + '</span>'; }
  function igual(a, b) { return String(a || '').trim().toLowerCase() === b.toLowerCase(); }

  /* ================= visão (valores exatamente como estão na planilha) ================= */
  function montarVisao(bruto) {
    var mon = bruto.monitoramento || [];
    var cad = bruto.cadastro || [];
    var cadPor = {};
    cad.forEach(function (c) { var k = chave(c.setor); if (!cadPor[k]) cadPor[k] = c; });
    var regsPor = {};
    mon.forEach(function (r) { if (!r.setor) return; var k = chave(r.setor); (regsPor[k] = regsPor[k] || []).push(r); });

    var setores = (bruto.setores || []).map(function (d) {
      var k = chave(d.setor);
      var regs = regsPor[k] || [];
      return {
        nome: d.setor, avanco: d.avanco, situacao: d.situacao, km: d.km, horas: d.horas,
        cad: cadPor[k] || null, plan: cadPor[k] ? cadPor[k].km : null,
        regs: regs, ult: regs[regs.length - 1] || null,
        site: siteDe(d.setor)
      };
    });
    var atuais = mon.filter(function (r) { return r.atual === 1; });
    return { k: bruto.indicadores || {}, setores: setores, linhas: mon, atuais: atuais };
  }

  /* ================= render ================= */
  function render() {
    if (!estado.bruto || !estado.bruto.indicadores) return;
    estado.calc = montarVisao(estado.bruto);
    renderKpis();
    renderFiltros();
    renderSetores();
    renderLaterais();
    renderTabela();
    if (estado.aberto) abrirSetor(estado.aberto, true);
  }

  function kpi(t, v, sub, extra, cls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-t">' + t + '</span><span class="kpi-v">' + v + '</span>' +
      (extra || '') + '<span class="kpi-s">' + sub + '</span></div>';
  }
  function trilho(v, cls) {
    var w = Math.max(0, Math.min(1, v || 0)) * 100;
    return '<div class="trilho ' + (cls || '') + '"><i style="width:' + w.toFixed(1) + '%"></i></div>';
  }

  function renderKpis() {
    var c = estado.calc, k = c.k;
    var concl = c.atuais.filter(function (r) { return igual(r.situacao, 'Concluído') && r.termino != null; })
      .sort(function (a, b) { return (b.data + hhmm(b.termino)) < (a.data + hhmm(a.termino)) ? -1 : 1; });
    var ultConcl = concl[0];

    var h = '';
    h += kpi('Setores iniciados', nf(k.iniciados) + '<small>/ ' + nf(k.cadastrados) + '</small>',
      nf(k.emExecucao) + ' em execução', trilho(k.cadastrados ? k.iniciados / k.cadastrados : 0));
    h += kpi('Setores concluídos', nf(k.concluidos),
      ultConcl ? 'Último: ' + esc(rotuloCurto(ultConcl.setor)) + ' às ' + hhmm(ultConcl.termino) : 'Com horário de término');
    h += kpi('Avanço médio', pctTxt(k.avancoMedio), 'Média geral dos setores', trilho(k.avancoMedio));
    h += kpi('Efetivo em campo', nf(k.efetivo), 'Agentes e varredores');
    h += kpi('Veículos', nf(k.veiculos), 'Placas registradas');
    h += kpi('Aguardando instrução', nf(k.aguardandoInstr), 'Equipes livres para apoio',
      '', 'alerta' + (k.aguardandoInstr ? ' ativo' : ''));
    html('kpis', h);

    $('kpis2').innerHTML =
      '<span><b>' + nf(k.km, 2) + '</b>km totais executados</span>' +
      '<span><b>' + nf(k.horas, 2) + '</b>horas totais de operação</span>' +
      '<span><b>' + nf(k.emExecucao) + '</b>setores em execução</span>' +
      '<span><b>' + nf(k.cadastrados) + '</b>setores cadastrados</span>';
  }
  function pctTxt(v) {
    if (v == null) return '—';
    return nf(v * 100, 1) + '<small>%</small>';
  }

  var ORDEM_FILTRO = ['Em execução', 'Concluído', 'Aguardando instrução', 'Aguardando', 'Remanejado', 'Conclusão com km pendente', 'Sem registro', 'Em branco'];
  function rotuloSit(s) { return s ? sitInfo(s).txt : 'Em branco'; }

  function renderFiltros() {
    var cont = {};
    estado.calc.setores.forEach(function (s) { var t = rotuloSit(s.situacao); cont[t] = (cont[t] || 0) + 1; });
    var h = '<button class="chip" data-filtro="todos" aria-pressed="' + (estado.filtro === 'todos') + '">Todos<small>' + estado.calc.setores.length + '</small></button>';
    var chaves = ORDEM_FILTRO.filter(function (t) { return cont[t]; })
      .concat(Object.keys(cont).filter(function (t) { return ORDEM_FILTRO.indexOf(t) < 0; }));
    if (estado.filtro !== 'todos' && !cont[estado.filtro]) estado.filtro = 'todos';
    chaves.forEach(function (t) {
      h += '<button class="chip" data-filtro="' + esc(t) + '" aria-pressed="' + (estado.filtro === t) + '">' + esc(t) + '<small>' + cont[t] + '</small></button>';
    });
    html('filtros', h);
  }

  function textoBusca(s) {
    var p = [s.nome, s.cad && s.cad.encarregado, s.cad && s.cad.base, s.ult && s.ult.encarregado, s.ult && s.ult.local, s.ult && s.ult.placa,
      s.site && s.site.evento, s.site && s.site.titulo];
    return semAcento(p.join(' ')).toLowerCase();
  }

  function renderSetores() {
    var lista = estado.calc.setores;
    var b = semAcento(estado.busca.trim()).toLowerCase();
    var vis = lista.filter(function (s) {
      if (estado.filtro !== 'todos' && rotuloSit(s.situacao) !== estado.filtro) return false;
      if (b && textoBusca(s).indexOf(b) < 0) return false;
      return true;
    });

    // agrupa pelo evento do Caderno de Operação, mantendo a ordem da planilha
    var grupos = [], idx = {};
    vis.forEach(function (s) {
      var g = s.site ? 'ev' + s.site.ev : 'outros';
      if (!(g in idx)) {
        idx[g] = grupos.length;
        grupos.push({ nome: s.site ? s.site.evento : 'Outros setores', data: s.site ? s.site.evData : '', itens: [] });
      }
      grupos[idx[g]].itens.push(s);
    });

    if (!vis.length) { html('setores', '<div class="vazio">Nenhum setor encontrado.</div>'); return; }

    var h = '<div class="cab-col"><span>Setor</span><span></span><span>Avanço</span><span class="r">Km exec. / plan.</span><span class="r c-h">Horas</span><span>Situação</span></div>';
    grupos.forEach(function (g) {
      h += '<div class="grupo"><div class="grupo-cab"><h3>' + esc(g.nome) + '</h3>' +
        (g.data ? '<span class="gdat">' + esc(g.data) + '</span>' : '') + '</div>';
      g.itens.forEach(function (s) {
        var si = sitInfo(s.situacao);
        var u = s.ult;
        var enc = (u && u.encarregado) || (s.cad && s.cad.encarregado) || '';
        var det = [enc, u && u.local].filter(Boolean).join(' · ') || (s.site ? s.site.titulo : '');
        var quando = u ? (u.termino != null ? 'Término ' + hhmm(u.termino) :
          u.atualizacao != null ? 'Atualizado ' + hhmm(u.atualizacao) : u.inicio != null ? 'Início ' + hhmm(u.inicio) : '') : '';
        h += '<button class="setor" type="button" data-setor="' + esc(s.nome) + '">' +
          '<span class="cod' + (s.site ? '' : ' sem-mapa') + '" title="' + esc(s.nome) + '">' + esc(rotuloCurto(s.nome)) + '</span>' +
          '<span class="s-nome"><b>' + esc(s.nome) + '</b><span>' + esc(det || '—') + '</span></span>' +
          '<span class="s-av">' + trilho(s.avanco, 'f-' + si.cls) + '<em>' + pct(s.avanco) + '</em></span>' +
          '<span class="s-km"><b>' + nf(s.km, 2) + '</b>' + (s.plan != null ? ' / ' + nf(s.plan, 2) : '') + '</span>' +
          '<span class="s-h c-h"><b>' + (s.horas == null ? '—' : nf(s.horas, 2)) + '</b></span>' +
          '<span class="s-sit">' + (s.situacao ? sitChip(s.situacao) : '<span class="sit sit-sem">—</span>') + (quando ? '<small>' + quando + '</small>' : '') + '</span>' +
          '</button>';
      });
      h += '</div>';
    });
    html('setores', h);
  }

  function item(r, direita, extra) {
    return '<button class="item" type="button" data-setor="' + esc(r.setor) + '">' +
      '<span class="cod">' + esc(rotuloCurto(r.setor)) + '</span>' +
      '<span class="item-t"><b>' + esc(r.setor) + '</b>' + (extra || '') + '</span>' +
      '<span class="item-v">' + direita + '</span></button>';
  }
  function cortar(arr, n, id) {
    var aberto = document.body.getAttribute('data-mais-' + id) === '1';
    if (aberto || arr.length <= n) return { itens: arr, botao: '' };
    return { itens: arr.slice(0, n), botao: '<button class="lista-mais" type="button" data-mais="' + id + '">Ver todos (' + arr.length + ')</button>' };
  }

  function renderLaterais() {
    var at = estado.calc.atuais;
    var k = estado.calc.k;

    // aguardando instrução (mesmo critério do indicador da planilha)
    var ag = at.filter(function (r) { return igual(r.situacao, 'Aguardando instrução'); }).reverse();
    $('c-aguard').textContent = nf(k.aguardandoInstr);
    var x = cortar(ag, 6, 'ag');
    html('l-aguard', ag.length ? x.itens.map(function (r) {
      var sub = [dataCurta(r.data), r.encarregado, r.local].filter(Boolean).join(' · ');
      return item(r, (r.efetivo == null ? '—' : nf(r.efetivo)) + '<small>efetivo</small>',
        '<span>' + esc(sub) + '</span>' + (r.ocorrencias ? '<p>' + esc(r.ocorrencias) + '</p>' : ''));
    }).join('') + x.botao : '<div class="vazio">Nenhuma equipe aguardando instrução.</div>');

    // concluídos
    var co = at.filter(function (r) { return igual(r.situacao, 'Concluído'); }).reverse();
    $('c-concl').textContent = nf(k.concluidos);
    x = cortar(co, 6, 'co');
    html('l-concl', co.length ? x.itens.map(function (r) {
      var sub = dataCurta(r.data) + ' · Início ' + hhmm(r.inicio) + (r.horas != null ? ' · ' + nf(r.horas, 2) + ' h' : '');
      return item(r, hhmm(r.termino) + '<small>término</small>', '<span>' + esc(sub) + '</span>');
    }).join('') + x.botao : '<div class="vazio">Nenhum setor concluído.</div>');

    // veículos (linhas atuais com placa, mesmo critério do indicador)
    var ve = at.filter(function (r) { return r.placa; });
    $('c-veic').textContent = nf(k.veiculos);
    x = cortar(ve, 6, 've');
    html('l-veic', ve.length ? x.itens.map(function (r) {
      return item(r, '<span class="placa">' + esc(r.placa) + '</span>',
        '<span>' + esc([r.tipo, dataCurta(r.data)].filter(Boolean).join(' · ')) + '</span>');
    }).join('') + x.botao : '<div class="vazio">Nenhum veículo registrado.</div>');

    // ocorrências / apoios (todas as linhas, da mais recente para a mais antiga)
    var oc = estado.calc.linhas.filter(function (r) { return r.ocorrencias; }).slice().reverse();
    $('c-ocor').textContent = oc.length;
    x = cortar(oc, 5, 'oc');
    html('l-ocor', oc.length ? x.itens.map(function (r) {
      var q = r.atualizacao != null ? r.atualizacao : r.inicio;
      return item(r, hhmm(q) + '<small>' + dataCurta(r.data) + '</small>',
        (r.fonte ? '<span>' + esc(r.fonte) + '</span>' : '') + '<p>' + esc(r.ocorrencias) + '</p>');
    }).join('') + x.botao : '<div class="vazio">Nenhuma ocorrência registrada.</div>');
  }

  function vazio(v, f) { return v == null || v === '' ? '' : f(v); }

  function renderTabela() {
    var l = estado.calc.linhas.slice().reverse();
    var b = semAcento(estado.busca.trim()).toLowerCase();
    if (b) l = l.filter(function (r) {
      return semAcento([r.setor, r.encarregado, r.local, r.placa, r.ocorrencias, r.fonte, r.situacao].join(' ')).toLowerCase().indexOf(b) >= 0;
    });
    $('c-reg').textContent = l.length + (l.length === 1 ? ' registro' : ' registros');
    var cab = ['Data', 'Setor', 'Encarregado', 'Efetivo', 'Tipo de veículo', 'Placa', 'Início real', 'Última atualização', 'Localização / rua',
      'Km executados', 'Avanço (%)', 'Término real', 'Situação', 'Ocorrências / apoios', 'Fonte / responsável',
      'Registro atual', 'Horas de operação', 'Km acumulados', 'Avanço acumulado (%)'];
    var h = '<thead><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    var f2 = function (v) { return nf(v, 2); };
    l.slice(0, estado.limiteTabela).forEach(function (r) {
      h += '<tr class="' + (r.atual === 1 ? 'atual' : '') + '" data-setor="' + esc(r.setor) + '" title="Linha ' + r.l + ' da planilha">' +
        '<td class="nw">' + (r.data ? dataCurta(r.data) : '') + '</td>' +
        '<td class="nw"><b>' + esc(r.setor) + '</b></td>' +
        '<td>' + esc(r.encarregado) + '</td>' +
        '<td class="n">' + vazio(r.efetivo, nf) + '</td>' +
        '<td>' + esc(r.tipo) + '</td>' +
        '<td class="nw">' + esc(r.placa) + '</td>' +
        '<td class="n">' + vazio(r.inicio, hhmm) + '</td>' +
        '<td class="n">' + vazio(r.atualizacao, hhmm) + '</td>' +
        '<td class="txt">' + esc(r.local) + '</td>' +
        '<td class="n">' + vazio(r.km, f2) + '</td>' +
        '<td class="n">' + vazio(r.avanco, pct) + '</td>' +
        '<td class="n">' + vazio(r.termino, hhmm) + '</td>' +
        '<td class="nw">' + (r.situacao ? sitChip(r.situacao) : '') + '</td>' +
        '<td class="txt">' + esc(r.ocorrencias) + '</td>' +
        '<td>' + esc(r.fonte) + '</td>' +
        '<td class="n">' + vazio(r.atual, nf) + '</td>' +
        '<td class="n">' + vazio(r.horas, f2) + '</td>' +
        '<td class="n">' + vazio(r.kmAcum, f2) + '</td>' +
        '<td class="n">' + vazio(r.avancoAcum, pct) + '</td>' +
        '</tr>';
    });
    if (!l.length) h += '<tr><td colspan="' + cab.length + '" class="vazio">Nenhum registro.</td></tr>';
    html('tab-reg', h + '</tbody>');
    var resta = l.length - estado.limiteTabela;
    $('mais-reg').hidden = resta <= 0;
    $('mais-reg').textContent = 'Mostrar mais (' + Math.max(0, resta) + ')';
  }

  /* ================= gaveta do setor ================= */
  function abrirSetor(nome, silencioso) {
    var s = (estado.calc.setores || []).filter(function (x) { return chave(x.nome) === chave(nome); })[0];
    if (!s) { fecharSetor(); return; }
    estado.aberto = s.nome;
    var site = s.site, u = s.ult, si = sitInfo(s.situacao), c = s.cad || {};
    var h = '';
    h += '<div class="g-cab"><span class="rotulo">' + esc(site ? site.evento + ' · ' + site.evData : 'Setor') + '</span>' +
      '<h2 id="g-tit">' + esc(s.nome) + '</h2>' +
      '<p>' + esc(site ? [site.titulo, site.quando].filter(Boolean).join(' — ') : '') + '</p></div>';

    h += '<div class="g-sec"><div class="g-av"><span class="big">' + pct(s.avanco) + '</span>' + trilho(s.avanco, 'f-' + si.cls) + (s.situacao ? sitChip(s.situacao) : '') + '</div>';
    h += '<div class="g-grid">' +
      gi('Km total executado', s.km == null ? '—' : nf(s.km, 2) + ' km') +
      gi('Extensão planejada', s.plan == null ? '—' : nf(s.plan, 2) + ' km') +
      gi('Horas de operação', s.horas == null ? '—' : nf(s.horas, 2)) +
      gi('Efetivo', u && u.efetivo != null ? nf(u.efetivo) : '—') +
      gi('Veículo', u && (u.tipo || u.placa) ? [u.tipo, u.placa].filter(Boolean).join(' · ') : '—') +
      gi('Encarregado', (u && u.encarregado) || '—') +
      gi('Início real', u ? hhmm(u.inicio) : '—') +
      gi('Última atualização', u ? hhmm(u.atualizacao) : '—') +
      gi('Término real', u ? hhmm(u.termino) : '—') +
      (u && u.local ? gi('Localização atual', u.local, true) : '') +
      '</div></div>';

    if (c.encarregado || c.telefone || c.base || c.obs) {
      var tel = String(c.telefone || '').replace(/\D/g, '');
      h += '<div class="g-sec"><h3>Cadastro do setor</h3><div class="g-grid">' +
        (c.encarregado ? gi('Encarregado / supervisor', c.encarregado) : '') +
        (c.telefone ? gi('Telefone', tel.length >= 8 ? '<a href="tel:' + tel + '">' + esc(c.telefone) + '</a>' : esc(c.telefone), false, true) : '') +
        (c.base ? gi('Base / equipe', c.base) : '') +
        (c.obs ? gi('Observações', c.obs, true) : '') +
        '</div></div>';
    }

    var eq = site ? SITE.equipe[site.id] || [] : [];
    if (eq.length) {
      h += '<div class="g-sec"><h3>Equipe escalada</h3><div class="pessoas">' + eq.map(function (p) {
        return pessoa('Supervisor', p.sup, p.supFone) + pessoa('Encarregado', p.enc, p.encFone);
      }).join('') + '</div></div>';
    }

    if (site) {
      h += '<div class="g-sec"><h3>Mapa do setor</h3>' +
        '<button class="g-mapa" type="button" data-zoom="' + esc(mapaUrl(site)) + '" aria-label="Ampliar mapa">' +
        '<img src="' + esc(mapaUrl(site)) + '" alt=""Mapa do ' + esc(site.titulo) + '" loading="lazy" decoding="async"></button>' +
        '<div class="g-links">' +
        (site.mymaps ? '<a href="' + esc(mapsViewer(site.mymaps)) + '" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>' : '') +
        '<a href="' + esc(mapaUrl(site)) + '" target="_blank" rel="noopener">Imagem em tela cheia ↗</a>' +
        '<a href="' + esc(SITE.url + '/#/setor:' + site.id) + '" target="_blank" rel="noopener">Ver no Caderno de Operação ↗</a>' +
        '</div>' +
        (site.local ? '<div class="g-grid" style="margin-top:12px">' + gi('Local de concentração', site.local, true) +
          gi('Equipamentos previstos', (SITE.previsto[site.id] && SITE.previsto[site.id].equip) || site.equip || '—') +
          gi('Agentes previstos', (SITE.previsto[site.id] && SITE.previsto[site.id].agentes) || site.agentes || '—') + '</div>' : '') +
        '</div>';
    }

    h += '<div class="g-sec"><h3>Monitoramento</h3>';
    if (s.regs.length) {
      h += '<div class="hist">' + s.regs.slice().reverse().map(function (r) {
        var q = r.atualizacao != null ? r.atualizacao : r.inicio;
        var linha1 = [r.situacao ? sitChip(r.situacao) : '', r.efetivo != null ? '<b>' + nf(r.efetivo) + '</b> efetivo' : '',
          r.termino != null ? 'término <b>' + hhmm(r.termino) + '</b>' : ''].filter(Boolean).join(' · ');
        return '<div class="hist-i"><span class="hist-h">' + hhmm(q) + '<small>' + dataCurta(r.data) + '</small></span>' +
          '<span class="hist-c">' + (linha1 || '&nbsp;') +
          (r.local ? '<p>' + esc(r.local) + '</p>' : '') +
          (r.ocorrencias ? '<p><b>Ocorrência:</b> ' + esc(r.ocorrencias) + '</p>' : '') +
          (r.fonte ? '<p>' + esc(r.fonte) + '</p>' : '') + '</span>' +
          '<span class="hist-k"><b>' + (r.avanco == null ? '—' : pct(r.avanco)) + '</b>' + (r.km == null ? '' : nf(r.km, 2) + ' km exec.<br>') + (r.kmAcum == null ? '' : nf(r.kmAcum, 2) + ' km acum.') + '</span></div>';
      }).join('') + '</div>';
    } else h += '<div class="vazio" style="text-align:left;padding:4px 0">Sem registros.</div>';
    h += '</div>';

    var rc = site ? SITE.registros[site.id] || [] : [];
    if (site) {
      h += '<div class="g-sec"><h3>Registros de campo</h3>';
      if (rc.length) {
        h += '<div class="hist">' + rc.map(function (r) {
          var quem = [r.nome, r.funcao, r.agentes ? r.agentes + ' agente(s)' : ''].filter(Boolean).join(' · ');
          var dia = (r.carimbo.match(/^(\d{1,2}\/\d{1,2})/) || [])[1] || '';
          return '<div class="hist-i"><span class="hist-h">' + esc(r.hora || '—') + '<small>' + esc(dia) + '</small></span>' +
            '<span class="hist-c"><b>' + esc(r.momento) + '</b>' + (quem ? '<p>' + esc(quem) + '</p>' : '') +
            (r.obs ? '<p>' + esc(r.obs) + '</p>' : '') +
            (r.fotos.length ? '<p>' + r.fotos.map(function (u, i) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">Foto ' + (i + 1) + '</a>'; }).join(' · ') + '</p>' : '') +
            '</span><span></span></div>';
        }).join('') + '</div>';
      } else h += '<div class="vazio" style="text-align:left;padding:4px 0">Nenhum registro de campo para este setor.</div>';
      h += '</div>';
    }

    if (site && site.trechos && site.trechos.length) {
      h += '<details class="g-sec"><summary>Logradouros do percurso (' + site.trechos.length + ')</summary><table class="trechos">' +
        site.trechos.map(function (t) {
          return '<tr><td><b>' + esc(t[0]) + '</b><span>' + esc(t[1] || '') + '</span></td><td>' + (t[2] == null ? '' : nf(t[2], 2) + ' km') + '</td></tr>';
        }).join('') + '</table></details>';
    }

    html('g-corpo', h);
    if (!silencioso || $('gaveta').hidden) {
      $('gaveta').hidden = false; $('gaveta-fundo').hidden = false;
      document.body.style.overflow = 'hidden';
      $('g-fechar').focus();
    }
  }
  function pessoa(funcao, nome, fone) {
    if (!nome) return '';
    var n = String(fone || '').replace(/\D/g, '');
    var wa = n.length >= 10 ? (n.length <= 11 ? '55' + n : n) : '';
    return '<div class="pessoa"><span>' + funcao + '</span><b>' + esc(nome) + '</b>' +
      (fone ? '<em>' + (n.length >= 8 ? '<a href="tel:' + n + '">' + esc(fone) + '</a>' : esc(fone)) +
        (wa ? ' · <a href="https://wa.me/' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</em>' : '') + '</div>';
  }
  function gi(t, v, largo, html) {
    return '<div' + (largo ? ' style="grid-column:1/-1"' : '') + '><span>' + t + '</span><b>' + (html ? v : esc(v)) + '</b></div>';
  }
  function fecharSetor() {
    estado.aberto = null;
    $('gaveta').hidden = true; $('gaveta-fundo').hidden = true;
    document.body.style.overflow = '';
  }

  /* ================= carregamento ================= */
  function status(cls, txt) {
    $('pulso').className = 'pulso ' + cls;
    $('status-txt').textContent = txt;
  }
  function horaAgora(d) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;
    $('btn-at').classList.add('girando');
    fetch('/api/dados?t=' + Math.floor(Date.now() / 10000), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        estado.bruto = j;
        estado.ultimaOk = Date.now();
        gravarLocal(CHAVE_CACHE, JSON.stringify(j));
        $('erro').hidden = true;
        status('ok', 'Atualizado às ' + horaAgora(new Date(j.geradoEm || Date.now())));
        $('rod-fonte').textContent = j.monitoramento.length + ' registros · ' + j.cadastro.length + ' setores cadastrados';
        render();
      })
      .catch(function (e) {
        var desde = estado.ultimaOk ? ' Exibindo dados de ' + horaAgora(new Date(estado.ultimaOk)) + '.' : '';
        status('falha', 'Sem conexão com a planilha');
        $('erro').textContent = 'Não foi possível atualizar os dados (' + e.message + ').' + desde;
        $('erro').hidden = false;
      })
      .then(function () {
        estado.carregando = false;
        $('btn-at').classList.remove('girando');
      });
  }

  function carregarSite() {
    fetch('/api/site?t=' + Math.floor(Date.now() / 30000), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        indexarSite(j);
        gravarLocal(CHAVE_SITE, JSON.stringify(j));
        render();
      })
      .catch(function () {});
  }

  function verificarAtraso() {
    if (!estado.ultimaOk) return;
    var seg = (Date.now() - estado.ultimaOk) / 1000;
    if (seg > INTERVALO / 1000 * 3 && $('pulso').className.indexOf('falha') < 0) $('pulso').className = 'pulso lento';
  }

  /* ================= eventos ================= */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var f = t.closest('[data-filtro]');
    if (f) { estado.filtro = f.getAttribute('data-filtro'); renderFiltros(); renderSetores(); return; }
    var m = t.closest('[data-mais]');
    if (m) { document.body.setAttribute('data-mais-' + m.getAttribute('data-mais'), '1'); renderLaterais(); return; }
    var z = t.closest('[data-zoom]');
    if (z) { $('z-img').src = z.getAttribute('data-zoom'); $('zoom').hidden = false; return; }
    var s = t.closest('[data-setor]');
    if (s && !t.closest('#gaveta')) { abrirSetor(s.getAttribute('data-setor')); return; }
  });
  $('g-fechar').addEventListener('click', fecharSetor);
  $('gaveta-fundo').addEventListener('click', fecharSetor);
  $('z-fechar').addEventListener('click', function () { $('zoom').hidden = true; });
  $('zoom').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('zoom').hidden) $('zoom').hidden = true; else if (!$('gaveta').hidden) fecharSetor();
  });
  $('btn-at').addEventListener('click', function () { carregar(); carregarSite(); });
  $('mais-reg').addEventListener('click', function () { estado.limiteTabela += PASSO_TABELA * 2; renderTabela(); });
  var tBusca;
  $('busca').addEventListener('input', function () {
    clearTimeout(tBusca);
    var v = this.value;
    tBusca = setTimeout(function () { estado.busca = v; renderSetores(); renderTabela(); }, 120);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - estado.ultimaOk > 10000) carregar();
  });

  /* ================= início ================= */
  try { var sSalvo = lerLocal(CHAVE_SITE); if (sSalvo) indexarSite(JSON.parse(sSalvo)); } catch (e) {}
  var salvo = lerLocal(CHAVE_CACHE);
  if (salvo) {
    try {
      estado.bruto = JSON.parse(salvo);
      status('lento', 'Atualizando…');
      render();
    } catch (e) {}
  }
  carregar();
  carregarSite();
  setInterval(function () { if (!document.hidden) carregar(); verificarAtraso(); }, INTERVALO);
  setInterval(function () { if (!document.hidden) carregarSite(); }, INTERVALO_SITE);
})();
