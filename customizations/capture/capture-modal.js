function installCaptureModal(ipcRenderer, css) {
  let current;
  const outerCss = new CSSStyleSheet();
  outerCss.replaceSync(`
    /* Explicit intrinsic height prevents fixed inset: 0 from stretching the dialog. */
    dialog[data-cuescord-capture] { position: fixed; inset: 0; margin: auto; padding: 0; box-sizing: border-box;
      width: min(900px, calc(100vw - 48px)); max-width: none; height: fit-content; min-height: 0;
      max-height: calc(100dvh - 80px); border: 1px solid #393b43; border-radius: 16px;
      background: #232428; color: #f2f3f5; overflow: visible; box-shadow: 0 24px 90px #0008;
      animation: cuescord-capture-enter 140ms ease-out; }
    dialog[data-cuescord-capture]::backdrop { background: rgb(0 0 0 / .65); animation: cuescord-capture-enter 140ms ease-out; }
    @keyframes cuescord-capture-enter { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { dialog[data-cuescord-capture], dialog[data-cuescord-capture]::backdrop { animation: none; } }
    @media (max-width: 600px) { dialog[data-cuescord-capture] { width: calc(100vw - 24px); } }
  `);
  const innerCss = new CSSStyleSheet();
  innerCss.replaceSync(css);

  ipcRenderer.on('cuescord:capture:close', (_event, id) => {
    if (current?.id === id) current.dispose();
  });
  ipcRenderer.on('cuescord:capture:open', (_event, model) => {
    if (current) {
      void current.cancel();
      current.dispose();
    }
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-cuescord-capture', '');
    dialog.setAttribute('aria-label', 'Compartilhar tela');
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.adoptedStyleSheets = [innerCss];
    root.innerHTML = `
      <div class="picker">
        <header><div><h2>Compartilhar tela</h2><p>Escolha o que você quer mostrar.</p></div>
          <button class="close" aria-label="Fechar seletor" title="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div class="tabs" role="tablist" aria-label="Fontes de compartilhamento">
          <button id="windows-tab" role="tab" data-kind="window" aria-selected="true" aria-controls="sources" tabindex="0">Janelas</button>
          <button id="screens-tab" role="tab" data-kind="screen" aria-selected="false" aria-controls="sources" tabindex="-1">Telas</button>
        </div>
        <section id="sources" role="tabpanel" aria-labelledby="windows-tab" tabindex="0"></section>
        <div class="options">
          <div class="quality-option"><label for="screen-quality">Qualidade da transmissão</label><select id="screen-quality" aria-describedby="quality-help"></select><p id="quality-help">Qualidades maiores usam mais banda. A resolução e os FPS dependem da fonte e da conexão.</p></div>
          <label id="screen-option" hidden><input id="screen-audio" type="checkbox"><span>Compartilhar áudio</span></label>
          <div id="app-option" hidden><label for="audio-app">Áudio da janela</label><div class="app-controls"><select id="audio-app"></select><button id="refresh-audio" class="secondary">Atualizar</button></div></div>
        </div>
        <footer><button id="cancel" class="secondary">Cancelar</button><button id="share" class="primary" disabled>Compartilhar</button></footer>
      </div>`;
    dialog.append(host);
    const grid = root.querySelector('#sources');
    const share = root.querySelector('#share');
    const audioSelect = root.querySelector('#audio-app');
    const screenAudio = root.querySelector('#screen-audio');
    const qualitySelect = root.querySelector('#screen-quality');
    for (const profile of model.qualityProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label;
      qualitySelect.append(option);
    }
    qualitySelect.value = model.defaultQuality;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    let kind = 'window';
    let selection;
    let disposed = false;
    let loading = false;
    let submitting = false;
    let revision = 0;
    const entry = {
      id: model.id,
      cancel: async () => {
        if (disposed) return;
        try {
          await ipcRenderer.invoke('cuescord:capture:cancel', model.id);
        } catch (error) {
          console.error(error);
        } finally {
          entry.dispose();
        }
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        revision++;
        dialog.close();
        dialog.remove();
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (sheet) => sheet !== outerCss,
        );
        if (current === entry) current = undefined;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      },
    };
    current = entry;
    const updateOptions = () => {
      root.querySelector('#screen-option').hidden =
        kind !== 'screen' || !['win32', 'linux'].includes(model.platform);
      root.querySelector('#app-option').hidden =
        model.platform !== 'linux' || kind !== 'window' || !selection;
      qualitySelect.disabled = submitting;
      share.disabled =
        loading ||
        submitting ||
        !selection ||
        (model.portal && kind === 'window' && !audioSelect.value);
    };
    const fillAudioApps = (apps) => {
      const previous = audioSelect.value;
      audioSelect.replaceChildren();
      const automatic = document.createElement('option');
      automatic.value = '';
      automatic.textContent = model.portal ? 'Selecione o aplicativo' : 'Automático';
      audioSelect.append(automatic);
      for (const app of apps) {
        const option = document.createElement('option');
        option.value = app.id;
        option.textContent = app.name;
        audioSelect.append(option);
      }
      if (apps.some((app) => app.id === previous)) audioSelect.value = previous;
    };
    function renderSources(sources) {
      grid.replaceChildren();
      if (!sources.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent =
          kind === 'window' ? 'Nenhuma janela disponível.' : 'Nenhuma tela disponível.';
        grid.append(empty);
      }
      for (const source of sources) {
        const button = document.createElement('button');
        button.className = 'source';
        button.setAttribute('aria-pressed', 'false');
        button.title = source.name;
        const preview = document.createElement('div');
        preview.className = 'preview';
        const image = document.createElement('img');
        image.src = source.thumbnail;
        image.alt = '';
        const check = document.createElement('span');
        check.className = 'check';
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        preview.append(image, check);
        const name = document.createElement('span');
        name.className = 'source-name';
        name.textContent = source.name;
        button.append(preview, name);
        button.addEventListener('click', () => {
          if (submitting) return;
          selection = source;
          grid
            .querySelectorAll('.source')
            .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
          updateOptions();
        });
        grid.append(button);
      }
    }
    async function load(category) {
      kind = category;
      const request = ++revision;
      loading = true;
      selection = undefined;
      screenAudio.checked = false;
      grid.setAttribute('aria-busy', 'true');
      grid.scrollTop = 0;
      tabs.forEach((tab) => {
        const selected = tab.dataset.kind === kind;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) grid.setAttribute('aria-labelledby', tab.id);
      });
      grid.innerHTML = '<div class="skeleton" aria-hidden="true"></div>'.repeat(6);
      updateOptions();
      try {
        const data = await ipcRenderer.invoke('cuescord:capture:sources', model.id, category);
        if (disposed || request !== revision) return;
        fillAudioApps(data.audioApps);
        renderSources(data.sources);
      } catch (error) {
        console.error('Listagem de fontes de captura:', error);
        if (!disposed && request === revision) renderSources([]);
      } finally {
        if (!disposed && request === revision) {
          loading = false;
          grid.setAttribute('aria-busy', 'false');
          updateOptions();
        }
      }
    }
    tabs.forEach((tab) =>
      tab.addEventListener('click', () => {
        if (!submitting && tab.dataset.kind !== kind) void load(tab.dataset.kind);
      }),
    );
    root.querySelector('.tabs').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || submitting) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : kind === 'window' ? 1 : 0;
      tabs[index].focus();
      if (tabs[index].dataset.kind !== kind) void load(tabs[index].dataset.kind);
    });
    audioSelect.addEventListener('change', updateOptions);
    root.querySelector('#refresh-audio').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const apps = await ipcRenderer.invoke('cuescord:capture:audio-apps', model.id);
        if (!disposed) {
          fillAudioApps(apps);
          updateOptions();
        }
      } catch (error) {
        console.error(error);
      } finally {
        button.disabled = false;
      }
    });
    share.addEventListener('click', async () => {
      if (share.disabled || !selection) return;
      submitting = true;
      updateOptions();
      try {
        await ipcRenderer.invoke('cuescord:capture:select', model.id, selection.id, {
          kind,
          quality: qualitySelect.value,
          audio: kind === 'screen' && screenAudio.checked,
          audioApp: kind === 'window' ? audioSelect.value : '',
        });
      } catch (error) {
        console.error(error);
      } finally {
        if (!disposed) {
          submitting = false;
          updateOptions();
        }
      }
    });
    root.querySelector('#cancel').addEventListener('click', () => void entry.cancel());
    root.querySelector('.close').addEventListener('click', () => void entry.cancel());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      void entry.cancel();
    });
    dialog.addEventListener('close', () => {
      if (!disposed) void entry.cancel();
    });
    let outside = false;
    const isOutside = (event) => {
      const bounds = dialog.getBoundingClientRect();
      return (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      );
    };
    dialog.addEventListener('pointerdown', (event) => {
      outside = event.target === dialog && isOutside(event);
    });
    dialog.addEventListener('click', (event) => {
      if (outside && event.target === dialog && isOutside(event)) void entry.cancel();
      outside = false;
    });
    try {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, outerCss];
      document.body.append(dialog);
      dialog.showModal();
      tabs[0].focus();
      void load(kind);
    } catch (error) {
      console.error(error);
      void entry.cancel();
    }
  });
}
