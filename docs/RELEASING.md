# Builds, releases e assinatura

## Leitura obrigatória para agentes

Agentes devem ler este documento inteiro, [SECURITY.md](../SECURITY.md) e o
[workflow](../.github/workflows/build.yml) **a cada pedido** de deploy, release,
atualização ou rollback, conforme [AGENTS.md](../AGENTS.md). Dentro da plataforma
Cuescord, leia primeiro o guia geral `../../DEPLOY.md` a partir da raiz do desktop;
no clone independente, este documento é o procedimento de deployment do cliente.

Antes de publicar, confirme pedido/alvo, remoto, branch, status/diff, versão instalada
e última release estável. Preserve trabalho local e segredos; publique somente o
commit final revisado. A versão deve ser estável, maior que a anterior e igual à tag.
Não envie a plataforma privada ao repositório público. Documentação ou build local
não são autorização de release. Um pedido explícito de release autoriza suas etapas
no destino solicitado, sem confirmações repetidas; peça apenas informação necessária
ausente ou autorização para ação destrutiva/fora do escopo.

Falha em check, build, assinatura ou provenance impede publicar. Não contorne checks,
troque a chave pública ou remova proteções do sistema para fazer a release passar.
Não declare sucesso após apenas enviar a tag: acompanhe o run exato, os três builds,
o job de release e os assets públicos. Verifique assinatura/tamanho/hash com a chave
pública embutida e faça aceite de instalação/atualização em perfil/VM isolados.
Relate commit, versão/tag, run/release, checks, aceite e limitações sem segredos.

Uma release pública não pode ter tags/assets substituídos. Para reverter regressão,
publique versão maior com a correção ou código revertido; o atualizador recusa
downgrade. Um draft incompleto exige inspeção antes de qualquer remoção/reexecução.
Se o aceite externo não for possível, registre exatamente a etapa pendente; build
local, release publicada e atualização validada são resultados distintos.

## Pipeline

O workflow build.yml compila pull requests, pushes em main, tags v\* e execução
manual. A matriz usa Windows x64, Ubuntu x64 e macOS 15 arm64.
macOS é explicitamente arm64; não há alvo Intel/universal.

Cada job instala pnpm 10.32.1 e Node da .nvmrc, instala com frozen-lockfile,
gera/verifica a sintaxe do preload e empacota. Não precisa acessar o repositório
da plataforma nem o serviço de produção. As ações são fixadas por commit.

O build macOS mantém Hardened Runtime e assina o aplicativo e seus helpers com
`assets/entitlements.mac.plist`, incluindo `com.apple.security.device.audio-input`
e `com.apple.security.device.camera`. As descrições de uso permanecem no Info.plist.
Após empacotar, `node scripts/check-mac-media.mjs` inspeciona as permissões da
assinatura real e as descrições; ausência de uma delas impede publicar os artefatos.
Conceder acesso no Electron não substitui essas permissões na assinatura.
No aceite macOS, teste a primeira solicitação de microfone em perfil de teste,
uma chamada sem câmera autorizada e o retorno após conceder acesso em
**Ajustes do Sistema > Privacidade e Segurança > Microfone** e reiniciar o app.

Após o build nativo, `scripts/artifacts.mjs` gera um ZIP por sistema contendo
exatamente o instalador na raiz:

| Plataforma  | ZIP                              | Conteúdo                         |
| ----------- | -------------------------------- | -------------------------------- |
| Windows x64 | `Cuescord-X.Y.Z-win-x64.zip`     | `Cuescord-X.Y.Z-win-x64.exe`     |
| Linux amd64 | `Cuescord-X.Y.Z-linux-amd64.zip` | `Cuescord-X.Y.Z-linux-amd64.deb` |
| macOS arm64 | `Cuescord-X.Y.Z-mac-arm64.zip`   | `Cuescord-X.Y.Z-mac-arm64.dmg`   |

