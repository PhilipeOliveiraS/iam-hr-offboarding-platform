# SCRUM-10: controles locais propostos — 2026-10-14

Atualização de 16/10: ver [estado atual e bloqueio de abuso no proxy](SCRUM-10-abuse-boundary.md).
Essa atualização registra as evidências recentes fornecidas pelo usuário;
os parágrafos abaixo preservam a revisão histórica de 14/10.

Nenhuma publicação, alteração Jira ou execução externa foi feita nesta rodada.
Os exports publicados fornecidos no chat são evidência histórica do runtime,
não arquivos importados nem prova de equivalência com estes fontes locais.

## Alvos e reset

`lib/synthetic-targets.ts` e os exports 02/03 contêm o mapeamento explícito
para John Carter, Sarah Connor, T'Challa Udaku, Ellen Ripley, Arthur Dent,
Marty McFly e Dana Scully. A aplicação rejeita e-mails fora dessa lista.
Os Code nodes validam sete entradas e sete IDs distintos antes de qualquer
chamada GCP, sem derivação de ID ou fallback. O reset exige também que o banco
contenha exatamente os sete e-mails distintos permitidos; linhas extras,
ausentes ou repetidas bloqueiam o fluxo antes da aquisição da operação.

Inspect compara `body.email === expected_email`, incluindo conta, projeto
`GCP_PROJECT_ID` validado e domínio `iam.gserviceaccount.com`. Reset inspeciona
sete contas, agrega o resultado, autoriza uma vez, expande somente as escritas
necessárias e registra uma vez. O contador `writes` do ledger representa uma
autorização do lote, não necessariamente o número de contas alteradas.
Resultado anterior `unknown`, respostas ausentes ou sondagens incertas
bloqueiam escrita. Não há expiração automática da trava.

Offboarding/reset locais exigem Header Auth; as referências de credenciais
não são incluídas. Um operador deverá vincular a credencial na eventual
implantação. Reset é POST, com Schedule Trigger desabilitado.

## Handover público desabilitado

A interface usava `POST /api/iam-hr?type=report`. O proxy IAM envia
`X-N8N-Webhook-Secret` somente no servidor quando `N8N_WEBHOOK_KEY` existe;
nenhum segredo é enviado ao browser. O formulário de envio foi removido.
Após a separação de caminhos, `POST /api/iam-hr/action?type=report`
e `POST /api/lead-capture` retornam 403 `HANDOVER_DISABLED`
antes de ler corpo ou fazer fetch, independentemente de variáveis configuradas.
Não há flag de ambiente que reative esse caminho sem revisão de código.

O ledger persistente atual cobre offboarding/reset, não reservas de entrega,
quotas ou deduplicação de e-mail. Não se adicionou rate limit em memória.
`automation/sql/handover-eligible.sql` é um contrato de consulta local testado:
aceita somente e-mail exato da lista e colaborador OFFBOARDED. Não é um workflow
publicado nem um pipeline de envio. O workflow publicado de handover permanece
inalterado e seu endpoint direto não é protegido por esta mudança local.

Alternativa mínima para futura reativação: usar o Postgres existente com reserva
atômica de entrega por operação/ciclo e destinatário, quota persistente com
janela definida e tratamento conservador de envio incerto; autenticar o webhook
para uso exclusivo pelo servidor, impedir bypass direto e consultar elegibilidade
por e-mail exato e operação concluída. Uma reserva incerta não deve ser reenviada
automaticamente. Esses controles precisam de testes concorrentes e configuração
publicada conferida antes de reintroduzir o formulário. Não há dependência paga
nova nesta proposta.

## Verificação e limites de aceite

`npm --prefix tests test` usa PGlite em memória, simulação dos Code/SQL/HTTP nodes,
fetch substituído e renderização React estática. Não chama serviços externos.
Os testes negativos abrangem allowlist, ausência/colisão, IDs repetidos,
projeto/domínio/conta incorretos, lote e resultado unknown; consulta de handover
rejeita ACTIVE/externo e as rotas rejeitam tentativas repetidas sem upstream.
Isso testa envio desabilitado, não comprova um limitador persistente implementado.

GET local consulta somente `iam_dashboard()`. A definição SQL publicada,
a URL pública canônica, acesso em navegador anônimo, proteção do webhook direto
publicado e os limites operacionais continuam pendentes. O preview saudável e
operações 156/157 são evidências relatadas anteriores, não repetidas aqui.

Restauração/rollback operacional: seguir revisão autorizada em `APLICAR.md`,
preservando auditorias e backups publicados reais. Não usar estes exports para
substituir automaticamente o runtime. SCRUM-10 não está concluído.
