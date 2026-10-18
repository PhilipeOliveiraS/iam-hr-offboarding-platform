# IAM-HR no Cortex: preparação e teste paralelo

## Atualização SCRUM-10 — 2026-10-16

O usuário confirmou o preview saudável, GET HTTP 200/JSON, sete colaboradores
no túnel local e offboarding publicado com Header Auth. O Compose agora injeta
`N8N_WEBHOOK_KEY`; não foi lido seu valor. Essas evidências substituem as
pendências históricas equivalentes abaixo, sem repetir SSH, testes remotos ou
publicação. O túnel em `127.0.0.1:13001` ainda não comprova acesso público.

O bloqueio atual é a ausência de ingress com identidade de cliente confiável
e limites de POST comprovados. Consulte
[a análise e a mudança mínima no proxy](docs/SCRUM-10-abuse-boundary.md).
As seções seguintes preservam o plano histórico e não devem ser executadas
para repetir etapas já concluídas. Nenhum deploy foi feito nesta revisão.

## Estado verificado

Repositório em `feature/iam-hr-partial-recovery`, base `63b6e34`.
Preservado `allowedDevOrigins`. Lockfile: Next 16.3.5, React 19.3.0;
Next exige Node >=20.9.0. Imagem usa Node 24 e standalone.
Nenhuma alteração de domínio, Vercel, banco ou workflow foi executada.
Workflow 03 permanece desativado/unpublished; não o importe nem o execute.

Os exports confirmam GET `/webhook/iam-hr-data` e POST
`/webhook/iam-hr-action`. Não há export de relatório ou leads.
`.env.local` tem GET, offboard e report; `.env` tem GET e a variável legada
`N8N_POST_ACTION_URL` (não lida pelas rotas atuais). Nenhum dos arquivos
locais configura leads ou `N8N_WEBHOOK_KEY`. Não transfira esses arquivos.
Os exports de GET/offboard não declaram autenticação no node webhook;
isso não confirma a configuração publicada nem eventuais validações externas.
A rota IAM envia `X-N8N-Webhook-Secret` se configurado; leads envia somente
Content-Type. Antes de disponibilizar leads, confirme o workflow e sua
exigência de autenticação. Não invente chave nem desative autenticação.
O Compose não injeta `N8N_WEBHOOK_KEY`, pois seu uso atual não foi confirmado.

SSH ao Cortex falhou por autenticação. Rede, alias DNS `n8n`, workflows
publicados, recursos disponíveis, Docker/Compose e Tunnel ainda precisam
ser verificados no host. Não há arquivo Docker/Compose anterior neste repo.

## Inspeção read-only no Cortex

Execute localmente no host, sem divulgar saídas que contenham credenciais:

```sh
cd ~/factory
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
docker network inspect factory_default --format '{{range .Containers}}{{.Name}} {{end}}'
docker inspect factory-n8n-1 --format '{{json .NetworkSettings.Networks}}'
docker compose version
systemctl is-active cloudflared
```

Identifique cloudflared por nome/imagem. Não imprima `docker inspect` completo,
variáveis dos containers, argumentos do processo ou `systemctl cat`: podem
conter tokens. Para um container identificado, inspecione somente suas redes
com o template acima. Para Tunnel via systemd, consulte privadamente apenas
as regras ingress da configuração, sem tokens ou credenciais.

Se cloudflared roda no host, pode alcançar `http://127.0.0.1:3001`.
Se roda em container na factory_default, pode alcançar `http://iam-hr:3000`.
Se está em outra rede/host, nenhuma dessas opções está confirmada. Não altere
redes do Tunnel, ingress, DNS ou hostname de produção. Antes de qualquer
mudança pública, apresente o ingress atual sem segredos e o diff proposto.
O teste inicial usa SSH port forwarding e independe de mudanças no Tunnel.

## Transferência proposta: artefato permitido para diretório separado

Não transfira o repositório inteiro nem o stack factory. No computador local:

```sh
tar -czf /tmp/iam-hr-cortex-source.tgz \
  Dockerfile .dockerignore compose.iam-hr.yml DEPLOY-CORTEX.md \
  package.json package-lock.json next.config.ts tsconfig.json \
  postcss.config.mjs eslint.config.mjs app components lib public
ssh philipe@192.168.7.29 'mkdir -p ~/factory/iam-hr-preview'
scp /tmp/iam-hr-cortex-source.tgz philipe@192.168.7.29:~/factory/iam-hr-preview/
```

Esse método ainda não foi executado. Confirme o conteúdo permitido antes de
transferir. Se houver um preview existente, use outro diretório para preservar
a versão anterior. Não use exports n8n ou SQL como fontes de implantação.

## Runtime e implantação, somente após verificações

