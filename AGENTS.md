# Instruções para agentes do Cuescord Desktop

Antes de qualquer deploy, release, publicação, atualização de ambiente ou rollback
do cliente, leia **integralmente** [docs/RELEASING.md](docs/RELEASING.md),
[SECURITY.md](SECURITY.md) e [.github/workflows/build.yml](.github/workflows/build.yml),
**a cada pedido**. Confira a versão, a política/chaves públicas e os scripts de
assinatura da revisão a publicar; não substitua essa leitura por memória.

Quando este repositório estiver como `apps/desktop` no Cuescord, leia primeiro o
[guia geral da plataforma](../../DEPLOY.md) e siga também o `AGENTS.md` da raiz.
No clone independente, RELEASING.md é o procedimento obrigatório do desktop.

Siga preparação, validação, publicação, aceite e recuperação. Chave Ed25519 de
atualização é obrigatória; certificado de publicador Windows é opcional. Não gere
outra chave para contornar falha, não publique arquivos sem assinatura nem
sobrescreva assets/tags publicados. Preserve as proteções do sistema operacional.

Pedidos explícitos de release autorizam suas etapas no alvo indicado, sem
confirmações repetidas. Documentação/build local não autorizam publicação. Pergunte
somente por informação necessária ausente ou ação destrutiva/fora do escopo sem
autorização. Não exponha segredos. Não declare sucesso antes de acompanhar Actions,
conferir a release e informar o resultado do aceite ou a etapa externa pendente.

Mantenha RELEASING.md atualizado quando alterar este fluxo. O repositório da
plataforma e suas credenciais não pertencem a este repositório público.

## Arquitetura e Clean Code

Leia [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) antes de alterar fronteiras.
Organize o cliente pelos contextos existentes: captura, áudio compartilhado, voz
nativa, entrada, presença/janela, recuperação, segurança e atualização. Não copie
entidades da plataforma nem crie agregados, repositórios ou camadas artificiais
para scripts, PCM, FFI ou helpers físicos. Use modelos de domínio quando houver
uma invariante real, como a concessão única de áudio ou o plano de atualização.

- Políticas são determinísticas e recebem os dados de que precisam. Não importam
  Electron, filesystem, rede, processos, relógios globais ou timers. Criptografia
  síncrona de validação de manifestos é permitida; ela não acessa chaves privadas.
- `electron/main.cjs` compõe os contextos. `electron/update/window.cjs` compõe os
  adaptadores do contexto de atualização. Adaptadores recebem dependências do
  contexto por parâmetros; captura recebe a enumeração Linux do composition root.
- `electron/update/updater.cjs` é serviço de aplicação: coordena estados,
  confirmação e políticas assinadas por portas injetadas. Não importa adaptadores
  de rede, disco ou sistema. `package-store.cjs` implementa armazenamento,
  watermark, integridade, marca de Internet, staging, extração e descarte; ele não
  decide qual release ou pacote oferecer e não baixa arquivos.
- As únicas dependências diretas entre contextos fora do composition root são
  as políticas públicas `security/policy.cjs` e `audio/capabilities.cjs`. Não
  importe detalhes de captura, worker, voz ou atualização de outro contexto.
  Integrações de voz/presença/PTT usam callbacks e portas no composition root.
- O web é a aplicação base e não importa este repositório. `renderer/` declara
  apenas os contratos IPC do produtor usados nos testes e o mapa de entrada
  Windows do host; sessão, recuperação, PTT no DOM e worklets pertencem ao web.
  O desktop fornece capacidades opcionais por sua ponte e consome a aplicação
  remota. Jornadas do web em Electron são disparadas por `pnpm test:web`, que
  injeta executável/entrypoints; no clone independente informe `CUESCORD_WEB_ROOT`.
  `customizations/` recebe
  a ponte IPC e é incorporado ao preload; não recebe módulos ou APIs irrestritas.
- Rust `native/updater/src/plan.rs` e `native/voice/src/protocol.rs` contêm regras
  puras. FFI, filesystem e processo pertencem aos adaptadores/helpers. Preserve
  layout/ABI, limites de mensagens e hashes do SDK; não refatore código vendorizado
  sem revisar sua origem e os mecanismos que o verificam.
