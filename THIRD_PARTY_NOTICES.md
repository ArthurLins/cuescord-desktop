# Componentes de terceiros

A licença MIT do cliente não substitui as licenças das dependências.
Consulte package.json e pnpm-lock.yaml para versões e integridades exatas.

| Componente | Papel | Licença / fonte |
| --- | --- | --- |
| Electron | Runtime Chromium + Node | MIT e avisos dos componentes: https://github.com/electron/electron |
| Koffi | Ponte FFI para resolver processos e ler o botão de push to talk no Windows | MIT: https://github.com/Koromix/koffi |
| loopback-capture | Captura WASAPI Process Loopback | MIT: https://github.com/WerdoxDev/loopback-capture |
| electron-builder | Empacotamento, usado no build | MIT: https://github.com/electron-userland/electron-builder |
| Playwright | Ferramentas das suites existentes | Apache-2.0: https://github.com/microsoft/playwright |
| pnpm | Gerenciador de dependências | MIT: https://github.com/pnpm/pnpm |

O motor nativo inclui libwebrtc m140, libmediasoupclient (ISC),
libsdptransform e nlohmann/json (MIT), além das dependências Rust de Cargo.lock.
`native/voice/THIRD_PARTY_NOTICES.txt` e o NOTICE completo do pacote WebRTC são
distribuídos com o helper em `resources/native-voice`. Fontes, revisão upstream,
origem do binário WebRTC de terceiro e hashes constam em `docs/NATIVE-VOICE.md`
e no script de build. A licença MIT do Cuescord não substitui esses avisos.

O atualizador Windows também usa Serde/serde_json, RustCrypto SHA-2 e suas
dependências, com versões/integridades em `native/updater/Cargo.lock`.
O build reúne as licenças upstream completas em `resources/updater/UPDATER_NOTICES.txt`.

Dependências transitivas têm seus próprios autores e licenças. Após instalar,
`pnpm licenses list --prod` lista as dependências de produção presentes nessa
plataforma. Esse comando não inclui todos os componentes internos do Chromium;
o runtime Electron distribui LICENSE/LICENCE e LICENSES.chromium.html nos seus
recursos (a localização depende do sistema).

Módulos nativos vêm das distribuições upstream, incluindo binários N-API.
O cliente usa utilitários do sistema Linux (PulseAudio e X11); o pacote .deb
declara dependências e não incorpora o código desses utilitários.

Os ícones do cliente ficam em assets/icons, com a fonte SVG disponível. A licença
do código não concede exclusividade ou endosso sobre o nome/marca Cuescord.
