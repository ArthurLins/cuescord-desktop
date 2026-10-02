# Changelog

## 0.4.2

- Fechar a janela mantém o aplicativo na bandeja, preservando chamadas e mensagens; o menu da bandeja permite reabrir ou encerrar o cliente.
- Contador de mensagens não lidas no ícone da barra de tarefas do Windows, com indicador `99+` acima de 99 mensagens.
- Ícones de chamada na janela e na bandeja mostram o estado do microfone e voltam ao ícone normal ao desconectar.
- Ponte limitada para o serviço web enviar contagem e estado de chamada, com validação de origem, frame e argumentos; recargas e falhas do renderer limpam estados antigos.
- Testes dos indicadores, isolamento da ponte e ciclo da bandeja no Electron real.

## 0.4.1

- Tela local de recuperação quando o servidor fica indisponível, com retorno automático à última página após a conexão se estabilizar.
- Controles de janela disponíveis durante a recuperação, mantendo o isolamento da página local e sem acesso à captura de áudio ou tela.
- Testes da recuperação no Electron real e documentação do fluxo de publicação e da fronteira de segurança.

## 0.4.0

- Atualização pelo botão da barra Windows ou pelo menu Ajuda, em janela local isolada.
- Releases autenticadas por Ed25519, downloads verificados com SHA-512 e proteção contra downgrade/replay de versões já conhecidas.
- Download com progresso, cancelamento e confirmação nativa antes de abrir o instalador.
- Chave privada local protegida com DPAPI; assinatura das releases independente de certificados Windows/macOS.
- Pipeline publica manifesto assinado junto dos três instaladores e recusa sobrescrever releases.

## 0.3.1

- Suspende animações e vídeos silenciosos quando a janela fica em segundo plano.
- Restaura somente as mídias e animações que estavam em execução, preservando áudio e chamadas.
- Controla imagens animadas por IPC limitado ao conteúdo confiável do aplicativo.
- Amplia os testes da barra de título e do comportamento em segundo plano.

## 0.3.0

- Primeira distribuição do cliente em repositório público independente, licença MIT.
- Fontes Electron, preload, captura nativa e adaptador de áudio do renderer.
- Lockfile e ferramentas próprios, sem dependência de acesso à plataforma.
- Builds Windows x64, Debian amd64 e macOS Apple Silicon arm64 via GitHub Actions.
- Documentação de permissões, rede, processos, integração e distribuição.
- Mantém o modal Janelas/Telas e a correção de altura da versão 0.2.3.