- Prefira nomes do recurso e métodos com uma responsabilidade. Separe decisão
  de efeito, evite booleanos de modo obscuros e mantenha dependências explícitas.
  Não substitua uma regra por wrappers que apenas encaminham chamadas.

As políticas atuais são `capture/quality.cjs`, `capture/selection.cjs`,
`audio/capabilities.cjs`, `audio/grant.cjs`, `update/policy.cjs`,
`update/selection.cjs`, `window/presence-policy.cjs`, `voice/protocol.cjs` e
`security/policy.cjs`. Registre novos módulos puros e interfaces públicas no
checker `scripts/check-architecture.mjs`; o checker rejeita I/O em políticas,
imports privilegiados no navegador, ciclos e acesso a detalhes de outro contexto.

## Ciclo de vida e validação

Concessões de captura são vinculadas ao frame autorizado; a de áudio é de uso
único e expira após 30 segundos mesmo se um timer atrasar. Navegação real, crash,
destruição e encerramento revogam recursos. O proprietário antigo nunca pode
revogar ou modificar uma sessão mais nova. Mensagens, filas, buffers e prazos são
limitados. Preserve autorização de origem/frame e consentimento local.

O atualizador revalida o manifesto antes de download e instalação, verifica os
bytes salvos e o pacote preparado, e conserva as marcas de Internet do sistema.
Cancelamento ou falha descarta somente seu próprio staging. Um watermark assinado
impede downgrade; clientes antigos e a fixture imutável v1 são compatibilidade
ativa. Preserve estes comportamentos em refatorações.

Após alterações, execute `pnpm desktop:check` (geração, fronteiras e sintaxe),
`pnpm format:check` e `pnpm test`. Os testes de atualização Windows dependem de
permissões reais para links e de um helper local recompilado; falhas do sandbox
não autorizam remover proteções. Para IPC/preload/UI, execute `pnpm test:ui` com
Chromium disponível. Não baixe ou capture dispositivos físicos sem necessidade.

Quando este cliente estiver como submódulo da plataforma Cuescord, mudanças em
TypeScript próprio, incluindo testes e configuração, devem passar também por
`pnpm check:quality` e `pnpm typecheck:tools` executados na raiz da plataforma
(este último executa `tsc --noEmit -p tools/tsconfig.quality.json`).
O compilador verifica os contratos dos fixtures
e do renderer em modo estrito; pontes opcionais exigem guards reais de presença,
sem `any` ou conversões por `unknown` para encobrir propriedades ausentes.
O perfil recomendado completo
do SonarJS fixado no lockfile da plataforma tem 295 regras, informações de tipos
e complexidade cognitiva máxima de 15 por função. Não eleve limites, exclua
arquivos próprios nem suprima achados de complexidade, manutenção ou correção.
Refatore por responsabilidade e preserve contratos, cancelamento e descarte.
Hotspots de segurança inaplicáveis só admitem `eslint-disable-next-line` com uma
regra específica e justificativa concreta na mesma linha; registre a revisão com
`pnpm check:quality --report <arquivo>`. Um relatório limpo não substitui os testes.

Essa checagem adicional pertence à integração com a plataforma. O clone desktop
independente continua usando seus comandos locais de validação e não deve adquirir
imports, dependências ou caminhos obrigatórios para a plataforma. Preserve também
a direção da integração: o web compila e testa sem este submódulo, sem importar
seus tipos, implementação, fixtures ou assets. Jornadas em Electron recebem os
entrypoints e o executável pelo runner do host.

Quando mudar Rust, execute `cargo +1.94.0 fmt --check`, `cargo +1.94.0 check` e
`cargo +1.94.0 test` com `--manifest-path native/<componente>/Cargo.toml`; use
`--locked --offline` nos comandos de compilação/teste quando o cache permitir.
Mudanças no atualizador exigem rebuild local do helper e os testes de integração
Windows. Para C++, use os alvos existentes `VoiceGateTests`, `VoiceNoiseTests`,
`VoiceQualityTests` e `VoiceAudioSessionTests`; Swift e aceite de hardware exigem
o sistema nativo correspondente. Informe explicitamente os checks não executados.
Build local, revisão e atualização deste documento continuam sem autorizar deploy.
