# SCRUM-10 — limite de confiança do preview (2026-10-16)

## Estado de partida preservado

Evidências fornecidas pelo usuário, sem repetição nesta revisão:

- Offboarding publicado na versão `0faa8dc0-027d-4aef-9b1c-c6c311da0a87`, com Header Auth preservado.
- Preview com variável do webhook presente; POST inválido retornou HTTP 400 / `TARGET_NOT_ALLOWED`, sem iniciar offboarding.
- GET do dashboard no container retornou HTTP 200 / JSON; interface mostrou os sete colaboradores sintéticos pelo túnel SSH.
- `127.0.0.1:13001` é acesso local pelo túnel, não evidência de endereço público.
- SCRUM-5 a SCRUM-9 concluídos. Estimativas dos cards não são limites de trabalho nem prazos impostos.

## Bloqueio concreto para limitar por cliente

`compose.iam-hr.yml` publica `127.0.0.1:3001:3000` e conecta `iam-hr` à rede
compartilhada `factory_default`. Isso restringe a porta do host ao loopback,
mas não autentica clientes nem exclui acesso direto de outros containers da rede.
O túnel SSH encaminha conexões e não estabelece identidade HTTP individual dos
visitantes. A inspeção SSH anterior confirmou `cloudflared.service` no host, usando
`/etc/cloudflared/config.yml`, ainda sem regra para o preview. Não há quota
para ações implantada ou isolamento completo da origem comprovado.

As regras observadas apontam `n8n.ph3digital.com.br` para `http://localhost:5678`
e `browserless.ph3digital.com.br` para `http://localhost:3000`, com fallback
`http_status:404`. O preview está em `127.0.0.1:3001`. `next.config.ts` configura standalone
e origens de desenvolvimento, sem estabelecer uma fronteira de proxy confiável.
`POST(request: Request)` não recebe o socket/peer da conexão. Portanto, não pode
verificar se `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP` ou
outro cabeçalho veio de um proxy autorizado ou do solicitante.

Usar o primeiro/último IP de uma lista ou aceitar um cabeçalho com nome novo
permitiria trocar a chave do limitador. Usar o IP do túnel agruparia os visitantes
no mesmo cliente. Não se adicionou confiança nesses cabeçalhos nem limitador
em memória apresentado como proteção confiável. A rota de offboarding permanece
sem quota HTTP por cliente; **o critério de abuso permanece bloqueado**.

O ledger deduplica operações concluídas por ciclo/alvo e trava operações ativas.
Isso limita repetição de escritas, mas cada requisição válida ainda pode alcançar
o n8n. Não limita custo de parsing, chamadas HTTP, execuções de preflight ou
retomadas de operações parciais; não é um limitador de requisições.

## Mudança mínima necessária no proxy

Estabelecer um único ingresso HTTP confiável antes de expor POST publicamente:

1. Confirmar o ingress existente e fazer o tráfego público chegar exclusivamente
   por ele. Remover o acesso direto à origem pelo mesmo público, inclusive caminhos
   alternativos à porta do app; o webhook de offboarding mantém Header Auth.
2. No ponto que conhece a conexão real do visitante, remover os cabeçalhos de
   identidade recebidos do cliente e definir um valor único e validado. Se houver
   CDN/Tunnel à frente, aceitar sua identidade somente por conexão autenticada ou
   origem estritamente permitida; não inferir essa confiança pelo conteúdo de um
   cabeçalho. Configurar explicitamente a cadeia de saltos e o acesso à origem.
3. Aplicar a regra gratuita proposta abaixo **antes do app, no ingresso
   confiável**, ao caminho exclusivo de ação. A quota fica na borda, sem depender
   do processo Next.js ou de cabeçalhos de IP fornecidos pelo cliente.

### Regra proposta — Cloudflare Free, sem upgrade

| Campo | Valor proposto |
| --- | --- |
| Escopo | Hostname público dedicado ao preview |
| URI Path | Igual exatamente a `/api/iam-hr/action` |
| Expressão de caminho | `http.request.uri.path eq "/api/iam-hr/action"` |
| Método | Sem filtro por método |
| Contagem | Por IP do visitante identificado pela Cloudflare |
| Limite | 5 requisições por IP em 10 segundos |
| Ação ao exceder | Bloquear por 10 segundos, antes de encaminhar ao app |

