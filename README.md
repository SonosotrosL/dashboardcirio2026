# Painel Operacional — Círio de Nazaré 2026

Painel de acompanhamento gerencial (Belém Limpa / SEZEL) ligado à planilha **Monitoramento Operacional** do Google Sheets.
A planilha é alimentada pela equipe; o painel só lê e se atualiza sozinho a cada 30 s.

## Estrutura

```
index.html              página do painel
assets/app.css          visual (padrão do Caderno de Operação)
assets/app.js           cálculos e telas
api/dados.js            lê a planilha de Monitoramento
api/site.js             lê o site do Caderno de Operação e as planilhas dele
vercel.json             cache dos arquivos estáticos
```

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Valor |
|---|---|---|
| `SHEET_ID` | sim | `1p2SO7F1wVUPPqX5C2sGOpr1ecHJ4C5lZjCw-Odd_5Fs` |
| `GOOGLE_API_KEY` | recomendada | chave da Google Sheets API (ver abaixo) |
| `CACHE_SEGUNDOS` | não | padrão `15` |
| `SITE_URL` | não | padrão `https://belemlimpacirio2026.vercel.app` |
| `CACHE_SITE_SEGUNDOS` | não | padrão `30` |
| `ABA_MONITORAMENTO` / `ABA_CADASTRO` / `ABA_DASHBOARD` | não | só se as abas forem renomeadas |

Depois de criar ou mudar uma variável, faça **Redeploy**.

Sem `GOOGLE_API_KEY` o painel lê pelo link público da planilha (precisa estar como "Qualquer pessoa com o link — Leitor"), com os valores já arredondados como aparecem na tela do Sheets.
Com a chave, a leitura é feita pela API oficial, em uma única chamada e com os valores completos.

### Criar a `GOOGLE_API_KEY`
1. console.cloud.google.com → crie um projeto.
2. APIs e serviços → Biblioteca → **Google Sheets API** → Ativar.
3. APIs e serviços → Credenciais → Criar credenciais → **Chave de API**.
4. Em "Restrições da API", limite a chave à Google Sheets API.
5. Cole a chave na variável `GOOGLE_API_KEY` da Vercel.

## Planilha

O painel espelha a planilha: não faz nenhum cálculo próprio. Ele lê:

| Aba | Faixa | Uso no painel |
|---|---|---|
| Dashboard | A5:C14 | indicadores do topo (localizados pelo nome da coluna A) |
| Dashboard | A17:E | avanço, situação, km e horas de cada setor |
| Monitoramento | A5:S | registros, listas laterais e histórico do setor (inclui as colunas calculadas K, P, Q, R, S) |
| Cadastro de Setores | A5:F | extensão planejada e dados de contato do setor |

Qualquer fórmula alterada no Sheets aparece no painel na próxima atualização, sem mexer no código.
Se uma linha nova do Monitoramento ficar sem as fórmulas das colunas K, P, Q, R e S, ela aparece no painel sem esses valores — do mesmo jeito que na planilha.

## Ligação com o Caderno de Operação

O painel lê o site `SITE_URL` a cada minuto e usa de lá:

- eventos, setores, horários, local de concentração, equipamentos e logradouros;
- mapas (`SITE_URL/mapas/sNN.webp`) e links do Google Maps;
- a planilha de equipe que o site usa (supervisor, encarregado e telefones de cada setor);
- a planilha de respostas do formulário de registro de campo.

Os endereços dessas duas planilhas são lidos do próprio site, então se forem trocados lá, o painel acompanha.

O setor da planilha de Monitoramento é ligado ao setor do site pelo código no nome (`ROTA T03` → T03, `LAVAGEM - SETOR LT1` → LT1, `LP01` → LP1, `ROTA P12` → P12).
