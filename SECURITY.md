# Segurança e privacidade

## Fronteira de confiança

O cliente confia no documento principal de `https://cuescord.cuesc.net`.
O servidor entrega JavaScript que pode mudar independentemente do executável.
Este repositório permite auditar o cliente instalado e sua ponte nativa; não
contém todo o código executado pelo site remoto nem certifica esse serviço.

O renderer usa sandbox, contextIsolation e nodeIntegration=false. A ponte
pública expõe metadados, indicadores de mensagens/chamada e áudio autorizado; não há IPC genérico,
execução de comandos ou leitura arbitrária de arquivos disponíveis ao site.

Os indicadores aceitam apenas contagem inteira não negativa e estados booleanos
de chamada/microfone, enviados pelo frame principal da origem confiável. Atualizam
os ícones e desativam a limitação do renderer em segundo plano enquanto há uma
chamada, inclusive mutada; não ativam dispositivos. Saída, recarga ou falha do
renderer restauram a limitação. Fechar a janela a oculta na bandeja,
mantendo a sessão e uma chamada ativa. O menu **Fechar Cuescord** encerra o processo.

A origem principal pode solicitar microfone, câmera, notificações, clipboard,
fullscreen e captura. Permissões desconhecidas e outras origens são negadas.
A autorização do Electron não elimina prompts/restrições do sistema operacional.
No Electron 44, o pedido de tela chega como `media` com `mediaTypes: []`;
no macOS ele só pode prosseguir para o seletor quando o frame principal e
`securityOrigin` pertencem à origem confiável. Esse pedido não autoriza câmera
ou microfone, e não substitui o consentimento de gravação de tela do macOS.
No macOS, cada pedido solicita somente os dispositivos necessários; uma chamada
de voz não exige consentimento para a câmera. Consentimento negado/restrito não
é contornado. Aplicativo e helpers incluem as permissões de áudio/câmera na
assinatura com Hardened Runtime; o build verifica essa assinatura antes de distribuir.
Não é iniciado áudio/câmera apenas por conceder permissão. Compartilhamento exige
gesto do usuário e escolha explícita; concessões de áudio expiram sem uso e são
revogadas em navegação, encerramento ou saída.

Se a página remota não carregar, o cliente abre o documento local exato
`electron/recovery/ui/index.html` e verifica a disponibilidade do servidor antes
de retornar à última URL permitida. Essa página usa sandbox e CSP restritiva e
recebe apenas os controles de janela. Não recebe Node.js nem a ponte de captura
de áudio ou tela. Outros arquivos locais e subframes não podem usar esses controles.

## Rede e dados locais

A voz nativa experimental usa uma sessão restrita ao frame principal confiável,
com preferência local inicialmente desabilitada. O helper Rust e a DLL WebRTC
são caminhos fixos do pacote; não aceitam código, caminhos, shell ou tokens de
autenticação da página. Só processam voz. As filas e mensagens têm limites e
prazos. Saída, navegação, falha ou timeout encerram o processo e liberam dispositivos.
Não há gravação ou download de dependências durante a chamada. PCM não passa
pelo renderer nesse caminho. Veja [docs/NATIVE-VOICE.md](docs/NATIVE-VOICE.md).

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
- No macOS 13+, o ScreenCaptureKit captura áudio do aplicativo escolhido ou do
  sistema, após seleção explícita e consentimento de gravação do macOS. O helper
  exclui o bundle e a árvore do Cuescord, nunca captura microfone e não grava
  arquivos. É assinado com Hardened Runtime; só aceita IDs da concessão nativa.
  O protocolo tem pacotes limitados e é encerrado ao revogar a concessão ou perder
  o processo pai. Permissão negada não causa fallback para outra fonte.
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
Nas releases com ZIP, esses bytes autenticam separadamente o arquivo ZIP e o
instalador interno. O cliente verifica o ZIP no disco antes da extração e aceita
somente o perfil `zip-store-v1`: uma entrada regular na raiz, com nome exato do
instalador, sem compressão, caminhos, links, arquivos adicionais, criptografia,
ZIP64, comentários ou campos extras. Os instaladores já são comprimidos; STORE
evita expansão de conteúdo durante a extração. Cabeçalhos, tamanho, CRC32 e
SHA-512 interno precisam corresponder; o destino é definido pelo cliente e
criado exclusivamente, nunca por um caminho fornecido pelo ZIP.
O download tem limites de tamanho, tempo e redirecionamentos. Arquivos parciais
são removidos, inclusive se a extração falhar ou for cancelada; ZIP e instalador
extraído são verificados novamente antes de abrir o instalador. Falha no ZIP não
provoca fallback para o instalador direto. Manifestos antigos assinados sem ZIP
continuam aceitos, sujeitos às mesmas regras de versão e integridade.

Versões menores ou iguais à instalada não são instaladas. O cliente guarda o
manifesto assinado da maior versão conhecida em userData/updates e recusa releases
anteriores a ela. Esse histórico detecta replay de versões já vistas; não detecta
uma release assinada antiga nunca vista ou a exclusão do histórico por quem pode
alterar o perfil local. A chave de assinatura e o workflow de publicação são parte
da confiança. Um atacante com acesso à conta local ou à chave privada está fora
dessa proteção; assinatura não comprova ausência de bugs na nova versão.

A instalação exige ação na janela local e confirmação nativa com cancelamento
como padrão. Windows conserva a marca de download da Internet; macOS conserva
a quarentena, tanto no ZIP quanto no instalador extraído. Distribuir em ZIP não
garante eliminar alertas ou bloqueios do sistema operacional.
A assinatura do manifesto não substitui certificados de publicador,
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
