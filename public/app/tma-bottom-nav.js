/** Fixed bottom tab bar for job search / profile pages. */
(function (global) {
  const NAV_STRINGS = {
    ru: { jobSearch: 'Поиск работы', settings: 'Настройки', mainNav: 'Главное меню' },
    en: { jobSearch: 'Job search', settings: 'Settings', mainNav: 'Main menu' },
  };

  const CSS = `
    body.has-tma-bottom-nav {
      padding-bottom: calc(62px + env(safe-area-inset-bottom, 0px));
    }
    .tma-bottom-nav {
      display: flex;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1400;
      min-height: 56px;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
      background: rgba(17, 17, 17, 0.96);
      border-top: 1px solid #2e2e2e;
      backdrop-filter: blur(10px);
    }
    @media (min-width: 769px) {
      .tma-bottom-nav {
        max-width: 760px;
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        border-left: 1px solid #2e2e2e;
        border-right: 1px solid #2e2e2e;
        border-radius: 12px 12px 0 0;
        justify-content: center;
        gap: 8px;
      }
      .tma-bottom-nav-item {
        flex: 0 0 auto;
        width: 100px;
      }
    }
    .tma-bottom-nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 44px;
      padding: 4px 6px;
      border-radius: 10px;
      color: #888888;
      text-decoration: none;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
      transition: color 0.15s, background 0.15s;
      cursor: pointer;
    }
    .tma-bottom-nav-item svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .tma-bottom-nav-item.is-active {
      color: #f0f0f0;
      background: rgba(255, 255, 255, 0.08);
    }
    .tma-bottom-nav-item:not(.is-active):active {
      background: rgba(255, 255, 255, 0.04);
    }
    .tma-settings-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: calc(68px + env(safe-area-inset-bottom, 0px));
      z-index: 1300;
      background: #111111;
      transform: translateY(110%);
      transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
      overflow: hidden;
    }
    .tma-settings-modal.is-open {
      transform: translateY(0);
    }
    .tma-settings-modal iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
  `;

  const ICON_JOBS =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2zm4 4V4h-4v2h4z"/></svg>';
  const ICON_SETTINGS =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94a7.49 7.49 0 0 0 .05-.94 7.49 7.49 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.28 7.28 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.63-.05.94s.02.63.05.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

  function normalizeLang(lang) {
    if (global.TmaI18n?.normalizeLang) return global.TmaI18n.normalizeLang(lang);
    return String(lang || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  function openModal() {
    let modal = document.getElementById('tmaSettingsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tmaSettingsModal';
      modal.className = 'tma-settings-modal';

      const iframe = document.createElement('iframe');
      iframe.src = '/app/profile';
      iframe.addEventListener('load', function () {
        try {
          const innerDoc = iframe.contentDocument || iframe.contentWindow.document;
          const innerNav = innerDoc.getElementById('tmaBottomNav');
          if (innerNav) innerNav.style.display = 'none';
          if (innerDoc.body) {
            innerDoc.body.classList.remove('has-tma-bottom-nav');
            innerDoc.body.style.paddingBottom = '0';
          }
        } catch (e) {}
      });
      modal.appendChild(iframe);
      document.body.appendChild(modal);
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        modal.classList.add('is-open');
      });
    });
  }

  function closeModal() {
    const modal = document.getElementById('tmaSettingsModal');
    if (modal) modal.classList.remove('is-open');
  }

  function isModalOpen() {
    const modal = document.getElementById('tmaSettingsModal');
    return modal ? modal.classList.contains('is-open') : false;
  }

  /**
   * @param {{ active?: 'jobs' | 'profile', lang?: string }} [options]
   */
  function mount(options = {}) {
    const active = options.active === 'profile' ? 'profile' : 'jobs';
    const lang = normalizeLang(options.lang);
    const s = NAV_STRINGS[lang] || NAV_STRINGS.en;

    if (!document.getElementById('tmaBottomNavStyles')) {
      const style = document.createElement('style');
      style.id = 'tmaBottomNavStyles';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    document.body.classList.add('has-tma-bottom-nav');

    let nav = document.getElementById('tmaBottomNav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'tmaBottomNav';
      nav.className = 'tma-bottom-nav';
      document.body.appendChild(nav);
    }
    nav.setAttribute('aria-label', s.mainNav);

    const jobsEl = document.createElement('span');
    jobsEl.className = 'tma-bottom-nav-item' + (active === 'jobs' ? ' is-active' : '');
    jobsEl.setAttribute('role', 'button');
    jobsEl.innerHTML = ICON_JOBS + `<span>${s.jobSearch}</span>`;

    const settingsEl = document.createElement('span');
    settingsEl.className = 'tma-bottom-nav-item' + (active === 'profile' ? ' is-active' : '');
    settingsEl.setAttribute('role', 'button');
    settingsEl.innerHTML = ICON_SETTINGS + `<span>${s.settings}</span>`;

    nav.innerHTML = '';
    nav.appendChild(jobsEl);
    nav.appendChild(settingsEl);

    if (active === 'jobs') {
      settingsEl.addEventListener('click', function () {
        if (isModalOpen()) return;
        openModal();
        settingsEl.classList.add('is-active');
        jobsEl.classList.remove('is-active');
      });

      jobsEl.addEventListener('click', function () {
        if (isModalOpen()) {
          closeModal();
          jobsEl.classList.add('is-active');
          settingsEl.classList.remove('is-active');
        }
      });
    } else {
      // On profile page: jobs tab navigates away, settings is already active
      jobsEl.addEventListener('click', function () {
        window.location.href = '/app/seeker-jobs';
      });
    }
  }

  global.TmaBottomNav = { mount };
})(window);