ZIPs usam o perfil determinístico `zip-store-v1`, sem compressão adicional porque
os instaladores já são comprimidos. Não substitua esse empacotador por um ZIP
genérico: o atualizador valida a estrutura exata, com uma entrada regular, sem
caminhos, links, extras ou comentários. O build-info e sha256sums registram ZIP
e instalador; o job de assinatura verifica também o conteúdo interno antes de
assinar e continua exigindo os três builds da mesma revisão.

### Compatibilidade com clientes já instalados

A partir de 0.4.3, o cliente prefere o ZIP autenticado e extrai o instalador
automaticamente. Mantemos schema 1, contexto Ed25519 e os três artefatos de
instalador do manifesto; cada artefato recebe o campo assinado `archive` com
formato, nome, tamanho e SHA-512 do ZIP. Clientes 0.4.0–0.4.2 ignoram esse campo
e baixam o instalador direto, cuja assinatura e hash continuam válidos.

**Continue publicando os instaladores diretos junto dos ZIPs em cada release.**
Os clientes antigos consultam apenas a última release; removê-los após uma
única versão de transição impediria atualizar quem pulou essa versão. Uma
distribuição exclusivamente em ZIP requer outra estratégia de migração para
esses clientes. A suíte valida o novo manifesto contra a política congelada de
0.4.2. Clientes novos ainda aceitam manifestos anteriores sem ZIP, respeitando
a versão instalada e o histórico contra downgrade; falha num ZIP anunciado
nunca causa fallback silencioso para o binário direto.

## Publicar

Antes da primeira release com atualizador, configure **UPDATE_SIGNING_PRIVATE_KEY**
no repositório ArthurLins/cuescord-desktop. A chave pública correspondente está em
electron/update/trusted-keys.json. A chave privada inicial foi gerada localmente
em .update-signing/private-key.dpapi: é ignorada pelo Git, protegida pela conta
Windows que a criou e nunca é incluída no pacote.

Na mesma conta Windows, com GitHub CLI autenticado e permissão para secrets, execute:

```powershell
node scripts/update-key.mjs upload
```

O comando descriptografa apenas em memória e envia o secret pelo stdin para
`gh secret set UPDATE_SIGNING_PRIVATE_KEY`. Não imprime a chave nem grava uma cópia
em texto puro. O secret contém a chave privada Ed25519 em PKCS8 DER/base64.
Não execute generate novamente: o script recusa substituir uma chave já fixada.
Em uma instalação inicial sem chave pública, `node scripts/update-key.mjs generate`
gera o par e salva a parte pública no cliente. Não troque a chave pública por uma
gerada em outro computador para tentar recuperar a chave privada.

Proteja o backup da conta Windows e o arquivo DPAPI. Esse arquivo não pode ser
descriptografado por outra conta/computador sem a recuperação da proteção DPAPI.
GitHub não permite ler o valor de um secret já enviado. Perder a chave privada
impede assinar atualizações aceitas pelos clientes existentes. Rotação exige um
plano de distribuição de novas chaves e assinaturas de transição; não remova a
chave fixada dos clientes/release para uma troca improvisada.

1. Atualize version em package.json e CHANGELOG.md.
2. Envie o commit revisado para main.
3. Crie uma tag correspondente à versão:
   `git tag -a v0.4.3 -m "Cuescord Desktop 0.4.3"` (use a versão preparada).
4. Publique: `git push origin v0.4.3`.

A tag precisa corresponder exatamente a package.json. Depois dos três builds,
um job separado com contents:write assina update-manifest.json e publica a release.
Ausência do secret, chave incompatível, hashes ou provenance incorretos interrompem
a publicação. Builds e PRs usam apenas
contents:read e não publicam. Não é utilizado pull_request_target.
Artifacts de Actions ficam disponíveis por 14 dias; releases preservam downloads.

A publicação começa em draft, inclui todos os assets e só então torna a release
pública. O workflow recusa qualquer release existente e não usa --clobber. Se um
run interrompido deixar um draft, confira os assets antes de remover o draft e
reexecutar. Releases públicas devem receber uma versão nova, sem trocar assets.

