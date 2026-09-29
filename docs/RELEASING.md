# Builds, releases e assinatura

O workflow build.yml compila pull requests, pushes em main, tags v* e execução
manual. A matriz usa Windows x64, Ubuntu x64 e macOS 15 arm64.
macOS é explicitamente arm64; não há alvo Intel/universal.

Cada job instala pnpm 10.32.1 e Node da .nvmrc, instala com frozen-lockfile,
gera/verifica a sintaxe do preload e empacota. Não precisa acessar o repositório
da plataforma nem o serviço de produção. As ações são fixadas por commit.

## Publicar

1. Atualize version em package.json e CHANGELOG.md.
2. Envie o commit revisado para main.
3. Crie uma tag correspondente à versão:
   `git tag -a v0.3.0 -m "Cuescord Desktop 0.3.0"`.
4. Publique: `git push origin v0.3.0`.

A tag precisa corresponder exatamente a package.json. Depois dos três builds,
um job separado com contents:write publica a release. Builds e PRs usam apenas
contents:read e não publicam. Não é utilizado pull_request_target.
Artifacts de Actions ficam disponíveis por 14 dias; releases preservam downloads.

Os arquivos build-info incluem commit, plataforma, arquitetura, versões,
link do run e SHA-256 do instalador. Confira sha256sums com sha256sum -c no Linux,
shasum -a 256 no Mac ou Get-FileHash -Algorithm SHA256 no PowerShell.
Hashes detectam mudanças nos arquivos, mas não substituem assinatura de publicador.
As licenças upstream e o lockfile ajudam a inspecionar os binários de terceiros;
os builds não são certificados como reproduzíveis byte a byte.

## Certificados opcionais

O pipeline funciona sem segredos de assinatura. Nesse caso, Windows não tem
assinatura de publicador; macOS usa assinatura ad-hoc, sem Developer ID e sem
notarização. Isso pode impedir instalação/abertura padrão via SmartScreen ou
Gatekeeper. Não há certificado de distribuição incluído no Git.

Configure os secrets do repositório para assinar **releases de tags**:

| Secret | Uso |
| --- | --- |
| WIN_CSC_LINK | Certificado Windows .p12/.pfx em base64 |
| WIN_CSC_KEY_PASSWORD | Senha do certificado Windows |
| MAC_CSC_LINK | Certificado Developer ID Application .p12 em base64 |
| MAC_CSC_KEY_PASSWORD | Senha do certificado macOS |
| APPLE_ID | Conta Apple usada na notarização |
| APPLE_APP_SPECIFIC_PASSWORD | Senha de app para notarização |
| APPLE_TEAM_ID | Equipe Apple |

No macOS, preencha o certificado e as três credenciais de notarização juntos.
A configuração ativa notarização somente quando as três variáveis existem.
PRs e builds de branches não recebem certificados. Falhas de assinatura/notarização
devem ser resolvidas antes de distribuir uma release como assinada.
Nenhum atualizador automático foi configurado.

Referências: [runners GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
e [código do electron-builder](https://github.com/electron-userland/electron-builder).