A expressão de caminho deve ser combinada com o hostname dedicado ao preview
quando ele for definido. A query string não participa da comparação: tanto
`?type=offboard` como parâmetros repetidos continuam no mesmo limite por IP.
`GET /api/iam-hr` fica fora dessa regra porque seu caminho é diferente.
O caminho `/api/iam-hr/action` exporta somente POST; não há alias POST na rota
de leitura. Não é necessário separar métodos no filtro gratuito.

Esta é uma proposta de configuração, **ainda não aplicada**. Os testes locais
comprovam a separação dos handlers e o contrato do frontend, não a execução do
limite na Cloudflare. O plano Free sem upgrade é premissa confirmada pelo usuário.

Essa é a menor opção que dispensa identificar o peer dentro do Route Handler e
adicionar um banco/serviço novo à aplicação. Se o limite precisar ficar no app,
primeiro será necessário restringir o acesso ao app ao proxy e estabelecer um
contrato autenticado de identidade, além de uma quota atômica compartilhada.
Nenhuma regra de proxy, DNS, rede ou publicação foi aplicada. A separação de
caminhos prepara o filtro da borda; não implementa a quota por si só.

GET `/api/iam-hr` continua consulta de dashboard; não usa ação POST nem passa
pela quota de mutações proposta. `POST /api/iam-hr/action?type=report` e `/api/lead-capture` permanecem 403
`HANDOVER_DISABLED`, antes da leitura de corpo e de qualquer upstream.

## Evidência dos testes locais

- `tests/recovery.mjs`: 16 reentregas de uma operação concluída, com e sem ID,
  não alteram `iam_runtime`, operações, passos, eventos, colaboradores ou auditoria.
  PGlite executa as consultas localmente; isso não comprova concorrência real
  entre conexões do Postgres de produção nem proteção HTTP.
- `tests/frontend-contracts.cjs`: cabeçalhos de identidade forjados não entram no
  payload do webhook nem substituem a chave sintética definida pelo servidor.
  O transporte mockado recebe as três chamadas: o teste demonstra isolamento
  dos cabeçalhos, explicitamente sem alegar quota ou identificação do cliente.
- GET repetido, mesmo com query de ação e cabeçalhos forjados, usa somente o
  upstream GET de dashboard, sem corpo e sem mudar o ledger simulado.
- 32 solicitações concorrentes às duas rotas de handover, com cabeçalhos
  forjados, retornam 403; nenhum corpo é lido nem upstream chamado.

Todos os HTTP dos testes são mocks; SQL usa PGlite em memória. Nenhum teste chama
webhooks, GCP, reset/offboarding reais ou altera workflow publicado.

## Separação local de leitura e ação

- `GET /api/iam-hr` permanece exclusivo do dashboard. Não há handler POST nesse
  caminho; o Next responde 405 a métodos não suportados.
- `POST /api/iam-hr/action?type=offboard` preserva payload, validações, respostas
  e endpoint interno autenticado do n8n. O caminho de ação não exporta GET.
- O frontend envia POST ao novo caminho e mantém `/api/iam-hr` como chave de
  cache e destino de reconciliação por leitura.
- `N8N_WEBHOOK_KEY` continua no transporte do servidor; allowlist dos sete alvos
  e handover desativado permanecem. Workflows publicados não foram alterados.

Os contratos locais verificam métodos separados, GET somente leitura, rejeição
antes do upstream e o callback real do frontend enviando ao novo caminho sem
segredo e atualizando o cache de leitura. A suíte usa somente mocks e PGlite.

Validação local desta alteração: `npm --prefix tests test` passou integralmente
(26 grupos frontend/API, além dos cenários SQL/workflow); ESLint dos quatro
arquivos TypeScript envolvidos e `git diff --check` passaram.

## Próximo passo único para um endereço público

Configurar o ingresso público protegido do preview: incluir um hostname dedicado
em `/etc/cloudflared/config.yml`, antes do fallback, com destino
`http://localhost:3001`, associar o DNS ao túnel e aplicar na borda o limite para
`/api/iam-hr/action`, abrangendo qualquer query string: 5 requisições por IP
em 10 segundos, com bloqueio por 10 segundos, conforme a regra proposta acima. O GET `/api/iam-hr` fica fora desse limite específico de ação.

Essa é uma etapa de infraestrutura posterior, que exige a versão local com os
caminhos separados implantada no preview. Nenhum deploy ou acesso externo foi
feito nesta tarefa. URL pública verificável e aceite de SCRUM-10 seguem pendentes.
