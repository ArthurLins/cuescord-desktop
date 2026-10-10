# Push to talk

O desktop Windows acompanha a tecla ou botão escolhido mesmo quando outra
janela está em foco, o Cuescord está minimizado ou foi ocultado para a bandeja.
Nas configurações de voz, escolha **Push to talk**, clique em **Alterar atalho**
e pressione uma tecla ou botão do mouse. Escape cancela a gravação.

São aceitos os botões esquerdo, direito, central e os dois laterais do mouse,
além de letras, números, modificadores separados por lado, teclas de função e
teclas usuais de navegação. A preferência mantém os códigos físicos de teclado
existentes, como `KeyV`; mouse usa `Mouse0` a `Mouse4`, na ordem DOM.
O clique que inicia a gravação não vira o atalho. A transmissão fica suspensa
durante a gravação.

## Implementação

- `electron/input/windows-input.cjs` usa Koffi, já presente no cliente, para ler
  `GetAsyncKeyState` a cada 8 ms somente durante uma chamada com push to talk.
  Consulta apenas o botão escolhido, usa exclusivamente o bit de estado atual
  e não intercepta nem bloqueia o comando recebido pelo jogo.
- Letras, números e pontuação são traduzidos do scan code físico para a tecla
  virtual usando o layout da janela em foco. Botões esquerdo/direito respeitam
  a inversão configurada no Windows. Enter e Enter numérico compartilham a
  tecla virtual do Windows; números do teclado numérico usam Num Lock ligado.
- O processo principal envia as transições tanto ao renderer quanto diretamente
  ao helper de áudio nativo. O estado global prevalece sobre qualquer `ptt`
  atrasado vindo do renderer. Mute, deafen, volume zero e o modo de entrada
  continuam sendo respeitados pelo motor de áudio.
  Se o helper não aceitar a liberação, inclusive por uma fila de comandos
  saturada, o processo é encerrado para não deixar a captura aberta.
- Cada configuração tem um identificador e eventos com sequência crescente.
  Respostas atrasadas, eventos de configurações anteriores e a liberação de uma
  chamada antiga não alteram a chamada atual.
- Soltar o botão fecha o microfone. Trocar atalho, sair, recarregar, perder o
  renderer, bloquear ou suspender o Windows também libera o estado. A entrada
  só volta após liberar o botão e pressioná-lo novamente. Bloqueio e suspensão
  são acompanhados separadamente.
- Somente o frame principal da janela na origem autorizada pode configurar e
  acompanhar o comando. O renderer não recebe FFI, Node, captura genérica de
  teclado nem acesso arbitrário ao sistema.
- Navegadores, clientes antigos e outras plataformas continuam usando eventos
  de teclado/mouse da janela, com liberação ao perder foco. A ajuda nas
  configurações indica se o atalho global está disponível.

O atalho global exige os códigos web e desktop atualizados. Alterações locais
e testes não atualizam o aplicativo instalado nem publicam a plataforma.

## Verificação

`tests/push-to-talk.test.mjs` cobre foco, botões, troca de atalho, gravação,
bloqueio/suspensão, encerramento, eventos e respostas atrasados, isolamento,
layout e inversão do mouse. Também carrega a API real do Windows.
`tests/native-voice.test.mjs` verifica que uma liberação chega ao áudio sem
depender do renderer e que uma atualização atrasada não reabre o microfone.

`tests/push-to-talk-native.spec.ts` carrega o preload em Electron real e verifica
os cinco botões e teclado com a janela minimizada e oculta, além da revogação
ao recarregar. Os estados de pressionamento são controlados pelo teste para
evitar injetar teclas ou cliques no computador; a biblioteca Windows é carregada
e consultada de verdade. `apps/web/e2e/push-to-talk.spec.ts`, na plataforma,
exercita a configuração pelo mouse, cancelamento e transmissão global/local.

O aceite final ainda requer uma chamada com teclado/mouse físico durante um
jogo. A API do Windows pode negar a leitura em desktops protegidos ou por
isolamento de privilégios. Nesse caso o estado permanece fechado; não se
alteram proteções do Windows ou do jogo para contornar a restrição.

## Referências

- [Microsoft: GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate):
  estado atual, botões físicos, inversão e restrições de leitura.
- [Microsoft: MapVirtualKeyExW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-mapvirtualkeyexw):
  tradução de scan codes para teclas virtuais por layout.
- [Electron: globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut):
  ativação de atalhos globais; o push to talk precisa acompanhar também a
  liberação do botão, por isso usa leitura do estado atual.