O preview inicial é somente para leitura do dashboard. Crie
`~/factory/iam-hr-preview/.env.runtime` vazio, modo 600.
`N8N_REPORT_URL` e `N8N_LEAD_CAPTURE_URL` são opcionais e ficam vazios quando
não configurados; não bloqueiam o build nem a inicialização do preview.
Antes de usar relatório ou leads em uma fase posterior, confirme os paths e
a autenticação na configuração publicada, sem executar POST nesta fase, e
configure privadamente as URLs internas completas usando `http://n8n:5678`
e paths reais. Não copie os endpoints públicos.
`IAM_HR_IMAGE_TAG` é opcional para identificar versões da imagem.
GET e offboard são definidos no Compose com paths verificados nos exports.
O endpoint de offboarding permanece configurado, mas não deve ser acionado
no preview inicial; essa restrição é operacional, sem alteração das rotas.

Se posteriormente for confirmado uso da chave IAM, acrescente somente nesse
serviço a entrada runtime `N8N_WEBHOOK_KEY: ${N8N_WEBHOOK_KEY:?Required}` e
forneça o segredo pelo arquivo privado. Isso não autentica automaticamente leads.

No Cortex:

```sh
cd ~/factory/iam-hr-preview
tar -xzf iam-hr-cortex-source.tgz
# Cria o arquivo vazio se ausente, preservando qualquer arquivo existente.
umask 077
touch .env.runtime
chmod 600 .env.runtime
docker compose --env-file .env.runtime -f compose.iam-hr.yml config --quiet
docker compose --env-file .env.runtime -f compose.iam-hr.yml build iam-hr
docker compose --env-file .env.runtime -f compose.iam-hr.yml up -d --no-deps iam-hr
docker compose --env-file .env.runtime -f compose.iam-hr.yml ps
curl --fail --silent --output /dev/null http://127.0.0.1:3001/
```

O projeto separado `iam-hr-preview` adiciona somente IAM-HR à rede externa;
não use o Compose principal de `~/factory`, `down` nele, ou `--remove-orphans`.
Não rode build/up até confirmar testes, path e autenticação do dashboard,
alias n8n, porta 3001 livre e memória/disco disponíveis. Report e leads
podem permanecer sem configuração durante o preview inicial de leitura. Não imprima `compose config`
sem `--quiet`, arquivos de ambiente, ou logs que possam conter dados pessoais.
O healthcheck acessa somente a página local, sem executar workflows.

## Teste paralelo e rollback

No computador local:

```sh
ssh -N -L 127.0.0.1:3001:127.0.0.1:3001 philipe@192.168.7.29
```

O preview inicial é somente para leitura do dashboard. Abra
`http://127.0.0.1:3001/iam-hr-sandbox` e a Vercel em abas separadas. A página
sandbox faz GET de dashboard; verifique a configuração publicada antes de
acessá-la. Report e leads permanecem sem configuração nesta fase. Não clique em offboarding, relatório ou captura de leads.
Não execute POST, reset ou migrações. Para verificar DNS interno sem HTTP:

```sh
cd ~/factory/iam-hr-preview
docker compose --env-file .env.runtime -f compose.iam-hr.yml exec -T iam-hr node -e 'require("node:dns").lookup("n8n",e=>process.exit(e?1:0))'
```

Para voltar atrás, encerre o port forwarding e pare somente o serviço novo:

```sh
docker compose --env-file .env.runtime -f compose.iam-hr.yml stop iam-hr
```

A Vercel continua disponível e a produção não muda. Mantenha imagem/arquivos
anteriores para retorno de futuras versões. A rede compartilhada permite
acesso lateral aos outros serviços; a API mantém o comportamento atual e não
ganha controle de acesso por estar no Docker. Valide autenticação e limites
antes de uma eventual exposição pública. O build usa fontes Google e exige
acesso de saída, assim como npm e o download da imagem base.

## Validação local concluída

- `npm ci` na raiz e `npm ci --prefix tests`: concluídos usando Node 24.16.0.
- `npm run lint`: passou.
- `npm run build`: passou em cópia temporária sem arquivos `.env`, usando
  exatamente os fontes e dependências do lockfile; gerou `server.js` standalone.
- `npm test --prefix tests`: passou, incluindo 17 grupos de contratos frontend/API.
  Os cenários SQL/reset são exclusivamente simulados em PGlite e HTTP mockado.
- Smoke test standalone: página HTTP 200, API sem runtime HTTP 500,
  sem `.env` no artefato e sem chamadas upstream.
- Checagem adicional mockada de leads: corpos de erro e exceções upstream
  não vazam para logs ou resposta.
- YAML e assertions de projeto/rede/porta: passaram.
- Docker Compose oficial v2.39.4: `config --quiet` passou com um arquivo
  `.env.runtime` vazio e sem variáveis N8N herdadas do processo. A configuração
  resolvida foi verificada sem imprimir seus valores: `N8N_REPORT_URL` e
  `N8N_LEAD_CAPTURE_URL` são strings vazias.
- `git diff --check`: passou.

Docker Engine não está disponível localmente: imagem Docker, healthcheck
no container e conectividade real ao n8n ainda não foram testados. A cópia
inicial das dependências esgotou /tmp; somente essa cópia foi removida para
liberar espaço, e as verificações posteriores passaram. Nenhum commit/push,
transferência ou comando mutável remoto foi executado.

Referência: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
