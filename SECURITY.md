# Segurança e privacidade

## Fronteira de confiança

O cliente confia no documento principal de `https://cuescord.cuesc.net`.
O servidor entrega JavaScript que pode mudar independentemente do executável.
Este repositório permite auditar o cliente instalado e sua ponte nativa; não
contém todo o código executado pelo site remoto nem certifica esse serviço.

O renderer usa sandbox, contextIsolation e nodeIntegration=false. A ponte
pública expõe somente metadados e áudio autorizado; não há IPC genérico,
execução de comandos ou leitura arbitrária de arquivos disponíveis ao site.

A origem principal pode solicitar microfone, câmera, notificações, clipboard,
fullscreen e captura. Permissões desconhecidas e outras origens são negadas.
A autorização do Electron não elimina prompts/restrições do sistema operacional.
Não é iniciado áudio/câmera apenas por conceder permissão. Compartilhamento exige
gesto do usuário e escolha explícita; concessões de áudio expiram sem uso e são
revogadas em navegação, encerramento ou saída.

## Rede e dados locais

- O site usa a rede para login, conteúdo e chamadas; destinos de mídia são
  determinados pelo serviço remoto e podem incluir servidores STUN/TURN.
- Não há coletor de telemetria ou crashReporter configurado pelo cliente.
  Isso não é uma afirmação sobre telemetria do site ou serviços internos do Chromium.
- Electron mantém cookies, cache, IndexedDB, permissões e preferências na
  sessão `persist:cuescord` dentro do diretório `app.getPath('userData')`.
  Normalmente: `%APPDATA%/Cuescord`, `~/.config/Cuescord` ou
  `~/Library/Application Support/Cuescord`.
- O aplicativo não salva gravações de áudio/tela em arquivos por conta própria.
  PCM passa da captura para o renderer e para o fluxo de chamada do site.
- Selecionar arquivos para upload e downloads usam os mecanismos do navegador.
  Links externos HTTP(S) são abertos no navegador padrão.
- No Linux, o cliente consulta metadados de processos e streams de áudio para
  escolher a fonte e excluir seus próprios processos. Veja ARCHITECTURE.md.

## Atualizações

A janela de atualização é local, com sandbox, isolamento de contexto e CSP sem
conexões de rede. O site remoto pode abrir essa janela, mas não pode verificar,
baixar ou executar instaladores. O IPC exige a janela, o frame principal e a URL
local exatos; navegação, subframes, outras janelas e argumentos extras são recusados.

O processo principal consulta somente releases estáveis do repositório público
ArthurLins/cuescord-desktop via HTTPS, sem cookies ou tokens. Downloads seguem apenas
redirecionamentos HTTPS para os hosts de assets do GitHub explicitamente permitidos.
O manifesto exige uma assinatura Ed25519 da chave pública embutida no cliente;
os bytes assinados incluem versão, plataforma, arquitetura, nome, tamanho e SHA-512.
O download tem limites de tamanho, tempo e redirecionamentos. Arquivos parciais
são removidos; o arquivo final é verificado novamente antes de abrir o instalador.

Versões menores ou iguais à instalada não são instaladas. O cliente guarda o
manifesto assinado da maior versão conhecida em userData/updates e recusa releases
anteriores a ela. Esse histórico detecta replay de versões já vistas; não detecta
uma release assinada antiga nunca vista ou a exclusão do histórico por quem pode
alterar o perfil local. A chave de assinatura e o workflow de publicação são parte
da confiança. Um atacante com acesso à conta local ou à chave privada está fora
dessa proteção; assinatura não comprova ausência de bugs na nova versão.

A instalação exige ação na janela local e confirmação nativa com cancelamento
como padrão. Windows conserva a marca de download da Internet; macOS conserva
a quarentena. A assinatura do manifesto não substitui certificados de publicador,
SmartScreen ou Gatekeeper. Não se executa instalador silencioso nem comando
fornecido pelo site. Linux/macOS usam a instalação normal de .deb/.dmg.

O Git distribui somente a chave pública. A chave privada inicial é protegida por
Windows DPAPI CurrentUser, fica em .update-signing ignorado pelo Git e não é
incluída no aplicativo. O secret UPDATE_SIGNING_PRIVATE_KEY é acessado apenas
pelo job de publicação de tags, separado dos builds e PRs. Releases são publicadas
somente depois de incluir todos os arquivos e o manifesto; assets publicados não
são sobrescritos pelo workflow.

## Builds e terceiros

Instaladores incluem Electron/Chromium e módulos nativos de terceiros obtidos
das distribuições upstream; não compilamos Chromium ou todos esses módulos do
zero. As versões e integridades npm estão no lockfile. Certificados de
publicador são opcionais; assinatura ad-hoc no Mac não comprova identidade.

Nunca coloque tokens, certificados, cookies, arquivos de perfil, dumps ou dados
de chamadas em issues, commits ou logs públicos.

## Relatar vulnerabilidades

Use [Report a vulnerability](https://github.com/ArthurLins/cuescord-desktop/security/advisories/new)
para um relato privado. Informe versão, sistema, passos de reprodução e impacto,
sem dados reais de usuários. Para problemas gerais sem informação sensível,
use as issues. A manutenção foca na versão mais recente.
