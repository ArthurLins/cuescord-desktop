# Integração com uma página web

Este diretório documenta apenas o contrato do cliente. O código da plataforma,
autenticação e sinalização/WebRTC permanecem no projeto consumidor.

O preload publica `window.__CUESCORD_DESKTOP__` com version, platform, engine
screenAudio e screenShare. O adaptador `renderer/screen-audio.ts` não importa Electron,
React ou módulos de servidor; pode ser incluído no bundle da página.

1. Importe desktopEnvironment e attachDesktopScreenAudio desse arquivo.
2. Sirva renderer/desktop-screen-audio-worklet.js em
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

## Uso como submódulo

No projeto consumidor, inicialize a revisão fixada:

```bash
git submodule update --init --recursive
pnpm --dir apps/desktop install --frozen-lockfile
pnpm --dir apps/desktop desktop:dev
```

O consumidor pode importar renderer/screen-audio.ts diretamente e copiar o
worklet no seu preparo de assets. Docker/CI devem incluir renderer/ no contexto
e fazer checkout dos submódulos antes do build. Nunca use automaticamente main
durante o build: o gitlink registra o commit revisado.

Para atualizar conscientemente:

```bash
git -C apps/desktop fetch origin
git -C apps/desktop checkout v0.3.0
git add apps/desktop
git commit -m "Update desktop client submodule"
```

O cliente tem pnpm-workspace.yaml e lockfile próprios para funcionar tanto como
clone independente quanto dentro de outro workspace.
