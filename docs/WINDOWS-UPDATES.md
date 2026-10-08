# Atualização pelo aplicativo no Windows

O Windows x64 recebe uma atualização completa do aplicativo após confirmação na
janela local. O helper instalado espera o processo principal sair, troca os arquivos
e reabre o Cuescord no mesmo caminho. O perfil Electron, cookies e preferências
permanecem fora da instalação. Nenhum instalador, elevação ou serviço permanente
participa desse fluxo. Primeira instalação e migração dos clientes anteriores
continuam usando NSIS. Linux/macOS mantêm seus pacotes nativos.

## Artefato e confiança

`Cuescord-X.Y.Z-win-x64.cua` usa o formato restrito `cuescord-app-v1`:
8 bytes ASCII `CUESAPP1`, comprimento uint32 LE do índice, índice JSON UTF-8
`{version, files:[{path,size,sha512}]}` e os bytes dos arquivos na ordem do índice.
Não há compressão, diretórios explícitos, links, scripts de instalação ou comandos.
O pacote tem no máximo 2 GiB, índice de 2 MiB, 8192 arquivos e caminhos relativos
ASCII de até 240 caracteres. Travessia, ADS, dispositivos reservados do Windows,
aliases de nome, duplicatas sem distinção de caixa e conflitos arquivo/diretório
são recusados. Executável, ASAR e helper de atualização são obrigatórios.

O manifesto Ed25519 existente autentica nome/formato/tamanho/SHA-512 do pacote
no campo `application` do artefato Windows. O cliente verifica a assinatura,
proteção contra downgrade, hash externo e cada arquivo interno. O job de release
faz a mesma validação sobre os bytes produzidos pelos builds da revisão exata.
Uma falha não causa fallback para NSIS. Chaves e hosts de download são os mesmos
do fluxo anterior; a página remota apenas abre a janela local de atualização.

Todos os arquivos extraídos recebem a marca de download da Internet. Ela é
preservada na cópia para instalação; não se desativam SmartScreen, Smart App
Control, antivírus ou políticas administrativas. O manifesto autentica a origem
da atualização e não substitui um certificado de publicador Windows. O sistema
ainda pode bloquear um binário sem certificado/reputação.

As operações de arquivo do atualizador usam `original-fs` dentro do Electron,
inclusive extração, hash, cópia, limpeza e gravação de `Zone.Identifier`.
O `fs` normal do Electron interpreta caminhos `.asar` como diretórios virtuais;
não serve para escrever ou verificar os bytes do pacote. A escolha fica restrita
ao atualizador, sem alterar `process.noAsar` nem o carregamento do aplicativo.
Builds e testes Node usam o `fs` normal, pois não têm essa camada virtual.
Veja a [documentação ASAR do Electron](https://www.electronjs.org/docs/latest/tutorial/asar-archives#treating-an-asar-archive-as-a-normal-file).

As versões Windows 0.4.10 e 0.4.11 têm essa falha no atualizador instalado e
podem mostrar `Invalid package ... app.asar` antes de preparar a troca. Elas
precisam receber 0.4.12 ou posterior pelo instalador direto uma vez. Feche o
Cuescord pela bandeja e execute o instalador no mesmo diretório, preservando o
perfil; não exclua dados locais nem substitua arquivos ou assets publicados.
Uma atualização anunciada que falha não inicia NSIS como fallback automático.

## Troca e recuperação

1. O cliente baixa/verifica/extrai em diretório exclusivo de `userData/updates`.
2. **Atualizar e reiniciar** abre confirmação local com cancelamento como padrão.
3. Após confirmar, o aplicativo copia os arquivos para
   `.cuescord-update-UUID` ao lado da instalação, na mesma unidade. Confere hashes,
   preserva `Uninstall Cuescord.exe` e `uninstallerIcon.ico`, e escreve um plano
   local com caminhos fixados. Instalação sem permissão de escrita é recusada;
   não há elevação automática. Use a instalação por usuário.
4. O helper **da versão instalada** é copiado para um diretório `apply-*` privado.
   Ele recebe apenas caminho/hash SHA-512 do plano e PID. Revalida plano, árvore,
   ausência de reparse points e identidade do executável pai via handle Windows.
   O aplicativo só sai após o helper sinalizar que está preparado.
5. O helper espera o handle do pai por até 90 s, revalida os arquivos e renomeia
   instalação para `.cuescord-backup-UUID`, depois staging para o caminho original.
   Bloqueios de arquivos têm tentativas por até 20 s; nenhum processo alheio é morto.
6. Reabre `Cuescord.exe`. O aplicativo confirma versão/caminho local após a janela
   ficar pronta, mesmo se a página remota precisar da recuperação offline.
   Sem confirmação em 60 s, ou se a nova versão falhar, o helper encerra somente
   o processo que iniciou, restaura/reabre a anterior. A restauração não altera o
   histórico de versões assinadas: a correção pública deve ter uma versão maior.

O helper registra `result.json` em `userData/updates/apply-*` com versão e estado.
Backup, plano e download são mantidos para inspeção; não são apagados automaticamente.
Os backups podem conter arquivos adicionais do usuário. Não faça limpeza cega;
após aceite, identifique os diretórios da transação e preserve dados necessários
antes de remover cópias antigas. Reserve espaço para download, extração, staging
e instalação anterior. Falta de espaço interrompe o preparo sem fechar o cliente.
Uma perda de energia entre os dois renames pode exigir restaurar manualmente o
backup ao caminho original; não se promete transação atômica contra falha do disco.

Os caminhos dos atalhos e da desinstalação permanecem iguais. A versão mostrada
no aplicativo vem do pacote; metadados legados de versão na lista de aplicativos
do Windows podem continuar exibindo a versão da última instalação NSIS.

## Validação

`node scripts/build-updater.mjs` executa testes Rust e compila com lockfile.
`pnpm test` cobre formato, assinatura, corrupção, cancelamento, compatibilidade
e integração Windows com processos/instalações sintéticos em `.cache/updater-tests`.
O runner exige `CUESCORD_REQUIRE_UPDATE_TEST=1` após o build: não aceita pular
espera, substituição, reinício, recuperação e adulteração. O executável fixture
é exclusivamente de teste e não integra o aplicativo/artefatos públicos.
`pnpm test:ui` cobre a confirmação visual e IPC isolado no Electron real.
`tests/application-native.spec.ts` também reproduz extração, marcas de Internet,
verificação e staging de um ASAR real e de `app.asar.unpacked`, com o atualizador
do código-fonte e do ASAR empacotado. Confere os bytes copiados, recusa adulteração
e garante que a leitura virtual normal continua ativa. O runner Windows exige
`CUESCORD_REQUIRE_APPLICATION_TEST=1` depois do build para não pular esse aceite.
Antes da release, complete o aceite entre versões instaladas conforme RELEASING.md.
