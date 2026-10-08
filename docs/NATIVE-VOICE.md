# Voz nativa no Windows

A voz nativa é selecionada automaticamente no desktop Windows x64, sem opção
experimental ou aviso de troca de motor. Preferências antigas de opt-out deixam
de desabilitá-la; a web também ativa o motor nos desktops antigos que oferecem a
ponte. Web, macOS, Linux e desktops sem os binários usam voz web. As estatísticas
para nerds mostram o motor efetivamente usado na chamada.

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
- `native/voice/cpp/voice_dynamics.hpp`: proteção de picos sem fila de áudio.
- `native/voice/cpp/voice_mixer.hpp`: volume e reforço das vozes recebidas.
- `native/voice/cpp/voice_health.hpp`: medição e recuperação limitada da qualidade.
- `native/voice/cpp/audio_priority.hpp`: registro MMCSS na thread de áudio.
- `electron/voice/`: autorização, consulta de dispositivos e ciclo do processo.
- `renderer/native-voice.ts`: contrato público, sessão e cancelamento.
- `renderer/voice-transport-recovery.ts`: recuperação ICE compartilhada com a web.

O contrato público mantém nomes/unidades da web: mute/deafen/PTT, modo de entrada,
atividade automática/manual, limiar 0–100 e volumes 0–200. IDs WASAPI e IDs web
são persistidos separadamente. Deafen fecha o microfone e silencia somente voz.
Volume geral da chamada e volume por participante são aplicados no nativo. O
reforço de vozes baixas preserva a opção da web: +6 dB, com proteção de picos e recuperação de ganho
em 80 ms. O limitador final do mix conserva 1 dB de margem. As implementações DSP
da web e nativa não produzem amostras idênticas; escolhas e unidades são comuns.

## Volume do computador

Entrar, sair, silenciar ou reconectar a voz nativa não deve modificar o volume
do Windows nem dos demais aplicativos. Ganho de entrada/saída, AGC2 e reforço de
vozes operam nas amostras da chamada; não escrevem volume do endpoint, mixer de
outros processos ou a preferência global de comunicações do Windows.

O ADM2 do WebRTC fixado abre **captura e reprodução** com
`AudioCategory_Communications`, o que pode acionar a redução automática dos
demais sons ao entrar em chamada. `windows-audio.cmake` compila uma substituição
da implementação completa de `CoreAudioBase`, da mesma revisão do SDK, trocando
somente a configuração das propriedades por `audio_session.hpp`. Os dois fluxos
usam `AudioCategory_Other` antes de inicializar o cliente em modo compartilhado.
A política também passa pelas reinicializações manuais e automáticas de áudio.
A seleção do headset/dispositivo de comunicação escolhido pelo usuário continua
independente dessa categoria. AEC e os filtros de voz do Cuescord continuam ativos
conforme as preferências; a categoria pode alterar os efeitos de áudio do driver.

Fonte e cabeçalho de ABI têm hashes validados no build. O objeto substituto usa
o layout release do SDK (`NDEBUG`). A origem, licença e cuidados de atualização
estão em `native/voice/upstream/README.md`. Não é suficiente chamar
`IAudioSessionControl2::SetDuckingPreference` na sessão do Cuescord: essa API
protege a sessão que receberia a redução, não remove a causa nos outros programas.
Não alterar `UserDuckingPreference`, os volumes ou os dispositivos padrão do usuário.

