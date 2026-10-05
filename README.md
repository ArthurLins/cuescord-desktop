# Cuescord Desktop

[![Build installers](https://github.com/ArthurLins/cuescord-desktop/actions/workflows/build.yml/badge.svg)](https://github.com/ArthurLins/cuescord-desktop/actions/workflows/build.yml)

Cliente desktop **open source, MIT**, baseado em Electron. Este repositório contém
o código específico do aplicativo instalado: janela, preload, permissões,
compartilhamento de tela/áudio, integrações com o sistema e empacotamento.

A interface da conta e das chamadas é carregada de **https://cuescord.cuesc.net**.
Ela pode mudar no servidor sem trocar o instalador. O serviço web, sua interface,
API, banco e infraestrutura não fazem parte deste repositório nem da licença MIT
do cliente. Publicar o cliente não torna a plataforma inteira open source.

## Downloads

Para preparar ou publicar uma versão, leia o [guia de deployment](docs/RELEASING.md).
Agentes devem reler o procedimento a cada solicitação, conforme [AGENTS.md](AGENTS.md).

Baixe em [Releases](https://github.com/ArthurLins/cuescord-desktop/releases).
Cada release inclui ZIPs com os instaladores, hashes SHA-256 e informações do build
(commit, runtime e execução do GitHub Actions).

| Sistema                        | Arquitetura | Instalador               |
| ------------------------------ | ----------- | ------------------------ |
| Windows                        | x64         | ZIP contendo NSIS `.exe` |
| Debian/Ubuntu                  | amd64       | ZIP contendo `.deb`      |
| macOS, linha M (Apple Silicon) | arm64       | ZIP contendo `.dmg`      |

Para instalar manualmente, extraia o ZIP e abra o instalador pelo sistema.
Instaladores diretos permanecem disponíveis para clientes antigos atualizarem.

Não geramos macOS Intel/x86 ou universal. A partir da versão 0.4.0, use o botão
**Atualizações do Cuescord** na barra Windows ou **Ajuda → Atualizações do Cuescord**.
Desde 0.4.3, o cliente verifica a release, baixa o ZIP com progresso/cancelamento,
extrai o instalador automaticamente e exige assinatura Ed25519 e hashes SHA-512
válidos tanto do ZIP quanto do instalador antes de permitir instalar.
Clientes 0.4.0–0.4.2 continuam atualizando pelo instalador direto.
Na ausência de certificados, Windows fica sem assinatura de publicador e macOS
usa assinatura ad-hoc, sem notarização; o sistema pode bloquear a primeira
abertura. ZIP não garante eliminar esses avisos. Consulte [distribuição e assinatura](docs/RELEASING.md).

No Debian: `sudo apt install ./Cuescord-0.4.0-linux-amd64.deb`.
O APT resolve as dependências declaradas pelo pacote. Não são necessários Rust,
WebKitGTK ou WebView2. Electron inclui Chromium e Node no instalador.

## O que roda na sua máquina

- Fechar a janela envia o cliente para a bandeja, preservando chamadas e mensagens.
  Clique no ícone para reabrir; para encerrar, use **Fechar Cuescord** no menu do
  botão direito da bandeja.
- Durante chamadas, inclusive com o microfone silenciado, o desktop desativa a
  limitação do renderer em segundo plano para proteger o ritmo do áudio. Ao sair
  da chamada, recarregar a página ou encerrar o renderer, restaura a limitação.
  Isso pode aumentar o consumo de recursos enquanto uma chamada está ativa.
- No Windows, o ícone da barra de tarefas mostra as mensagens não lidas (`99+`
  acima de 99). Durante uma chamada, os ícones da janela e da bandeja mostram um
  telefone com o microfone ativado ou desativado. Ao sair, volta o ícone normal.
- Um processo principal Electron gerencia janela, sessão e permissões.
- O site roda com sandbox, isolamento de contexto e Node desativado.
- O preload injeta a barra Windows e o modal de compartilhamento, com IPC limitado.
- Ao compartilhar áudio autorizado, um processo auxiliar captura PCM localmente.
- Cookies, cache e armazenamento do site ficam no perfil local do Electron.
- O atualizador consulta o GitHub apenas quando solicitado. No Windows, abre o
  instalador verificado e fecha o cliente após confirmação; no Linux/macOS,
  abre o pacote para concluir a instalação pelo sistema. Clientes anteriores
  à versão 0.4.0 precisam de uma instalação manual inicial.
- O cliente não configura serviço de inicialização ou telemetria própria.
  O site remoto e Chromium têm comportamento de rede próprio; veja os limites em
  [segurança e privacidade](SECURITY.md).

Leia o [mapa de código e fluxo de dados](docs/ARCHITECTURE.md) para auditar o cliente,
os subprocessos, os acessos ao sistema e a fronteira com o conteúdo remoto.

## Rodar a partir do código

Requer Git, Node.js **22.23.2** (ou versão compatível >=22.12) e pnpm **10.32.1**.
O repositório é independente: nenhum acesso ao código privado é necessário.
No macOS, instale também as ferramentas de linha de comando do Xcode. O build
compila o capturador Swift localmente e executa seus testes sintéticos.

```bash
git clone https://github.com/ArthurLins/cuescord-desktop.git
cd cuescord-desktop
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
pnpm desktop:dev
```

`desktop:dev` e `desktop:dev:remote` abrem o serviço publicado. Para um site
local já iniciado, use `pnpm desktop:dev:existing` (localhost:3000). O cliente
não inicia servidores de plataforma. Em desenvolvimento,
`CUESCORD_DESKTOP_URL` aceita outra URL HTTPS ou HTTP de loopback.
O executável empacotado sempre usa a URL em `electron/security/policy.cjs`.

## Gerar instaladores

Execute cada build no sistema correspondente:

```bash
pnpm desktop:build:win    # Windows x64
pnpm desktop:build:linux  # Linux amd64, Debian/Ubuntu
pnpm desktop:build:mac    # macOS arm64, Apple Silicon
```

Saída em `release/`. `pnpm desktop:build` usa a plataforma atual; o alvo macOS
permanece arm64. O preload é gerado de fontes locais, sem baixar código do site.
Lockfile e versões das ferramentas são públicos; não prometemos igualdade
binária byte a byte entre builds com diferentes sistemas e assinaturas.

## Compartilhamento

O seletor abre num modal, separado em **Janelas** e **Telas**. No Windows/Linux,
janelas incluem áudio do aplicativo e telas oferecem uma opção de áudio
inicialmente desmarcada. A captura da tela inteira exclui a árvore de processos
do Cuescord para evitar reenviar a chamada. Microfone é um fluxo separado.

- Windows: WASAPI Process Loopback exige suporte do sistema (build 20348+).
- Linux: áudio usa `pactl`/`parec` via PulseAudio ou `pipewire-pulse`.
  O pacote instala `pulseaudio-utils` e `x11-utils`.
- Wayland: PipeWire e o portal do ambiente gráfico precisam estar disponíveis.
  O sistema pode abrir seu próprio seletor; a escolha do aplicativo de áudio é
  explícita, pois o portal não fornece o PID da janela.
- macOS: vídeo, câmera e microfone dependem das permissões do sistema.
  No macOS 13 ou superior, **Compartilhar áudio** permite transmitir o aplicativo
  da janela escolhida ou o áudio do sistema ao compartilhar uma tela. A opção
  começa desmarcada; o Cuescord e seus helpers são excluídos da captura.
  Autorize **Gravação de Tela e Áudio do Sistema** em Privacidade e Segurança
  quando o macOS solicitar. O áudio não passa pelos filtros do microfone.

O isolamento de áudio é por processo/aplicativo; várias abas/janelas do mesmo
processo podem compartilhar som. O cliente não consegue isolar uma aba de um
navegador externo. A integração de PCM com WebRTC é pública em `renderer/`;
o site precisa consumir esse adaptador, conforme [integração](docs/INTEGRATION.md).

## Participar

Leia [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A licença MIT cobre o código
deste cliente; dependências mantêm suas próprias licenças.

Comandos disponíveis: `pnpm desktop:check` para geração/sintaxe,
`pnpm test` para a suíte existente e `pnpm test:ui` para os testes de interface
(requer `pnpm exec playwright install chromium`). CI empacota os três sistemas;
isso não confirma funcionamento de dispositivos físicos em uma chamada real.
