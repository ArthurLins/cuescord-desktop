# Contribuindo

1. Faça um fork e clone este repositório.
2. Instale Node e pnpm nas versões indicadas no README.
3. Rode `pnpm install --frozen-lockfile` e `pnpm desktop:dev`.
4. Faça uma alteração focada e descreva o comportamento e os sistemas afetados.
5. Abra um pull request com o que foi conferido e o que não foi exercitado.

Não é necessário acesso à plataforma privada. Para experimentar a ponte em outra
página de desenvolvimento, configure CUESCORD_DESKTOP_URL e siga INTEGRATION.md.

Mantenha sandbox, isolamento, validação de origem/remetente e permissões mínimas.
Não exponha IPC genérico nem processos/dispositivos arbitrários ao renderer.
Não inclua código de servidor, credenciais, dados de usuário, node_modules,
perfis do navegador ou instaladores no Git.

As suites existentes podem ser executadas com `pnpm test` e `pnpm test:ui`.
Mudanças de captura também precisam de conferência manual no sistema envolvido:
seleção/cancelamento, encerramento da chamada, navegação, dispositivos negados,
áudio de outro aplicativo e exclusão do áudio da própria chamada.

Dependências e workflows devem preservar versões fixadas e atualizar o lockfile.
Contribuições são disponibilizadas sob a licença MIT deste repositório.
