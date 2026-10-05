# Voz nativa experimental

**Voz nativa (experimental)** fica nas configurações de voz e começa desabilitada.
Esta implementação atende Windows x64. Outros sistemas e desktops sem os binários
usam voz web. A escolha é persistida no perfil desktop e só muda fora da chamada.

O processo Rust `cuescord-voice.exe` carrega a DLL adjacente de libwebrtc e
libmediasoupclient. Ele controla WASAPI, filtros, Opus, ICE/DTLS/SRTP e reprodução.
PCM não atravessa Electron nem AudioWorklet. Câmera e compartilhamento, inclusive
seu áudio, continuam no renderer. O código Cuescord usa MIT; as bibliotecas mantêm
suas licenças. O backend C++ adapta APIs C++; não reimplementa WebRTC em Rust.

## Organização e contrato

- `native/voice/src/protocol.rs`: comandos tipados, versão e limites.
- `native/voice/src/backend.rs`: FFI e propriedade/destruição da DLL.
- `native/voice/src/main.rs`: pipes limitados e liberação ao perder o pai.
- `native/voice/cpp/engine.cpp`: threads, mídia, sinalização e ciclo de vida.
- `native/voice/cpp/audio_devices.hpp`: seleção e recuperação de dispositivos.
- `native/voice/cpp/audio_gate.hpp`: mute, PTT, VAD, ganho e medição na captura.
- `electron/voice/`: autorização, preferência e ciclo do processo.
- `renderer/native-voice.ts`: contrato público, sessão e cancelamento.

O contrato público mantém nomes/unidades da web: mute/deafen/PTT, modo de entrada,
atividade automática/manual, limiar 0–100 e volumes 0–200. IDs WASAPI e IDs web
são persistidos separadamente. Deafen fecha o microfone e silencia somente voz.
Volume global e volume por participante são aplicados no nativo.

O renderer mantém autenticação e os comandos existentes Socket.IO. Antes de abrir
o motor, o bootstrap precisa anunciar `voiceTransportProtocol: 1`. Servidores
anteriores usam voz web com aviso. `create-transport` acrescenta `purpose: "voice"`
a um único par adicional por participante; `consume` recebe seu `transportId`.
Identidade, autorização, idempotência, unicidade do microfone, consumer inicialmente
pausado, eventos de mute e limpeza permanecem compartilhados com a web. O par de
voz recusa vídeo e áudio compartilhado.

`patch-mediasoup.cmake` adapta a revisão fixada: descoberta de capacidades só de
áudio e objetos RTCIceServer completos, incluindo URLs múltiplas e credenciais TURN.
O build verifica o contexto do patch. A renovação mantém o contrato ICE da web.

Os filtros diferem: o nativo usa AEC, AGC e supressão do WebRTC, e WebRTC VAD no
modo automático. RNNoise e o compressor de reprodução permanecem específicos da
voz web. Esses controles não são oferecidos durante voz nativa.

## Resiliência

Uma sessão com ID aleatório pertence ao frame principal da origem confiável.
Subframes e outras origens são recusados. A página não fornece executáveis,
caminhos, plugins, comandos de sistema ou cookies ao motor. Dependências são
baixadas somente durante o build; não há gravação ou telemetria do helper.

Mensagens limitadas a 1 MiB; até 64 operações pendentes, 64 comandos, 32 pedidos de
sinalização e 256 eventos. Medição é descartável sob carga; excesso de sinalização
encerra a sessão. Inicialização/operação/conexão têm prazos de 10–12 segundos.
Mute/PTT usam controles atômicos. Processamento de cada bloco não faz I/O,
alocação de memória ou espera por sinalização.

Saída, navegação completa, falha do renderer, timeout e fechamento encerram o helper.
EOF também libera recursos. Falha reconecta a sala com voz web, preservando
mute/deafen, após liberar a sessão anterior. A mesma chamada não repete tentativas
nativas; nova entrada manual permite testar novamente. Conexão tem prazo; ICE
conectado/completo cancela o prazo e desconexão persistente reconecta a sala.

WASAPI reinicia após notificações de dispositivo. O processo pede execução sem
EcoQoS e respeito aos timers, sem alterar prioridade global, firewall ou políticas
de energia. O resultado entra no diagnóstico. Dois períodos de cinco segundos com
captura abaixo de 70% do relógio esperado sinalizam falha e acionam recuperação.

Estatísticas usam milissegundos como RTCStatsReport web e entram nos filtros de
diagnóstico existentes, com referências
prefixadas para não colidir com vídeo. O ZIP registra motor, blocos e proteção de
energia; não exporta SDP, credenciais ou áudio.

## Build e aceite

Node conforme `.nvmrc`, Rust 1.94.0, Visual Studio C++ Build Tools e CMake.
`pnpm native:build` verifica hashes, compila e testa C++/Rust.
Rust/C++ ligam estaticamente o runtime C, sem exigir instalação separada do
Visual C++ Redistributable. O build seleciona explicitamente Rust 1.94.0.
`pnpm desktop:build:win` exige o motor e inclui seus avisos no instalador.
`pnpm desktop:check` e `pnpm test` verificam a ponte e sua revogação. Em desenvolvimento,
sem compilar os binários, a voz web continua disponível.

WebRTC m140.7339 vem de `crow-misia/libwebrtc-bin` 140.7339.2.0, um pacote de
mantenedor terceiro, não um binário oficial Google. Libmediasoupclient usa
`b9602ba50477d9a22b673fc3e6b5abff16c02deb`; libsdptransform usa 1.2.10. URLs/hashes
ficam no build e Rust usa Cargo.lock. Atualizações exigem validar ABI, patch,
licenças e chamada real. Cache `.cache` é ignorado pelo Git.

Aceite antes de habilitar amplamente: dois desktops, mute/PTT, volumes, câmera/tela
simultâneos, troca e desconexão de dispositivo, perda de rede, morte do helper,
suspensão e jogo carregando com app minimizado por pelo menos 30 minutos. Conferir
aproximadamente 100 blocos por segundo e ausência de voz acelerada. O teste local
não substitui esse aceite nos equipamentos onde o problema original ocorre.
