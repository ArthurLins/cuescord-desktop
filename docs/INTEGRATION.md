# Integração com uma página web

Este diretório documenta apenas o contrato do cliente. O código da plataforma,
autenticação e sinalização/WebRTC permanecem no projeto consumidor.

O web é a aplicação base e é dono de seus adaptadores, sessão, recuperação e
worklets. Ele não importa arquivos deste repositório. O preload implementa as
capacidades opcionais em `window.__CUESCORD_DESKTOP__`: version, platform, engine,
screenAudio, screenShare, presence, nativeVoice e pushToTalk.

1. A aplicação base consulta essas capacidades por seus próprios contratos.
2. Sirva o worklet de áudio que pertence ao web em
   /audio/desktop-screen-audio-worklet.js na mesma origem da página.
3. A partir de uma ação do usuário, obtenha um MediaStream via getDisplayMedia,
   solicitando áudio quando a integração de áudio for desejada.
4. Após getDisplayMedia, chame screenShare.takeQuality() uma vez para receber a
   qualidade autorizada no seletor (width, height, frameRate, maxBitrate). Aplique
   resolução/FPS à track com applyConstraints e maxBitrate ao encoder WebRTC.
   O getter consome a seleção e retorna undefined em clientes antigos ou sem seleção.
5. Chame attachDesktopScreenAudio(stream, signal) antes de publicar as tracks.
6. Aborte o AbortController e pare todas as tracks ao encerrar/abandonar a chamada.

O adaptador acrescenta a track de áudio autorizada ao stream. Se não existir ponte,
não houver concessão ou ela não tiver áudio, o vídeo continua sem áudio nativo.
O worklet não é conectado aos alto-falantes locais.

## Contador e estado de chamada

O adaptador de presença da aplicação web chama a capacidade opcional
`presence.update` fornecida pelo host.
A página deve chamá-lo após o carregamento e sempre que a contagem ou a chamada
mudar, inclusive com a janela oculta:

```ts
await updateDesktopPresence({
  unreadCount: 4,
  inCall: true,
  microphoneMuted: false,
});
```

`unreadCount` é um inteiro não negativo: some canais e DMs sem acrescentar os
totais agregados dos servidores. `microphoneMuted` deve incluir o estado de
ensurdecimento que desativa o microfone. Ao desconectar ou encerrar a sessão,
envie `inCall: false`; ao sair da conta, zere também a contagem.
No navegador e em clientes antigos sem essa ponte, a chamada não faz nada.

A ponte só atualiza indicadores: não concede acesso a dispositivos ou comandos
de encerramento. O processo principal valida o estado, a origem e o frame.
Recargas e falhas do renderer limpam o estado anterior; a página atualizada
deve reenviar seu estado. Fechar a janela a oculta na bandeja e mantém o renderer;
o menu **Fechar Cuescord** encerra o aplicativo.

## Uso como submódulo

No projeto consumidor, inicialize a revisão fixada:

```bash
git submodule update --init --recursive
pnpm --dir apps/desktop install --frozen-lockfile
pnpm --dir apps/desktop desktop:dev
```

O build web/CI/Docker usa somente seus próprios fontes e não exige checkout do
submódulo. O desktop abre a aplicação base remota e fornece a ponte, sem publicar
implementações de navegador para serem importadas pelo web.

Para executar as jornadas da base neste host, use `pnpm test:web` com os caminhos
dos specs. O runner fornece o executável e entrypoints Electron por ambiente. Em
um clone independente, defina `CUESCORD_WEB_ROOT` para a raiz do projeto web.

Para atualizar conscientemente:

```bash
git -C apps/desktop fetch origin
git -C apps/desktop checkout v0.3.0
git add apps/desktop
git commit -m "Update desktop client submodule"
```

O cliente tem pnpm-workspace.yaml e lockfile próprios para funcionar tanto como
clone independente quanto dentro de outro workspace.
