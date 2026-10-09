# Painel Operacional — Círio de Nazaré 2026

Painel de acompanhamento gerencial (Belém Limpa / SEZEL) ligado à planilha **Monitoramento Operacional** do Google Sheets.
A planilha é alimentada pela equipe; o painel só lê e se atualiza sozinho a cada 30 s.

## Estrutura

```
index.html              página do painel
assets/app.css          visual (padrão do Caderno de Operação)
assets/app.js           cálculos e telas
assets/setores-site.js  setores do Caderno (evento, trechos, link do Google Maps)
mapas/sNN.webp          mapas dos setores
api/dados.js            função da Vercel que lê a planilha
vercel.json             cache dos mapas
```

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Valor |
|---|---|---|
| `SHEET_ID` | sim | `1p2SO7F1wVUPPqX5C2sGOpr1ecHJ4C5lZjCw-Odd_5Fs` |
| `GOOGLE_API_KEY` | recomendada | chave da Google Sheets API (ver abaixo) |
| `CACHE_SEGUNDOS` | não | padrão `15` |
| `ABA_MONITORAMENTO` / `ABA_CADASTRO` | não | só se as abas forem renomeadas |

Depois de criar ou mudar uma variável, faça **Redeploy**.

Sem `GOOGLE_API_KEY` o painel lê pelo link público da planilha (precisa estar como "Qualquer pessoa com o link — Leitor").
Com a chave, a leitura é feita pela API oficial: mais rápida e sem o risco de o Google ignorar células digitadas em formato diferente do resto da coluna (ex.: um número digitado como texto).

### Criar a `GOOGLE_API_KEY`
1. console.cloud.google.com → crie um projeto.
2. APIs e serviços → Biblioteca → **Google Sheets API** → Ativar.
3. APIs e serviços → Credenciais → Criar credenciais → **Chave de API**.
4. Em "Restrições da API", limite a chave à Google Sheets API.
5. Cole a chave na variável `GOOGLE_API_KEY` da Vercel.

## Planilha

O painel lê da aba **Monitoramento** as colunas A–O a partir da linha 5 e da aba **Cadastro de Setores** as colunas A–F a partir da linha 5.
As colunas calculadas (Avanço, Registro atual, Horas, Km acumulados, Avanço acumulado) e os indicadores da aba Dashboard são recalculados no painel com as mesmas fórmulas da planilha, então continuam corretos mesmo em linhas novas abaixo da 504.

- **Km executados (J)** é o km feito **desde a atualização anterior**; o painel soma as linhas do mesmo setor e data (igual à coluna R).
- O setor é ligado ao mapa pelo código no nome (`ROTA T03` → T03, `LAVAGEM - SETOR LT1` → LT1, `LP01` → LP1, `ROTA P12` → P12).
