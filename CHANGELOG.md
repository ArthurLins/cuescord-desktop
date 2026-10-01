# Changelog

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
