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
