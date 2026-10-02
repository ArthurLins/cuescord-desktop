# Instruções para agentes do Cuescord Desktop

Antes de qualquer deploy, release, publicação, atualização de ambiente ou rollback
do cliente, leia **integralmente** [docs/RELEASING.md](docs/RELEASING.md),
[SECURITY.md](SECURITY.md) e [.github/workflows/build.yml](.github/workflows/build.yml),
**a cada pedido**. Confira a versão, a política/chaves públicas e os scripts de
assinatura da revisão a publicar; não substitua essa leitura por memória.

Quando este repositório estiver como `apps/desktop` no Cuescord, leia primeiro o
[guia geral da plataforma](../../DEPLOY.md) e siga também o `AGENTS.md` da raiz.
No clone independente, RELEASING.md é o procedimento obrigatório do desktop.

Siga preparação, validação, publicação, aceite e recuperação. Chave Ed25519 de
atualização é obrigatória; certificado de publicador Windows é opcional. Não gere
outra chave para contornar falha, não publique arquivos sem assinatura nem
sobrescreva assets/tags publicados. Preserve as proteções do sistema operacional.

Pedidos explícitos de release autorizam suas etapas no alvo indicado, sem
confirmações repetidas. Documentação/build local não autorizam publicação. Pergunte
somente por informação necessária ausente ou ação destrutiva/fora do escopo sem
autorização. Não exponha segredos. Não declare sucesso antes de acompanhar Actions,
conferir a release e informar o resultado do aceite ou a etapa externa pendente.

Mantenha RELEASING.md atualizado quando alterar este fluxo. O repositório da
plataforma e suas credenciais não pertencem a este repositório público.
