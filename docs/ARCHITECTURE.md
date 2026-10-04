# Mapa do cliente

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
| electron/window/desktop-presence.cjs, status-icons.cjs | Bandeja, fechar para ocultar, contador Windows e indicadores de chamada/microfone; IPC com estado e origem validados |
| electron/update/window.cjs, preload.cjs, ui/ | Janela local isolada; IPC exclusivo para atualização |
| electron/update/policy.cjs, network.cjs, updater.cjs | HTTPS restrito, assinatura, download, verificação e abertura do instalador |
| electron/update/trusted-keys.json | Chaves públicas de atualização fixadas no cliente |
| scripts/sign-update.mjs, update-key.mjs | Assinatura da release e chave privada protegida por DPAPI |
| electron/security/policy.cjs | URL de produção, origem exata e permissões permitidas |
| electron/security/permissions.cjs | Pedidos de dispositivos; autorização de macOS |
| electron/capture/capture.cjs | Enumeração de fontes, tokens de seleção, revogação |
| electron/audio/audio.cjs | Concessão vinculada ao frame e ciclo do utilityProcess |
| electron/audio/audio-worker.cjs | WASAPI e FFI de user32.dll para PID da janela |
| electron/audio/audio-linux.cjs | pactl, parec, xprop e leitura de /proc/PID/stat |
| electron/audio/audio-mac.cjs | Protocolo PCM limitado e ciclo do capturador macOS |
| Package.swift, native/macos/ScreenAudio.swift, process/ | ScreenCaptureKit, conversão PCM e exclusão da árvore do Cuescord |
| customizations/audio/audio.js | Ponte PCM sem expor o evento IPC ao site |
| customizations/capture/capture-modal.* | Modal, miniaturas e escolha de áudio |
| customizations/titlebar/desktop.js, titlebar.css | Barra Windows em shadow DOM |
| renderer/ | Adaptadores de áudio e indicadores desktop, e worklet usados pela página |
| scripts/build.mjs | Incorpora fontes locais ao preload, sem baixar a plataforma |
| electron-builder.cjs | Lista explícita do conteúdo distribuído e dependências |
| .github/workflows/build.yml | Builds por sistema e publicação de tags |

O build empacota electron/, dist/preload.cjs, dist/updater-preload.cjs, ícones, licença/avisos e dependências
de produção. renderer/ é fonte pública de integração, consumida pelo site; não
contém componentes da plataforma. O preload não requer arquivos JS arbitrários
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

## Limites conhecidos

Atualizações são manuais e usam a instalação nativa do sistema. O site só pode
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
