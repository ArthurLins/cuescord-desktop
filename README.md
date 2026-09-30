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

Baixe em [Releases](https://github.com/ArthurLins/cuescord-desktop/releases).
Cada release inclui os instaladores, hashes SHA-256 e informações do build
(commit, runtime e execução do GitHub Actions).

| Sistema | Arquitetura | Instalador |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe` |
| Debian/Ubuntu | amd64 | `.deb` |
| macOS, linha M (Apple Silicon) | arm64 | `.dmg` |

Não geramos macOS Intel/x86 ou universal. Não há atualizador automático.
Na ausência de certificados, Windows fica sem assinatura de publicador e macOS
usa assinatura ad-hoc, sem notarização; o sistema pode bloquear a primeira
abertura. Consulte [distribuição e assinatura](docs/RELEASING.md).

No Debian: `sudo apt install ./Cuescord-0.3.1-linux-amd64.deb`.
O APT resolve as dependências declaradas pelo pacote. Não são necessários Rust,
WebKitGTK ou WebView2. Electron inclui Chromium e Node no instalador.

## O que roda na sua máquina

- Um processo principal Electron gerencia janela, sessão e permissões.
- O site roda com sandbox, isolamento de contexto e Node desativado.
- O preload injeta a barra Windows e o modal de compartilhamento, com IPC limitado.
- Ao compartilhar áudio autorizado, um processo auxiliar captura PCM localmente.
- Cookies, cache e armazenamento do site ficam no perfil local do Electron.
- O cliente não configura serviço de inicialização, atualizador ou telemetria própria.
  O site remoto e Chromium têm comportamento de rede próprio; veja os limites em
  [segurança e privacidade](SECURITY.md).

Leia o [mapa de código e fluxo de dados](docs/ARCHITECTURE.md) para auditar o cliente,
os subprocessos, os acessos ao sistema e a fronteira com o conteúdo remoto.

## Rodar a partir do código

Requer Git, Node.js **22.23.2** (ou versão compatível >=22.12) e pnpm **10.32.1**.
O repositório é independente: nenhum acesso ao código privado é necessário.

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
O executável empacotado sempre usa a URL em `electron/policy.cjs`.

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
  **Captura de áudio de aplicativo/tela ainda não está implementada no macOS.**

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
