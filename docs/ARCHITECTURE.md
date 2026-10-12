# Mapa do cliente

A voz nativa do Windows e seu contrato público estão documentados em
[NATIVE-VOICE.md](NATIVE-VOICE.md). Ela usa um processo separado no Windows x64,
selecionado automaticamente no Windows x64, mantendo câmera e compartilhamento no renderer.

## Processos e fronteiras

```text
serviço HTTPS remoto
        |
renderer Chromium (sandbox, sem Node)
        | preload / IPC com origem + frame validados
processo principal Electron
        | concessão explícita de captura
processo auxiliar de áudio
        | WASAPI (Windows) / pactl + parec + xprop (Linux) / ScreenCaptureKit (macOS)
PCM -> preload -> renderer/AudioWorklet -> MediaStream do site
```

| Caminho | Responsabilidade e acesso |
| --- | --- |
| electron/main.cjs | Uma janela, sessão persistente, links externos e controles |
| electron/window/window-controls.cjs | Comandos IPC da janela com validação de remetente |
| electron/window/desktop-presence.cjs, status-icons.cjs | Bandeja, fechar para ocultar, contador Windows, indicadores de chamada/microfone e proteção de chamada contra limitação em segundo plano; IPC com estado e origem validados |
| electron/update/window.cjs, preload.cjs, ui/ | Janela local isolada; IPC exclusivo para atualização |
| electron/update/policy.cjs, network.cjs, updater.cjs | HTTPS restrito, assinatura, download, verificação e aplicação da atualização |
| electron/update/selection.cjs, package-store.cjs | Política pura de versão/pacote e adaptador de watermark, integridade, marca de Internet, staging e extração |
| electron/update/application.cjs, windows-application.cjs, native/updater/ | Pacote completo Windows, staging, espera pelo pai, troca, reinício e recuperação |
| electron/update/trusted-keys.json | Chaves públicas de atualização fixadas no cliente |
| scripts/sign-update.mjs, update-key.mjs | Assinatura da release e chave privada protegida por DPAPI |
| electron/security/policy.cjs | URL de produção, origem exata e permissões permitidas |
| electron/security/permissions.cjs | Pedidos de dispositivos; autorização de macOS |
| electron/capture/capture.cjs | Enumeração de fontes, tokens de seleção, revogação |
| electron/capture/quality.cjs, selection.cjs | Perfis e regras puras de seleção de fonte, aplicativo e consentimento de áudio |
| electron/audio/audio.cjs | Concessão vinculada ao frame e ciclo do utilityProcess |
| electron/audio/grant.cjs, capabilities.cjs | Modelo de concessão única com validade e política pública de suporte macOS |
| electron/audio/audio-worker.cjs | WASAPI e FFI de user32.dll para PID da janela |
| electron/audio/audio-linux.cjs | pactl, parec, xprop e leitura de /proc/PID/stat |
| electron/audio/audio-mac.cjs | Protocolo PCM limitado e ciclo do capturador macOS |
| Package.swift, native/macos/ScreenAudio.swift, process/ | ScreenCaptureKit, conversão PCM e exclusão da árvore do Cuescord |
| customizations/audio/audio.js | Ponte PCM sem expor o evento IPC ao site |
| customizations/capture/capture-modal.* | Modal, miniaturas e escolha de áudio |
| customizations/titlebar/desktop.js, titlebar.css | Barra Windows em shadow DOM |
| renderer/ | Contratos IPC do produtor para testes e mapa de entrada Windows; a implementação de navegador pertence ao web |
| scripts/build.mjs | Incorpora fontes locais ao preload, sem baixar a plataforma |
| electron-builder.cjs | Lista explícita do conteúdo distribuído e dependências |
| .github/workflows/build.yml | Builds por sistema e publicação de tags |

O build empacota electron/, dist/preload.cjs, dist/updater-preload.cjs, ícones, licença/avisos e dependências
de produção. O web é a aplicação base e não importa este repositório. Seu código
de sessão, PTT, recuperação, presença e worklet usa capacidades opcionais fornecidas
pelo preload. O preload não requer arquivos JS arbitrários
depois de empacotado. Os binários .node são extraídos do ASAR pelo empacotador.

## Compartilhamento

1. O site chama getDisplayMedia com gesto do usuário.
2. O processo principal valida documento, origem e ausência de seleção pendente.
3. O modal enumera Janelas ou Telas. Um identificador aleatório vincula o seletor
   ao frame; só fontes enumeradas podem ser concedidas.
