# CoreAudioBase do WebRTC

`core_audio_base_win.cc` é uma cópia integral, sem modificações, do WebRTC
`36ea4535a500ac137dbf1f577ce40dc1aaa774ef` (m140.7339, posição 2), correspondente
ao SDK 140.7339.2.0 usado pelo build. Mantém o aviso BSD upstream; `LICENSE` e
`PATENTS` são copiados da mesma revisão. A distribuição inclui `WEBRTC_NOTICES.txt`.

Fonte: https://webrtc.googlesource.com/src/+/36ea4535a500ac137dbf1f577ce40dc1aaa774ef/modules/audio_device/win/core_audio_base_win.cc

SHA-256 do arquivo com finais de linha LF:
`55714d27b8f96f13d880ed7f99e676a90a5447289edccf6ac583a7936c8c8885`.

`windows-audio.cmake` valida fonte e cabeçalho do SDK, gera uma cópia que troca
apenas a configuração de categoria por `cuescord::ConfigureCallAudio` e compila
esse objeto antes do arquivo estático WebRTC. O linker usa esta implementação
completa de `CoreAudioBase`, sem extrair o objeto original do arquivo estático.
O objeto usa `NDEBUG`, como o SDK release: essa definição afeta o layout de
`SequenceChecker` e precisa coincidir com o código pré-compilado.
Não se deve usar `/FORCE:MULTIPLE` nem ignorar erro de ABI/linkedição.

A categoria `Other` evita que os fluxos de captura/reprodução do Cuescord
acionem a política de redução de volume de comunicações do Windows. A escolha
do dispositivo de comunicação continua respeitada. A política é aplicada antes
da inicialização em modo compartilhado, inclusive nas reinicializações por
troca/remoção de dispositivo; não escreve volume, registro ou preferências globais.

Ao atualizar o SDK, revisar fonte, layout do cabeçalho, hashes, linkedição e o
teste de não atenuação em um computador Windows. Não alterar só o hash para
liberar o build.
