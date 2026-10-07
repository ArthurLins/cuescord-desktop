# Changelog

## 0.4.10

- Adiciona atualização completa pelo aplicativo no Windows x64, com confirmação, espera pelo fechamento, reinício automático e recuperação da versão anterior em falha de startup.
- Publica pacote Windows autenticado junto dos instaladores/ZIPs legados; preserva perfil, atalhos, desinstalador e marcas de Internet, com testes de troca e recuperação na pipeline.
- Torna a voz nativa automática no Windows x64 e remove a opção experimental da interface compatível, com o motor atual nas estatísticas para nerds.
- Serializa a consulta de dispositivos com a abertura da chamada e impede que timeouts de diagnóstico encerrem a captura.
- Mantém a sinalização ativa na abertura e recuperação do helper, preservando o agendamento de chamadas em segundo plano.
- Tenta reconstruir a sessão nativa antes do fallback web e registra os motivos de falha no diagnóstico local.

## 0.4.9

- Adiciona RNNoise com modelo completo recente na voz nativa, preservando a escolha de filtro e mantendo AEC e AGC independentes, sem filtrar o áudio do compartilhamento.
- Alinha ganho, atividade de voz, reforço de vozes baixas e volumes com as opções da web; limita picos e registra o processamento efetivamente ativo no diagnóstico.
- Aplica os perfis de qualidade da sala durante a chamada e habilita adaptação individual de bitrate abaixo do teto, recuperando a qualidade quando a banda melhora.
- Recupera ICE por transporte antes de recorrer à voz web, com tentativas e prazos limitados, cancelamento seguro e renovação autenticada da configuração de conexão.
- Registra MMCSS nas threads de áudio e recupera captura ou decoder com degradação persistente, preservando filtros e controles; perdas reais de rede não provocam reparos indevidos de decoder.
- Amplia testes de filtros, controle de ganho, recuperação, cancelamento e contratos; voz nativa permanece experimental e desabilitada por padrão no Windows x64.

## 0.4.8

- Adiciona voz nativa experimental no Windows x64, desabilitada por padrão e habilitável nas configurações de voz fora da chamada, com interface web e servidor compatíveis.
- Processa captura WASAPI, filtros WebRTC, Opus e reprodução em um processo nativo separado, sem transportar PCM pela interface; câmera e compartilhamento continuam no caminho atual.
- Preserva os controles de mute, deafen, atividade de voz, push-to-talk e volumes pelo contrato compartilhado; mantém dispositivos nativos e web separados.
- Limita filas, mensagens e prazos; encerra o motor ao sair, navegar ou perder a sessão e permite recuperação com voz padrão em falhas, preservando mute e deafen.
- Protege o processo de voz contra limitação de energia em segundo plano, recupera dispositivos e monitora o ritmo de captura para detectar degradação persistente.
- Inclui os binários e avisos das dependências nativas no instalador Windows, com versões e hashes fixados e testes de protocolo, áudio e isolamento da ponte.

## 0.4.7

- Desativa a limitação do renderer em segundo plano durante chamadas, inclusive com o microfone silenciado, para proteger o ritmo do áudio ao minimizar ou fechar para a bandeja.
- Restaura a limitação ao sair da chamada, recarregar a página ou encerrar o renderer, mantendo a economia de recursos fora das chamadas.
- Acrescenta testes da política de segundo plano e do avanço do relógio de áudio com a janela oculta no Electron real.

## 0.4.6

- Adiciona áudio de aplicativo e de tela no macOS 13+, com escolha explícita, ScreenCaptureKit e exclusão do próprio Cuescord.
- Compila e assina um capturador isolado com PCM estéreo de 48 kHz; testa conversão, preservação de áudio baixo, concessões e encerramento.
- Expõe a escolha de áudio ao adaptador web para informar quando a captura não foi autorizada ou ficou indisponível.

## 0.4.5

- Corrige o bloqueio do seletor de compartilhamento no macOS: pedidos de tela do Electron não exigem permissão de câmera ou microfone; mantém validação da origem, frame e seleção explícita da fonte.
- Corrige o erro "Object has been destroyed" ao encerrar o aplicativo; interrompe a recuperação e cancela verificações de conexão pendentes sem acessar a janela destruída.
- Acrescenta testes do encerramento no Electron real, conectado, em recuperação e durante tentativas de reconexão.

## 0.4.4

- Corrige as permissões assinadas de microfone e câmera no aplicativo e nos helpers macOS, preservando Hardened Runtime.
- Solicita somente os dispositivos necessários no macOS, reutiliza consentimento concedido e respeita acesso negado pelo sistema.
- Verifica permissões no bundle macOS após o build; acrescenta testes da autorização e da captura de microfone no Electron real.

## 0.4.3

- Releases incluem um ZIP por sistema contendo o instalador Windows, Linux ou macOS; clientes atualizados passam a baixar e extrair o ZIP pelo próprio aplicativo.
- Manifesto Ed25519 autentica separadamente o ZIP e o instalador interno, com SHA-512, limites de tamanho, extração restrita e nova verificação antes da instalação.
- Instaladores diretos continuam publicados para que clientes anteriores possam atualizar, inclusive ao pular versões; assinatura, proteção contra downgrade, confirmação nativa e marcas de Internet/quarentena são preservadas.
- ZIP não substitui assinatura de publicador nem garante remover avisos do SmartScreen/Gatekeeper.

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
