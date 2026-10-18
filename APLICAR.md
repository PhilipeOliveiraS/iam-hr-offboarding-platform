# IAM-HR — aplicar e operar a recuperação seletiva

Este guia adapta o pacote de recuperação ao repositório integrado. O frontend válido está em `app/`, `components/` e `lib/`: **não copie o frontend antigo do ZIP por cima dele**. Consulte o [README](README.md#validation-evidence-and-outstanding-work) para separar resultados locais, evidências reais informadas pelo operador e pendências.

## Escopo e pré-requisitos

Esta é uma atualização incremental de uma instalação existente, não um provisionamento completo. Preserve o Compose, os volumes, o schema original, o seed do ERP e as variáveis locais/servidor, incluindo `N8N_EDITOR_BASE_URL`. A migração depende de `employees` e `audit_log` existentes. O mock depende de FastAPI/Pydantic e de seu JSON de licenças existente (`MOCK_ERP_SEED`, padrão `./seed.json`). A imagem, o Compose e esse estado não são substituídos por este repositório.

O handover em inglês já publicado deve permanecer. Sua credencial Gmail e a chave Gemini não fazem parte desta mudança. Não importe a cópia de `reference/` do pacote como versão publicada. Os dois exports antigos na raiz local também não foram comparados com a publicação atual e não são fontes para instalação.

**Situação informada nesta entrega:** a migração já recebeu COMMIT, ERP `/state` respondeu 200, workflows 01/02/03 foram importados em n8n 2.39.6 e reset/offboarding reais tiveram sucesso. Não repita migração ou reset apenas para versionar/pushar a branch. Os passos abaixo servem para uma implantação deliberada ou outro ambiente.

## 1. Preparação coordenada

1. Preserve o working tree completo, arquivos não rastreados e configurações num backup privado fora do projeto. O backup local desta entrega já foi feito e conferido; não precisa ser repetido nesta publicação.
2. Exporte como backup privado os workflows **atualmente publicados** 01/02/03 e identifique qual handover deve permanecer.
3. Aguarde terminar execuções em andamento. Despublique os antigos 02/03 antes de ativar os novos: os antigos ignoram a trava persistente.
4. Pare o frontend durante a troca. Não sobreponha dois workflows com o mesmo método/caminho de webhook.
5. Transfira somente os fontes necessários para um diretório de staging no servidor. Não transfira `.git`, `.env`, dependências, backups, ZIPs nem a cópia de referência do handover.

Nenhuma dessas operações remotas faz parte da preparação de commits e push.

## 2. Banco e ERP

Em uma sessão de manutenção autorizada no servidor, dentro da pasta do Compose existente, gere e confira um dump antes de aplicar a migração. Exemplo (ajuste somente os caminhos conforme sua instalação):

```sh
umask 077
mkdir -p backups
backup_file="backups/iam-hr-before-recovery-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T postgres pg_dump -U iam_hr_app -d iam_hr > "$backup_file"
```

Só prossiga após verificar o exit code, a existência e o conteúdo válido do dump. Com os fontes transferidos para `iam-hr-partial-recovery/`:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U iam_hr_app -d iam_hr < iam-hr-partial-recovery/database/002-operation-recovery.sql
cp -p mock-erp/main.py "backups/mock-erp-main-before-recovery-$(date +%Y%m%d-%H%M%S).py"
cp iam-hr-partial-recovery/mock-erp/main.py mock-erp/main.py
docker compose up -d --build --no-deps mock-erp
```

A migração é aditiva e transacional. Não substitua `schema.sql`, não execute `tests/fixtures/schema-original.sql` no banco da demo e não apague volumes. Se já houver tabelas `iam_*`, confira a versão/estrutura antes de reaplicar: `IF NOT EXISTS` não atualiza estruturas incompatíveis.

A reconstrução do mock pode restaurar seu seed se o estado estiver na camada gravável do container. Valide `GET /state` e finalize a instalação com um reset coordenado após configurar os novos workflows. Uma resposta 200 sozinha não demonstra que `reset_baseline` é verdadeiro.

## 3. Workflows e credenciais

Importe estes arquivos como novos workflows desativados:

1. `automation/n8n/n8n-01-get-dashboard-data.json`
2. `automation/n8n/n8n-02-execute-offboarding.json`
3. `automation/n8n/n8n-03-scheduled-reset.json`

Selecione `IAM-HR Postgres` em **todos** os nós Postgres. Selecione `IAM-HR GCP Connector` nos nós GCP Inspect/Apply de 02 e 03. Os nomes presentes nos JSONs são referências a credenciais; as credenciais reais devem ser configuradas no servidor. Os fontes locais usam `GCP_PROJECT_ID` e o mapeamento explícito das sete contas `iamhr-*`; não derivam IDs do e-mail. Vincule Header Auth nos webhooks de offboarding/reset antes de qualquer publicação deliberada. A permissão de leitura `iam.serviceAccounts.get` é necessária além de habilitar/desabilitar a conta.

Nos quatro nós HTTP **ERP Inspect, ERP Apply, GCP Inspect e GCP Apply**, em **ambos** 02 e 03, confira:

```json
{
  "responseFormat": "text",
  "fullResponse": true,
  "neverError": true,
  "outputPropertyName": "body"
}
```

Esses campos ficam em `parameters.options.response.response`. Sem `outputPropertyName`, o conteúdo textual fica em `data`, enquanto os classificadores leem `body`. As oito configurações estão corrigidas nos fontes locais. A correção foi aplicada pelo operador no n8n e validada por reset/offboarding reais; ainda não houve comparação integral com exports atuais do servidor.

Substitua o GET antigo pelo novo GET. Publique os novos 02/03 somente com banco/ERP prontos e versões antigas despublicadas. Os caminhos são `GET /webhook/iam-hr-data`, `POST /webhook/iam-hr-action` e `POST /webhook/reset-system`; o gatilho de 30 minutos existe, mas está desabilitado no export local.

Após uma instalação, invoque o reset de produção uma vez e confira `operation.status: succeeded`, os resultados por conector e todos os funcionários ACTIVE. O agendamento termina em Scheduled Result; a resposta HTTP é exclusiva do webhook. Não confunda uma execução verde do n8n com sucesso do negócio.

## 4. Frontend e contratos

Use o frontend integrado deste checkout, preservando os arquivos `.env` privados. Instale pelo lockfile e execute build/start quando for a etapa autorizada de frontend:

```sh
npm ci
npm run build
npm run start
```

- GET retorna `employees`, `cycle`, `busy`, `maintenance` e `metrics`; sem sucessos na janela, a média é `null` e aparece como traço.
- Offboarding recebe `target_email` e `operation_id` opcional. Retomar deve usar o mesmo ID no mesmo ciclo.
- O POST fornece a operação e um `dashboard` confirmado. Tabela, card e métricas usam esse mesmo snapshot.
- HTTP 200 com `success: false` e operação `partial`/`unknown` é um resultado de negócio incompleto, não sucesso total.
- Erros de entrada, concorrência ou infraestrutura conservam os códigos HTTP. HTML, corpo vazio e contratos inválidos nunca viram sucesso presumido.
- Listas antigas e aliases úteis continuam legíveis, mas não habilitam ações sem metadados de recuperação.
- O timeout de 55s inclui leitura do corpo; o provedor pode limitar antes. Timeout não cancela nem comprova falha da operação remota.
- O envio público de handover está desabilitado localmente: `/api/iam-hr?type=report` e `/api/lead-capture` retornam 403 sem upstream. O workflow publicado permanece inalterado; sua configuração histórica não deve ser inferida destas rotas.
- `processing_ms` soma tempo ativo de tentativas; não inclui espera humana, handover ou entrega HTTP. `elapsed_ms` inclui intervalo entre tentativas. A média de sucessos usa 24h; preserve **vs 48h manual** como referência comparativa.

## 5. Recuperação operacional

A trava global não expira automaticamente. Ela também protege o reset. Conectores `succeeded` não são repetidos na retomada do mesmo ciclo. Rejeições explícitas de escrita podem ser retomadas; transporte/timeout/5xx e respostas inconclusivas de escrita podem ficar `unknown`. Uma leitura posterior não prova que a escrita anterior terminou.

Consultas de diagnóstico:

```sql
SELECT * FROM iam_runtime;
SELECT id, cycle, kind, target_email, status, attempts, processing_ms
FROM iam_operations ORDER BY id DESC LIMIT 10;
SELECT operation_id, connector, status, checks, writes, detail
FROM iam_steps ORDER BY operation_id DESC, ordinal LIMIT 30;
```

Se uma execução caiu, identifique `iam_runtime.owner`, confirme no n8n que está parada e que não há processo/requisição antiga em voo. Só então, num acesso administrativo autorizado:

```sql
SELECT iam_release_stopped('ID_EXATO_DA_EXECUCAO_PARADA');
```

Uma etapa cuja escrita começou fica `unknown`. Antes de autorizar uma nova tentativa, confirme o encerramento da solicitação anterior e inspecione o alvo; registre evidência concreta:

```sql
SELECT iam_resolve_unknown(ID_DA_OPERACAO, 'gcp', 'Evidencia real de encerramento e estado observado.');
```

A função muda `unknown` para `failed`; a retomada inspeciona novamente e não escreve se o estado desejado já estiver confirmado. Não altere status diretamente para forçar sucesso. Essas funções não têm endpoint público de autorização administrativa.

## 6. Validação e pendências

Reprodução local isolada, sem serviços externos:

```sh
npm ci
npm --prefix tests ci --ignore-scripts
npm --prefix tests test
```

`recovery.mjs` testa as funções SQL em PGlite. `workflow.mjs` simula os grafos e HTTP, respeita `outputPropertyName` e usa `data` como padrão. Inclui regressões do campo ausente. `frontend-contracts.cjs` usa fetch simulado e PGlite para contratos e renderização básica; não é um teste de navegador.

Resultados locais anteriores reaproveitados: build, lint dos quatro arquivos integrados, recovery e 17 grupos de contratos passaram. A simulação original ignorava o padrão `data`; seu sucesso anterior não comprovava a correção do mapeamento HTTP. Nesta entrega, a versão corrigida passou: oito mapeamentos `body`, padrão `data` e regressões por ausência do campo. Os 17 grupos de contratos também passaram novamente a partir de `tests/`. O build/lint do frontend e o resultado anterior de recovery foram reaproveitados porque sua implementação não mudou.

Evidência real **informada pelo operador**, registrada nesta entrega:

- Banco migrado com COMMIT; ERP `/state` HTTP 200; n8n 2.39.6 com novos 01/02/03 e mapeamento `body` corrigido.
- Reset real concluído.
- John Carter: operação **2**, ciclo **2**, tentativa **1**, uma escrita em cada conector, **3335 ms** de processamento ativo.
- Frontend exibiu o resultado e confirmou envio do relatório. **Recebimento do e-mail ainda não confirmado nesta rodada.**

Continuam pendentes:

1. **Falha parcial real e retomada seletiva.** Em uma janela de teste autorizada, exporte a configuração correta, provoque rejeição explícita somente em GCP Apply mantendo Inspect correto, confira ERP succeeded/GCP failed, restaure a configuração e retome o mesmo ID. ERP/Postgres não devem aumentar suas escritas. Se der `unknown`, siga revisão operacional; não force o status.
2. **Concorrência real.** Solicitações simultâneas devem resultar em OPERATION_BUSY sem sobreposição, inclusive reset versus offboarding. Verifique também ID expirado após reset e reentrega após conclusão.
3. **Hidratação no Firefox.** O seletor nativo e a supressão pré-existente de avisos no layout não substituem este teste.
4. **Recebimento do handover** nesta rodada e comparação de um export atual do workflow publicado. Não reenviar cegamente em caso de resultado incerto.

Não há aprovação completa nem declaração de prontidão para produção. Os exports locais usam sete contas GCP sintéticas permitidas, offboarding/reset exigem Header Auth, reset usa POST e o cron está desabilitado. Não foi adicionado rate limiting persistente; o envio público de handover está desabilitado nas duas rotas locais. Não há garantia exactly-once externa ou deduplicação persistente de e-mail. OAuth Gmail em Testing mantém suas limitações de expiração.

## 7. Rollback

Despublique os novos 02/03; confirme ausência de execuções e requisições em voo e resolva resultados incertos antes de reativar fluxos antigos. Restaure frontend/ERP e os backups reais dos workflows. Não use exports legados não comparados ou `reference/` como substitutos do handover publicado.

As tabelas aditivas `iam_*` podem permanecer para diagnóstico. Restaurar o dump exige uma decisão deliberada: não apague auditorias recentes cegamente. Não apague volumes nem faça coexistir fluxos antigos fora da trava com uma tentativa nova em andamento.

## Proposta local SCRUM-10 — não aplicada ao runtime

As alterações locais de 14/10/2026 não autorizam executar os passos de implantação acima. Consulte `docs/SCRUM-10-local-safety.md` para os controles, testes e lacunas. Os relatos operacionais históricos desta documentação não comprovam equivalência dos novos arquivos com os workflows publicados.