Clientes até 0.3.1 não têm atualizador: instale 0.4.0 manualmente uma vez. Depois,
o botão verifica a release estável mais recente do repositório fixado. Uma versão
mais nova só é oferecida após validar a assinatura do manifesto. Windows abre
o NSIS verificado extraído do ZIP e fecha o cliente após confirmação; Linux/macOS abrem .deb/.dmg
e exigem concluir a instalação pelo sistema. Não são usados sudo, instaladores
silenciosos ou desvios das proteções do sistema. O atualizador fica desativado
quando o cliente roda a partir do código.

Antes de publicar, execute `pnpm desktop:check`, `pnpm format:check`, `pnpm test`
e `pnpm test:ui` (este último exige Chromium/ambiente gráfico). Os testes cobrem
assinatura, adulteração, download parcial/cancelado, redirects, downgrade/replay,
verificação no disco e IPC de outros renderers, inclusive no Electron real.
Valide a instalação usando duas versões em uma VM Windows; a suíte não altera
o cliente instalado no computador do desenvolvedor.

Os arquivos build-info incluem commit, plataforma, arquitetura, versões,
link do run e SHA-256 do instalador e do ZIP. Confira sha256sums com sha256sum -c no Linux,
shasum -a 256 no Mac ou Get-FileHash -Algorithm SHA256 no PowerShell.
Hashes detectam mudanças nos arquivos, mas não substituem assinatura de publicador.
As licenças upstream e o lockfile ajudam a inspecionar os binários de terceiros;
os builds não são certificados como reproduzíveis byte a byte.

No aceite, confira os três ZIPs e os três instaladores diretos, valide a assinatura
Ed25519 e os hashes/tamanhos de ambos. Extraia manualmente um ZIP pelo sistema
para conferir interoperabilidade. Teste atualização de 0.4.2 para a release nova
pelo instalador direto e, entre duas versões com suporte a ZIP, download,
extração, cancelamento, confirmação e abertura pelo aplicativo. Teste também
um cliente antigo pulando a primeira release com ZIP. Use máquina/VM e perfil
isolados; não modifique a instalação real do desenvolvedor para esse aceite.

## Certificados opcionais

Os certificados de publicador são opcionais; a chave de atualização Ed25519 é
obrigatória para publicar releases. Sem certificado Windows, o instalador não tem
assinatura de publicador; macOS usa assinatura ad-hoc, sem Developer ID e sem
notarização. Isso pode impedir instalação/abertura padrão via SmartScreen ou
Gatekeeper. Não há certificado de distribuição incluído no Git.

Configure os secrets do repositório para assinar **releases de tags**:

| Secret                      | Uso                                                 |
| --------------------------- | --------------------------------------------------- |
| WIN_CSC_LINK                | Certificado Windows .p12/.pfx em base64             |
| WIN_CSC_KEY_PASSWORD        | Senha do certificado Windows                        |
| MAC_CSC_LINK                | Certificado Developer ID Application .p12 em base64 |
| MAC_CSC_KEY_PASSWORD        | Senha do certificado macOS                          |
| APPLE_ID                    | Conta Apple usada na notarização                    |
| APPLE_APP_SPECIFIC_PASSWORD | Senha de app para notarização                       |
| APPLE_TEAM_ID               | Equipe Apple                                        |

No macOS, preencha o certificado e as três credenciais de notarização juntos.
A configuração ativa notarização somente quando as três variáveis existem.
PRs e builds de branches não recebem certificados. Falhas de assinatura/notarização
devem ser resolvidas antes de distribuir uma release como assinada.
Assinar o manifesto permite ao cliente autenticar o download sem certificado
Windows, mas não remove os alertas/bloqueios de publicador desconhecido do sistema.
Distribuir em ZIP também não garante remover o SmartScreen/Gatekeeper. O cliente
marca tanto o ZIP quanto o instalador extraído como download da Internet no Windows
ou com quarentena no macOS; não remova essas marcas para evitar avisos.

Referências: [runners GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
e [código do electron-builder](https://github.com/electron-userland/electron-builder).
