const bridge = window.cuescordUpdates;
const action = document.getElementById('action');
const cancel = document.getElementById('cancel');
const progress = document.getElementById('progress');
let status = 'idle';
let request = false;
let received = false;

function render(state) {
  status = state.status;
  document.getElementById('version').textContent = `Versão instalada: ${state.currentVersion}`;
  const messages = {
    idle: [
      'Pronto para verificar',
      state.message || 'Confira se há uma nova versão do aplicativo.',
    ],
    checking: ['Verificando atualização', 'Consultando a versão publicada…'],
    available: [
      `Versão ${state.availableVersion} disponível`,
      `Download de ${Math.ceil(state.size / (1024 * 1024))} MB. A instalação só começa quando você escolher.`,
    ],
    downloading: ['Baixando atualização', `${state.progress}% — você pode cancelar o download.`],
    ready: ['Download verificado', `A versão ${state.availableVersion} está pronta para instalar.`],
    installing: ['Preparando instalação', 'Confirme na janela do sistema para continuar.'],
    opened: ['Instalador aberto', 'Conclua a instalação no sistema e reinicie o Cuescord.'],
    current: ['Você está atualizado', 'A versão mais recente já está instalada.'],
    error: ['Não foi possível atualizar', state.message || 'Tente novamente em alguns instantes.'],
    disabled: [
      'Aplicativo em desenvolvimento',
      'A atualização fica disponível no aplicativo instalado.',
    ],
  };
  const text = messages[status] || messages.error;
  document.getElementById('heading').textContent = text[0];
  document.getElementById('message').textContent = text[1];
  document.getElementById('detail').textContent =
    status === 'ready'
      ? 'Encerre suas chamadas antes de instalar. As proteções do sistema operacional permanecem ativas.'
      : 'O cliente verifica a origem e a integridade da atualização antes de abrir o instalador.';
  progress.hidden = status !== 'downloading';
  progress.value = state.progress || 0;
  action.textContent =
    status === 'available'
      ? 'Baixar atualização'
      : status === 'ready'
        ? 'Instalar atualização'
        : status === 'error'
          ? 'Tentar novamente'
          : 'Verificar atualização';
  action.disabled =
    request || ['checking', 'downloading', 'installing', 'opened', 'disabled'].includes(status);
  cancel.hidden = !['checking', 'downloading'].includes(status);
  cancel.textContent = status === 'checking' ? 'Cancelar verificação' : 'Cancelar download';
}

bridge.onState((state) => {
  received = true;
  render(state);
});
bridge
  .state()
  .then((state) => {
    if (!received) render(state);
  })
  .catch(() =>
    render({
      status: 'error',
      currentVersion: '—',
      message: 'Não foi possível acessar o atualizador.',
    }),
  );

action.addEventListener('click', async () => {
  if (request || action.disabled) return;
  request = true;
  action.disabled = true;
  let state;
  try {
    state = await (status === 'available'
      ? bridge.download()
      : status === 'ready'
        ? bridge.install()
        : bridge.check());
  } catch {
    state = {
      status: 'error',
      currentVersion: '—',
      message: 'Não foi possível concluir a atualização.',
    };
  } finally {
    request = false;
    if (state) render(state);
  }
});
cancel.addEventListener('click', () => {
  void bridge.cancel().catch(() => {});
});