4. A escolha cria uma concessão de áudio de uso único com prazo de 30 segundos.
5. O site usa o adaptador público para iniciar essa concessão e receber PCM.
6. A captura nativa roda fora do renderer e do processo principal. Créditos limitam
   mensagens pendentes e cada bloco a 8192 bytes. O worklet limita filas e canais.
7. Navegação real, destruição do renderer/janela ou stop revogam a captura.

Windows usa árvore de processos. Linux consulta streams e ancestralidade em
/proc, conferindo identidade do processo para evitar reutilização de PID.
Nenhum módulo de áudio aceita um PID arbitrário vindo da página.
Não há serviço de sistema instalado nem captura persistente em segundo plano.

## Dependências e responsabilidades

Os contextos seguem as necessidades do cliente instalado; a conta, as comunidades
e as mensagens pertencem à plataforma remota. O domínio local contém regras de
concessão, seleção, protocolo e atualização. Políticas não acessam Electron, rede,
filesystem nem timers. Não há camadas DDD adicionais para drivers, scripts ou PCM.

`electron/main.cjs` compõe os contextos e injeta a enumeração de aplicativos Linux
na captura. Fora dessa composição, contextos usam somente as políticas públicas
de segurança e capacidades de áudio. Voz, PTT e presença cooperam por callbacks;
nenhum deles importa detalhes do outro. `renderer` declara os contratos do
produtor para testes; não contém a coordenação de navegador. O runner `test:web`
injeta executável/entrypoints nas jornadas da aplicação base, inclusive quando
`CUESCORD_WEB_ROOT` aponta para outro clone.

`DesktopUpdater` coordena as decisões assinadas e o ciclo de atualização por
portas: `readJson`, `downloadVerified`, confirmação, instalação e armazenamento.
O armazenamento implementa `ensure`, `readWatermark`, `remember`, `createDownload`,
`prepare`, `verifyReady` e `discard`. Ele não escolhe releases nem faz rede.
`electron/update/window.cjs` fornece os adaptadores concretos. Assim, o serviço
pode ser testado em memória sem escrever ou executar um instalador.

O plano do helper Windows fica em `native/updater/src/plan.rs`: nomes relativos,
paths irmãos de staging/backup e paths locais de aceite são regras puras. O helper
confere existência, ausência de links/reparsepoints, hashes e identidade do pai
separadamente. A troca e a recuperação continuam usando as mesmas regras.

`scripts/check-architecture.mjs`, incluído em `desktop:check`, verifica os imports
literais/requires do código JS/TS local: políticas puras, serviço por portas,
fronteiras públicas, renderer sem imports privilegiados e ausência de ciclos.
Ele recusa requires dinâmicos no runtime e verifica que políticas nativas não
adquiram acesso a disco/processo/FFI. Não substitui os testes de IPC, o compilador,
os hashes de ABI/SDK ou o aceite de dispositivos em cada sistema.

## Limites conhecidos

Atualizações exigem confirmação local. Windows usa troca do aplicativo e reinício;
clientes antigos e Linux/macOS usam a instalação nativa do sistema. O site só pode
abrir a janela local; a janela controla os pedidos de atualização. Nenhuma chave
privada ou script de publicação é empacotado. Veja SECURITY.md e RELEASING.md para
o formato assinado, a cadeia de confiança e o preparo da primeira release.

O site remoto participa da reprodução/transmissão: auditar apenas o instalador
não audita a implementação do serviço. Várias janelas do mesmo aplicativo podem
ter áudio misturado. Wayland tem seleção externa controlada pelo sistema.
macOS 13+ usa um helper Swift compilado no build, incluído fora do ASAR e assinado
com Hardened Runtime. A fonte é resolvida novamente por ID no ScreenCaptureKit;
uma janela concede somente seu aplicativo. Uma tela concede áudio do sistema,
excluindo o bundle e descendentes do processo Cuescord. Microfone não é capturado.
Somente PCM estéreo de 48 kHz passa pelo pipe, com pacotes de até 8192 bytes.
EOF, stop, perda de origem/frame ou destruição encerram o helper. Não há driver,
fallback para microfone ou instalação auxiliar de sistema.
Os builds testam conversão/estéreo/exclusão sem gravar janelas reais; não validam
consentimento TCC, hardware, configuração PipeWire ou uma chamada real.