Referências:
[categorias de áudio e políticas de comunicação](https://learn.microsoft.com/en-us/windows/win32/coreaudio/communications-audio-format-capabilities),
[desativação da atenuação na sessão que a recebe](https://learn.microsoft.com/en-us/windows/win32/coreaudio/disabling-the-ducking-experience).

## Transporte e processamento

O renderer mantém autenticação e os comandos existentes Socket.IO. Antes de abrir
o motor, o bootstrap precisa anunciar `voiceTransportProtocol: 1`. Servidores
anteriores usam voz web. `create-transport` acrescenta `purpose: "voice"`
a um único par adicional por participante; `consume` recebe seu `transportId`.
Identidade, autorização, idempotência, unicidade do microfone, consumer inicialmente
pausado, eventos de mute e limpeza permanecem compartilhados com a web. O par de
voz recusa vídeo e áudio compartilhado.

`patch-mediasoup.cmake` adapta a revisão fixada: descoberta de capacidades só de
áudio e objetos RTCIceServer completos, incluindo URLs múltiplas e credenciais TURN.
O build verifica o contexto do patch. A renovação mantém o contrato ICE da web.

O microfone oferece as mesmas escolhas da web: RNNoise, redução padrão do WebRTC
ou supressão desligada. A escolha existente é preservada, inclusive ao ligar ou
desligar o conjunto de melhorias. AEC e AGC continuam independentes. O RNNoise é
aplicado depois de AEC e antes do AGC2, medição, VAD, mute/PTT e ganho de entrada.
AGC2 tem margem de 6 dB, ganho adaptativo máximo de 18 dB e subida limitada a
3 dB/s. Roda em uma etapa APM pública separada, sem aplicar AEC ou supressão de
ruído novamente. O ganho manual de até 200% passa por um limitador de picos que
atenua o bloco inteiro em vez de cortar a forma de onda. Isso protege a saída
digital; saturação que já ocorreu no microfone/driver não pode ser desfeita.
Quando RNNoise está ativo, a supressão do WebRTC fica desligada para não filtrar
duas vezes. Compartilhamento de tela e seu áudio não passam por esse caminho.

O nativo usa a revisão upstream `70f1d256acd4b34a572f999a05c87bf00b67730d` da
linha RNNoise 0.2 e o **modelo completo**, SHA-256
`0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`.
Código e modelo têm downloads e hashes separados em `rnnoise.cmake`; os pesos
são compilados na DLL. Não há download ou arquivo de modelo carregado na chamada.
Não usa o modelo `little`. O pipeline é mono, 48 kHz, blocos de 480 amostras.
CPU/OS selecionam AVX2/FMA, SSE4.1 ou baseline sem exigir AVX2 do equipamento.

A versão web mantém seu RNNoise WASM original. O nativo usa treinamento mais
recente: opções e comportamento são compatíveis, mas não promete saída idêntica
amostra a amostra. DeepFilterNet também suporta voz em 48 kHz; não foi escolhido
como padrão sem comparar qualidade, atraso e carga nos equipamentos afetados.
Melhor qualidade não pode ser estabelecida apenas pela data ou nome do modelo.
Referências: https://github.com/xiph/rnnoise e https://github.com/Rikorose/DeepFilterNet.

VAD automático usa modo 3, reserva de 30 ms para o início da fala e retenção de
200 ms, como o gate original. Manual/PTT não acrescentam essa reserva. Mutar,
desmutar ou trocar o modo limpa a reserva para não transmitir áudio anterior.
O compressor de reprodução continua específico da voz web.

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

Web e nativo usam a mesma recuperação por direção do transporte. Uma desconexão
recebe 4 s de tolerância; estado ICE `failed` começa a recuperação imediatamente.
O renderer renova a configuração ICE/TURN autenticada e pede `restart-ice` para o
transporte da sessão. Tokens de conta e cookies permanecem no renderer. Cada
episódio permite até três tentativas, com 1 s entre rodadas ICE que falharam e
um único prazo total de 30 s. Uma nova tentativa não reinicia esse prazo. Eventos
repetidos também não adiam a recuperação. Sair cancela pedidos, timers e eventos;
uma resposta tardia não pode reabrir a sessão. Uma conexão já estabelecida pode
aguardar esse período ao instalar outro consumer; a conexão inicial mantém 12 s.

Falha do RNNoise, formato incompatível ou dez blocos seguidos acima de 8 ms de
processamento ativam redução WebRTC sem derrubar a chamada. A mudança de APM
ocorre na thread de controle. Status informa `loading`, `rnnoise`, `fallback`,
`native` ou `off`; nunca anuncia RNNoise ativo apenas pela preferência salva.
Trocar o filtro reinicializa o estado sem alocação por bloco. O diagnóstico
inclui revisão/modelo, quantidade de blocos e tempos médio/máximo, sem PCM.

`noiseSuppressionModes` anuncia a capacidade nova no desktop. Uma web nova omite
`noiseSuppressionMode` para desktops anteriores, que rejeitam campos novos, e
mantém a redução WebRTC deles até atualizar. O protocolo público continua v1.

Saída, navegação completa, falha do renderer, timeout de mídia/controle e fechamento
encerram o helper. EOF também libera recursos. Timeout de estatísticas/dispositivos
rejeita somente a consulta; não encerra a voz. Consultas simultâneas de dispositivos
fora da chamada compartilham um helper temporário, e a abertura da chamada aguarda
sua liberação. Durante a sessão, as consultas usam o helper da chamada. A ponte
antiga é serializada pelo renderer para preservar a mesma ordem de propriedade.

Durante a sessão nativa, a ponte desabilita background throttling no WebContents,
para manter sinalização autenticada e timers de recuperação quando minimizado.
Ao encerrar, restaura a configuração anterior. Não altera a prioridade do sistema.

Falha libera a sessão anterior e reconecta com voz nativa, preservando mute/deafen.
Após três falhas seguidas, a recuperação usa voz web como último recurso. Uma
chamada nativa estável por 60 s restaura o orçamento; entradas curtas que voltam
a falhar não criam um ciclo infinito. Nova entrada manual também restaura o
orçamento. O motivo da falha entra no diagnóstico local. Conexão tem prazo; ICE
conectado/completo cancela o prazo. Desconexão persistente tenta recuperar ICE
antes de reconstruir a sessão nativa; o helper anterior é revogado primeiro.

As salas usam Opus mono a 48 kHz, FEC e DTX, com perfis 32/64/96/128/256 kbit/s.
O SDP permite até 256 kbit/s; o limite efetivo do encoder segue a sala e pode
subir/descer durante a chamada, sem abrir outro microfone. O bootstrap anuncia
`audioQualityProtocol: 1`; mudanças consultam `room-audio-quality` autorizado,
com fila que preserva o último valor. Desktops antigos reconectam para aplicar
a nova qualidade. `voiceQualityProtocol: 1` no READY negocia esses controles.

A qualidade da sala é o teto por microfone. Web e nativo habilitam `adaptivePtime`
e prioridade de mídia alta (4), permitindo ao controlador do WebRTC reduzir o
bitrate abaixo desse teto conforme o feedback de rede e aumentá-lo na recuperação.
Não há um segundo controlador concorrente calculando limites por timer. O nativo
aplica e verifica os parâmetros depois de criar o sender: os campos de criação
do transceiver, sozinhos, não asseguram sua aplicação. Mudanças do perfil mantêm
a adaptação. O diagnóstico informa o teto, o bitrate alvo do encoder e os valores
efetivamente aplicados de adaptação/prioridade.

`networkPriority` permanece `low`, o valor padrão; uma prioridade DSCP diferente
desabilita a alocação adaptativa de áudio nesta implementação WebRTC. A prioridade
de mídia vale dentro do transporte, sem reservar banda entre o helper nativo e o
vídeo do renderer. FEC e o jitter buffer ajudam com perda/atraso, sem garantir
qualidade em qualquer rede.

Essa adaptação atende o envio individual. Um participante com pouco download
ainda recebe os fluxos Opus publicados pelos demais: o SFU não cria outra versão
com bitrate menor. Adaptar a recepção requer uma variante de áudio ou mix no
servidor, com novos contratos; reduzir o microfone do ouvinte não resolve isso.

O servidor valida o perfil declarado do microfone antes de produzir. No transporte
dedicado nativo também limita o bitrate recebido, com 16 kbit/s de margem para
overhead. Esse mecanismo orienta o congestion control; o SFU não transcodifica
Opus nem garante um limite exato em cada pacote. O transporte web que carrega
vídeo/tela não recebe um teto global de voz. Eventos de canal chegam aos nós
regionais; a renovação de autorização também envia a qualidade atual para corrigir
um evento perdido, sem chamadas extras ou extensão indevida das permissões.

WASAPI reinicia após notificações de dispositivo. O processo pede execução sem
EcoQoS e respeito aos timers, sem alterar prioridade global, firewall ou políticas
de energia. Captura e reprodução registram MMCSS `Pro Audio` na própria thread,
com revogação nessa thread ao encerrar. Se o SDK já registrou a thread, o retorno
Windows `ERROR_THREAD_ALREADY_IN_TASK` é reconhecido como prioridade herdada;
o Cuescord não revoga um registro que pertence ao SDK. Sucesso, herança e erros
reais Windows entram no diagnóstico.

Após aquecimento de 10 s, três janelas completas de 2 s com captura abaixo de 85%
do relógio esperado ou mais de 5% de blocos atrasados acima de 40 ms reiniciam
somente a captura WASAPI e o processamento, preservando o transporte. Receptores
com fluxo contínuo, mais de 15% de amostras ocultadas ou 5% aceleradas, e perda
de pacotes abaixo de 3%, solicitam um consumer novo ao servidor autenticado.
Ele recebe outro MID/decoder e só é retomado depois da instalação local.
Silêncio, DTX, remetente pausado, ausência/reinício de contadores e janelas atrasadas
não justificam reparos. Perda real de rede é diagnosticada sem reiniciar o decoder.
Há no máximo dois reparos por caminho/sessão, intervalo mínimo de 30 s; falha ou
esgotamento solicita reconstrução da sessão, dentro do orçamento de recuperação
nativa. Filtros e configurações permanecem comuns.

Estatísticas usam milissegundos como RTCStatsReport web e entram nos filtros de
diagnóstico existentes, com referências
prefixadas para não colidir com vídeo. O ZIP registra motor, blocos e proteção de
energia, prioridade MMCSS, gaps da captura, AGC, limitação de picos e reparos;
não exporta SDP, credenciais ou áudio.
Janelas degradadas registram também os deltas de amostras, ocultação, aceleração,
pacotes e perda usados pelo detector, com duração da janela e indicação de rede
degradada. Esses contadores adicionais ficam no histórico local do ZIP, sem IDs.

O indicador de AGC representa o último bloco processado, sem alternar para
inativo enquanto o próximo bloco é calculado. `autoGainFrames` conta blocos
processados com sucesso; `autoGainErrors` registra falhas reais. A leitura
concorrente do diagnóstico é coberta pelo teste do gate.

## Build e aceite

Node conforme `.nvmrc`, Rust 1.94.0, Visual Studio C++ Build Tools e CMake.
Windows Server 2022 usa 7-Zip para extrair o SDK; `tar` recente serve como alternativa
local quando suporta LZMA. Os runners de CI já incluem 7-Zip.
`pnpm native:build` verifica hashes, compila e testa C++/Rust.
`VoiceNoiseTests` verifica modelo, silêncio, redução de ruído estacionário,
saída finita, bypass, reinicialização e formato incompatível. O teste mede o
tempo de processamento; ruído sintético não comprova qualidade de fala real.
`VoiceGateTests` cobre RNNoise + AGC + ganho de 200%, mute/PTT e sobrecarga do filtro.
`VoiceQualityTests` cobre forma de onda, margem, mix/deafen e recuperação com
silêncio, perda de rede, aceleração persistente e contadores reiniciados.
`VoiceAudioSessionTests` verifica categoria sem atenuação em entrada/saída e
reaberturas, propriedades de processamento, propagação de erro e ausência de
operações de dispositivo/volume. É um teste com cliente WASAPI simulado; não
substitui a observação do mixer numa chamada real.
Rust/C++ ligam estaticamente o runtime C, sem exigir instalação separada do
Visual C++ Redistributable. O build seleciona explicitamente Rust 1.94.0.
`pnpm desktop:build:win` exige o motor e inclui seus avisos no instalador.
`pnpm desktop:check` e `pnpm test` verificam a ponte e sua revogação. Em desenvolvimento,
sem compilar os binários, a voz web continua disponível.

Os testes de recuperação cobrem rodadas ICE falhadas, tentativas limitadas,
prazo total, cancelamento e eventos repetidos. O runner usa remoção de tipos do
Node 22 para testar diretamente o código compartilhado, sem outra implementação.

`CUESCORD_NATIVE_BUILD_OUTPUT` permite compilar para uma pasta isolada quando o
desktop de teste estiver usando a DLL em `.cache/native-voice/bin`. Isso evita
encerrar uma chamada para substituir um arquivo carregado. Builds de release
usam a pasta padrão e incluem `RNNOISE_NOTICES.txt` junto aos demais avisos.

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

Para aceitar a correção de volume, manter música/vídeo em outro aplicativo e
observar seu volume e o volume do dispositivo antes/durante/depois de uma chamada
nativa. Cobrir entrada, saída, mute/deafen, troca de dispositivo e reconexão, com
um interlocutor real. Usar a preferência de comunicações já configurada pelo
usuário; não desativar globalmente a redução para fazer o teste passar. Registrar
o motor efetivo e o modelo/driver do headset. Fones Bluetooth podem trocar perfil
ao abrir o microfone, o que exige distinguir alteração de perfil da atenuação.

Validação local em 08/10/2026: backend Windows x64 compilado com a substituição,
quatro suítes C++ e 110 testes do desktop aprovados; geração/sintaxe do preload
aprovadas. A DLL real inicializou WASAPI/factory, enumerou dois endpoints e
encerrou sem abrir captura ou reprodução. Esse smoke test verifica carregamento
e ciclo de vida; o aceite auditivo da chamada real permanece pendente.
