// Executada no preload isolado do Electron. Não é importada pelo site.
// Mantenha aqui comportamentos exclusivos do desktop, sem duplicar componentes.
function initializeDesktop({ origin, version, platform, css, titlebarCss }, appWindow) {
  if (window.top !== window || window.location.origin !== origin) return;

  if (window.__CUESCORD_DESKTOP__) return;
  Object.defineProperty(window, "__CUESCORD_DESKTOP__", {
    value: Object.freeze({ version, platform, engine: "electron" }),
    writable: false,
    configurable: false,
  });

  // Uma folha adotada evita alterar o HTML que o React precisa hidratar.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  if (platform !== "windows") return;

  function mountTitlebar() {
    // O body mantém todos os filhos que o Next/React hidrata. A barra vive no
    // shadow DOM e o slot exibe os elementos originais, inclusive os portals.
    const shadow = document.body.attachShadow({ mode: "open" });
    const chromeSheet = new CSSStyleSheet();
    chromeSheet.replaceSync(titlebarCss);
    shadow.adoptedStyleSheets = [chromeSheet];
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, chromeSheet];
    shadow.innerHTML = `
      <div class="desktop-titlebar" role="region" aria-label="Janela do Cuescord">
        <div class="desktop-drag-left">
          <span class="desktop-brand" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/></svg>
            Cuescord
          </span>
        </div>
        <div class="desktop-drag-right"></div>
        <div class="desktop-window-controls">
          <button type="button" data-action="minimize" aria-label="Minimizar" title="Minimizar">
            <svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg>
          </button>
          <button type="button" data-action="maximize" aria-label="Maximizar" title="Maximizar">
            <svg viewBox="0 0 12 12"><path d="M1.5 1.5h9v9h-9z"/></svg>
          </button>
          <button type="button" data-action="close" aria-label="Fechar" title="Fechar">
            <svg viewBox="0 0 12 12"><path d="m1.5 1.5 9 9m0-9-9 9"/></svg>
          </button>
        </div>
        <span class="desktop-window-error" role="status" aria-live="polite"></span>
      </div>
      <slot></slot>`;

    const titlebar = shadow.querySelector(".desktop-titlebar");
    const maximizeButton = shadow.querySelector('[data-action="maximize"]');
    const errorMessage = shadow.querySelector('[role="status"]');
    // showModal() torna o restante do documento inerte. Enquanto houver um
    // diálogo aberto, mantenha a mesma barra dentro dele, em outro shadow root.
    // Isso acontece após a montagem do diálogo, sem tocar na hidratação inicial.
    const modalHost = document.createElement("div");
    const modalShadow = modalHost.attachShadow({ mode: "open" });
    modalShadow.adoptedStyleSheets = [chromeSheet];
    const modalObserver = new MutationObserver(() => {
      const modal = [...document.querySelectorAll("dialog:modal")].at(-1);
      if (modal) {
        if (modalHost.parentElement !== modal) modal.append(modalHost);
        if (titlebar.parentNode !== modalShadow) modalShadow.append(titlebar);
      } else if (titlebar.parentNode !== shadow) {
        shadow.prepend(titlebar);
        modalHost.remove();
      }
    });
    modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
    let stateRequest = 0;
    let toggling = false;

    function reportError(error) {
      console.error("Falha no controle da janela do Cuescord:", error);
      errorMessage.textContent = "Não foi possível controlar a janela. Tente novamente.";
    }

    async function refreshWindowState() {
      const request = ++stateRequest;
      try {
        const maximized = await appWindow.isMaximized();
        if (request !== stateRequest) return;
        const label = maximized ? "Restaurar" : "Maximizar";
        maximizeButton.setAttribute("aria-label", label);
        maximizeButton.title = label;
        maximizeButton.querySelector("path").setAttribute("d", maximized
          ? "M3.5 3.5h7v7h-7zM1.5 8.5v-7h7"
          : "M1.5 1.5h9v9h-9z");
      } catch (error) { reportError(error); }
    }

    async function toggleMaximize() {
      if (toggling) return;
      toggling = true;
      try {
        await appWindow.toggleMaximize();
        await refreshWindowState();
      } finally { toggling = false; }
    }

    const actions = {
      minimize: () => appWindow.minimize(),
      maximize: toggleMaximize,
      close: () => appWindow.close(),
    };
    for (const button of shadow.querySelectorAll("[data-action]")) {
      button.addEventListener("click", () => {
        errorMessage.textContent = "";
        void actions[button.dataset.action]().catch(reportError);
      });
    }
    window.addEventListener("resize", refreshWindowState);
    window.addEventListener("focus", () => {
      titlebar.classList.remove("inactive");
      void refreshWindowState();
    });
    window.addEventListener("blur", () => titlebar.classList.add("inactive"));
    void refreshWindowState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTitlebar, { once: true });
  } else {
    mountTitlebar();
  }
}
