/** Job search TMA strings (ru / en). */
(function (global) {
  const STRINGS = {
    ru: {
      pageTitle: 'Поиск вакансий',
      searchHeading: 'Поиск вакансий на 100% удалёнку',
      searchHeadingBase: 'Поиск вакансий',
      searchTitleFor: 'для {labels}',
      searchBtnDeeplink: 'Искать',
      searchBtnWithSkill: 'Искать {skill}',
      showAllJobs: 'Показать все вакансии',
      genCvCoverDeeplink: 'Сгенерировать CV и Cover Letter под вакансию',
      dateFrom: 'С',
      dateTo: 'По',
      roles: 'Роли',
      allRoles: 'Все роли',
      rolesSelected: 'Выбрано ролей: {count}',
      highlyRelevant: 'Топ-совпадения',
      highlyRelevantHintTitle: 'Что значит Топ-совпадения?',
      searchIn: 'Искать в',
      allSources: 'Все источники',
      sourcesSelected: 'Выбрано источников: {count}',
      sourceLabel: 'Source',
      filterAll: 'Все',
      searchBtn: 'Поиск',
      clearFilters: 'Сбросить фильтры',
      prevPage: 'Предыдущая страница',
      nextPage: 'Следующая страница',
      close: 'Закрыть',
      selectJobHint: 'Выберите вакансию, чтобы продолжить.',
      genCvCover: '✨ Сгенерировать CV и Cover Letter',
      coverLetter: 'Сопроводительное письмо',
      markAs: 'Отметить как',
      statusNew: 'новая',
      statusApplied: 'откликнулся',
      statusSkipped: 'пропущена',
      notesHint: 'Можно сделать заметку по отклику ниже',
      myNotes: 'Мои заметки',
      insightTitle: 'AI-пояснение',
      highlyRelevantModalTitle: 'Топ-совпадения',
      highlyRelevantP1:
        'Если включен фильтр Топ-совпадения, показываются только вакансии с наиболее высокой релевантностью к выбранным ролям.',
      highlyRelevantP2:
        'Если фильтр выключен, вы увидите и другие подходящие вакансии, которые могут быть полезны, но не входят в топ по релевантности.',
      resumeTitle: 'Загрузите ваше резюме',
      resumeSubtitle: 'Нужно для генерации резюме и сопроводительного письма под эту вакансию.',
      pickFile: 'Нажмите, чтобы выбрать файл',
      pickFileTypes: 'PDF/JPG/PNG/WEBP - до 15 MB',
      fileSelected: 'Файл выбран',
      uploadResume: 'Загрузить и продолжить',
      resumeUploadNote: 'Загружается один раз - дальше генерация будет быстрее.',
      subscribeTitle: 'Подпишитесь на канал',
      subscribeBody: 'Чтобы продолжить, подпишитесь на наш Telegram-канал с актуальными вакансиями.',
      openChannel: 'Открыть канал',
      verifySubscribe: 'Я подписался — проверить снова',
      paywallIntro: 'Для продолжения, перейди на премиум план или пригласи друга',
      inviteFriend: 'Пригласить друга',
      followChannelFree: 'Следить за вакансиями в Telegram-канале бесплатно',
      applyExternalSites: 'Сайты компаний',
      applyThirdParty: 'Сторонний сайт',
      noData: 'Нет данных.',
      noJobs: 'Вакансии не найдены.',
      published: 'Опубликовано',
      applyVia: 'Отклик',
      applyNow: 'Откликнуться',
      remote: 'Удаленка',
      remoteWhy: 'Почему AI считает эту вакансию удаленной?',
      skillWhy: 'Почему AI выделил этот навык?',
      keySkills: 'Ключевые навыки',
      extraSkills: 'Дополнительные навыки',
      none: 'Нет',
      downloadTailoredCv: '⬇ Скачать CV под вакансию',
      downloadTailoredCvAlt: 'Скачать адаптированное CV',
      pagerNone: 'Ничего не найдено',
      pagerEmptyPage: 'Нет записей на странице · всего {total}',
      pagerRange: '{from}–{to} из {total}',
      pagerTitleFull:
        'Страница {page}. На этой странице {count} из {pageSize} максимум. Всего по фильтру: {total}.',
      pagerTitleRange: 'Страница {page}. Показаны позиции с {from}-й по {to}-ю.',
      otherRole: 'Другое',
      channelNotConfigured: 'Канал пока не настроен. Обратитесь к администратору.',
      noPlans: 'Сейчас нет доступных тарифов.',
      premium: 'Премиум',
      planFeatureJobs: 'Доступ к вакансиям',
      planFeatureAi: 'Автогенерация резюме и cover letter',
      getPremium: 'Получить Премиум',
      planPriceMonthly: '~{usd} / месяц · ⭐ {stars} Stars',
      planPriceStars: '⭐ {stars} Stars',
      errPremiumAi: 'AI-инструменты доступны в Premium или при наличии открытий.',
      errOpenJob: 'Не удалось открыть детали вакансии.',
      errOpenJobDetails: 'Не удалось зафиксировать открытие деталей вакансии',
      errPaymentLink: 'Не удалось открыть ссылку на оплату.',
      errPaymentEmpty: 'Ссылка на оплату пустая.',
      errBotUsername: 'Не удалось получить username бота.',
      errUser: 'Не удалось определить текущего пользователя.',
      errPickFile: 'Сначала выберите файл.',
      errFileSize: 'Файл слишком большой. Максимум 15MB.',
      errFileType: 'Неподдерживаемый тип файла. Используйте PDF или изображение (JPG/PNG/WEBP).',
      errUploadResume: 'Не удалось загрузить резюме',
      errResumeNoUrl: 'Резюме загружено, но ссылка отсутствует.',
      resumeUploaded: 'Резюме успешно загружено.',
      errDates: 'Укажите даты "С" и "По".',
      errOpenJobFirst: 'Сначала откройте вакансию.',
      statusSaved: 'Статус сохранен.',
      errResumeText: 'Текст резюме не найден у текущего пользователя.',
      materialsGenerated: 'Адаптированные CV и cover letter сгенерированы и сохранены.',
      errInitData: 'Нет данных Telegram Web App (init data).',
      errInitHintLong:
        ' Ссылка может быть слишком длинной для Telegram на iOS. Откройте поиск из меню бота или сократите фильтры в ссылке.',
      errInitHintOpenInBot:
        ' Открывайте этот экран только из Telegram (меню бота или кнопка в чате), а не во внешнем браузере.',
      errReferral: 'Не удалось открыть реферальный экран.',
      errChannelLink: 'Не удалось открыть ссылку на канал.',
      subscribeStillRequired: 'Вы все еще подписаны не на все обязательные каналы.',
      errVerifySubscribe: 'Не удалось проверить подписку.',
      channelLinkUnavailable: 'Ссылка на канал недоступна.',
      bootError: 'Не удалось инициализировать страницу поиска вакансий: {message}',
      errGenerateMaterials: 'Не удалось сгенерировать материалы. Попробуйте снова.',
    },
    en: {
      pageTitle: 'Job search',
      searchHeading: '100% remote job search',
      searchHeadingBase: 'Job search',
      searchTitleFor: 'for {labels}',
      searchBtnDeeplink: 'Search',
      searchBtnWithSkill: 'Search {skill}',
      showAllJobs: 'Show all jobs',
      genCvCoverDeeplink: 'Generate tailored CV and cover letter',
      dateFrom: 'From',
      dateTo: 'To',
      roles: 'Roles',
      allRoles: 'All roles',
      rolesSelected: 'Roles selected: {count}',
      highlyRelevant: 'Top matches',
      highlyRelevantHintTitle: 'What does Top matches mean?',
      searchIn: 'Search in',
      allSources: 'All sources',
      sourcesSelected: 'Sources selected: {count}',
      sourceLabel: 'Source',
      filterAll: 'All',
      searchBtn: 'Search',
      clearFilters: 'Reset filters',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      close: 'Close',
      selectJobHint: 'Select a job to continue.',
      genCvCover: '✨ Generate CV and cover letter',
      coverLetter: 'Cover letter',
      markAs: 'Mark as',
      statusNew: 'new',
      statusApplied: 'applied',
      statusSkipped: 'skipped',
      notesHint: 'You can add a note about this application below',
      myNotes: 'My notes',
      insightTitle: 'AI insight',
      highlyRelevantModalTitle: 'Top matches',
      highlyRelevantP1:
        'When Top matches is enabled, only jobs with the highest relevance to your selected roles are shown.',
      highlyRelevantP2:
        'When it is off, you will also see other suitable jobs that may be useful but are not in the top relevance tier.',
      resumeTitle: 'Upload your resume',
      resumeSubtitle: 'Required to generate a tailored resume and cover letter for this job.',
      pickFile: 'Tap to choose a file',
      pickFileTypes: 'PDF/JPG/PNG/WEBP - up to 15 MB',
      fileSelected: 'File selected',
      uploadResume: 'Upload and continue',
      resumeUploadNote: 'Uploaded once - generation will be faster next time.',
      subscribeTitle: 'Subscribe to the channel',
      subscribeBody: 'To continue, subscribe to our Telegram channel with up-to-date remote jobs.',
      openChannel: 'Open channel',
      verifySubscribe: 'I subscribed — check again',
      paywallIntro: 'To continue, upgrade to premium or invite a friend',
      inviteFriend: 'Invite a friend',
      followChannelFree: 'Follow jobs in our free Telegram channel',
      applyExternalSites: 'Company sites',
      applyThirdParty: 'Third-party site',
      noData: 'No data.',
      noJobs: 'No jobs found.',
      published: 'Posted',
      applyVia: 'Apply via',
      applyNow: 'Apply',
      remote: 'Remote',
      remoteWhy: 'Why does AI consider this job remote?',
      skillWhy: 'Why did AI highlight this skill?',
      keySkills: 'Key skills',
      extraSkills: 'Additional skills',
      none: 'None',
      downloadTailoredCv: '⬇ Download tailored CV',
      downloadTailoredCvAlt: 'Download tailored CV',
      pagerNone: 'Nothing found',
      pagerEmptyPage: 'No rows on this page · {total} total',
      pagerRange: '{from}–{to} of {total}',
      pagerTitleFull: 'Page {page}. Showing {count} of {pageSize} max. {total} total matching filter.',
      pagerTitleRange: 'Page {page}. Showing rows {from}–{to}.',
      otherRole: 'Other',
      channelNotConfigured: 'Channel is not configured yet. Contact support.',
      noPlans: 'No plans available right now.',
      premium: 'Premium',
      planFeatureJobs: 'Access to jobs',
      planFeatureAi: 'Auto-generated resume and cover letter',
      getPremium: 'Get Premium',
      planPriceMonthly: '~{usd} / month · ⭐ {stars} Stars',
      planPriceStars: '⭐ {stars} Stars',
      errPremiumAi: 'AI tools are available with Premium or when you have openings left.',
      errOpenJob: 'Could not open job details.',
      errOpenJobDetails: 'Could not record job details open',
      errPaymentLink: 'Could not open payment link.',
      errPaymentEmpty: 'Payment link is empty.',
      errBotUsername: 'Could not get bot username.',
      errUser: 'Could not identify current user.',
      errPickFile: 'Choose a file first.',
      errFileSize: 'File is too large. Maximum 15MB.',
      errFileType: 'Unsupported file type. Use PDF or image (JPG/PNG/WEBP).',
      errUploadResume: 'Could not upload resume',
      errResumeNoUrl: 'Resume uploaded but URL is missing.',
      resumeUploaded: 'Resume uploaded successfully.',
      errDates: 'Enter From and To dates.',
      errOpenJobFirst: 'Open a job first.',
      statusSaved: 'Status saved.',
      errResumeText: 'Resume text not found for current user.',
      materialsGenerated: 'Tailored CV and cover letter generated and saved.',
      errInitData: 'Missing Telegram Web App init data.',
      errInitHintLong:
        ' The link may be too long for Telegram on iOS. Open search from the bot menu or shorten filters in the link.',
      errInitHintOpenInBot:
        ' Open this screen only from Telegram (bot menu or chat button), not in an external browser.',
      errReferral: 'Could not open referral screen.',
      errChannelLink: 'Could not open channel link.',
      subscribeStillRequired: 'You are still not subscribed to all required channels.',
      errVerifySubscribe: 'Could not verify subscription.',
      channelLinkUnavailable: 'Channel link is unavailable.',
      bootError: 'Could not initialize job search page: {message}',
      errGenerateMaterials: 'Could not generate materials. Please try again.',
    },
  };

  function sj(lang, key, params) {
    return global.TmaI18n.t(STRINGS, lang, key, params);
  }

  function applyStaticUi(lang) {
    const L = global.TmaI18n.normalizeLang(lang);
    document.documentElement.lang = L;
    document.title = sj(L, 'pageTitle');

    const setText = (id, key, params) => {
      const el = document.getElementById(id);
      if (el) el.textContent = sj(L, key, params);
    };
    const setHtml = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = sj(L, key);
    };

    const titleSkill = document.getElementById('searchTitleSkill');
    const h2 = document.querySelector('.layout-col > h2');
    if (h2 && titleSkill) {
      h2.innerHTML = `${sj(L, 'searchHeadingBase')} <span id="searchTitleSkill" class="search-title-skill"></span>`;
    } else if (h2) {
      h2.textContent = sj(L, 'searchHeading');
    }

    function setDateInputLabel(inputId, key) {
      const input = document.getElementById(inputId);
      const label = input?.closest('label');
      if (!label || !input) return;
      [...label.childNodes].forEach((n) => {
        if (n !== input && n.nodeType === Node.TEXT_NODE) label.removeChild(n);
      });
      label.insertBefore(document.createTextNode(`${sj(L, key)} `), input);
    }
    setDateInputLabel('fromDate', 'dateFrom');
    setDateInputLabel('toDate', 'dateTo');

    document.querySelectorAll('.row.date-range-row > label').forEach((label) => {
      const t = label.textContent.trim();
      if (t === 'Роли' || t === 'Roles') label.textContent = sj(L, 'roles');
      if (t === 'Искать в' || t === 'Search in') label.textContent = sj(L, 'searchIn');
      if (t === 'Source') label.textContent = sj(L, 'sourceLabel');
    });

    const highlyLabel = document.querySelector('#highlyRelevantFilterWrap label');
    const highlyCb = document.getElementById('showOnlyHighlyRelevant');
    if (highlyLabel && highlyCb) {
      [...highlyLabel.childNodes].forEach((n) => {
        if (n !== highlyCb) highlyLabel.removeChild(n);
      });
      highlyLabel.appendChild(document.createTextNode(` ${sj(L, 'highlyRelevant')}`));
    }

    const hintBtn = document.getElementById('highlyRelevantHintBtn');
    if (hintBtn) {
      hintBtn.title = sj(L, 'highlyRelevantHintTitle');
      hintBtn.setAttribute('aria-label', sj(L, 'highlyRelevantHintTitle'));
    }

    if (document.getElementById('advancedSearchBtn')) {
      setText('advancedSearchBtn', 'showAllJobs');
    } else {
      setText('syncBtn', 'searchBtn');
    }
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) clearBtn.textContent = sj(L, 'clearFilters');
    setText('jobInfo', 'selectJobHint');
    const genBtn = document.getElementById('genBtn');
    if (genBtn) {
      genBtn.textContent = titleSkill ? sj(L, 'genCvCoverDeeplink') : sj(L, 'genCvCover');
    }
    setText('insightModalTitle', 'insightTitle');
    setText('highlyRelevantHintTitle', 'highlyRelevantModalTitle');
    const resumeTitleEl = document.querySelector('.resume-required-title');
    if (resumeTitleEl) resumeTitleEl.textContent = sj(L, 'resumeTitle');
    const resumeSub = document.querySelector('.resume-required-subtitle');
    if (resumeSub) resumeSub.textContent = sj(L, 'resumeSubtitle');
    setText('uploadResumeBtn', 'uploadResume');
    const resumeNote = document.querySelector('.resume-upload-note');
    if (resumeNote) resumeNote.textContent = sj(L, 'resumeUploadNote');
    const subscribeTitleEl = document.querySelector('.subscribe-required-title');
    if (subscribeTitleEl) subscribeTitleEl.textContent = sj(L, 'subscribeTitle');
    const subscribeP = document.querySelector('.subscribe-required-body > p.muted');
    if (subscribeP) subscribeP.textContent = sj(L, 'subscribeBody');
    setText('openRequiredChannelBtn', 'openChannel');
    setText('verifySubscriptionBtn', 'verifySubscribe');
    setText('inviteFriendBtn', 'inviteFriend');
    setText('openChannelAlternativeBtn', 'followChannelFree');
    const payIntro = document.querySelector('.paywall-intro');
    if (payIntro) payIntro.textContent = sj(L, 'paywallIntro');

    const highlyP = document.querySelectorAll('#highlyRelevantHintModal .job-summary');
    if (highlyP[0]) highlyP[0].textContent = sj(L, 'highlyRelevantP1');
    if (highlyP[1]) highlyP[1].textContent = sj(L, 'highlyRelevantP2');

    const coverLbl = document.querySelector('#coverLetterBlock label');
    const statusRow = document.getElementById('statusRow');
    const statusSelEl = document.getElementById('statusSel');
    const markLbl = statusRow && statusSelEl ? null : statusSelEl?.previousElementSibling;
    const notesH4 = document.querySelector('#jobNotesBlock h4');
    if (coverLbl) coverLbl.textContent = sj(L, 'coverLetter');
    if (statusRow && statusSelEl) {
      [...statusRow.childNodes].forEach((n) => {
        if (n !== statusSelEl) statusRow.removeChild(n);
      });
      statusRow.insertBefore(document.createTextNode(`${sj(L, 'markAs')} `), statusSelEl);
    } else if (markLbl) {
      markLbl.textContent = sj(L, 'markAs');
    }
    if (notesH4) notesH4.textContent = sj(L, 'notesHint');

    const statusSel = document.getElementById('statusSel');
    if (statusSel) {
      const opts = statusSel.options;
      if (opts[0]) opts[0].textContent = sj(L, 'statusNew');
      if (opts[1]) opts[1].textContent = sj(L, 'statusApplied');
      if (opts[2]) opts[2].textContent = sj(L, 'statusSkipped');
    }

    const sourceSel = document.getElementById('sourceSel');
    if (sourceSel?.options[0]) sourceSel.options[0].textContent = sj(L, 'filterAll');

    ['jobModalClose', 'insightModalClose', 'highlyRelevantHintClose', 'resumeRequiredClose', 'subscribeRequiredClose', 'paymentRequiredClose', 'prevPageBtn', 'nextPageBtn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-label', sj(L, id === 'prevPageBtn' ? 'prevPage' : id === 'nextPageBtn' ? 'nextPage' : 'close'));
    });

    const notes = document.getElementById('notesText');
    if (notes) notes.setAttribute('aria-label', sj(L, 'myNotes'));

    refreshResumePickerStatic(L);
  }

  function refreshResumePickerStatic(lang) {
    const L = global.TmaI18n.normalizeLang(lang);
    const picker = document.querySelector('#resumeFilePickerLabel .resume-file-picker, #resumeFilePickerLabel');
    if (!picker) return;
    const nameEl = picker.querySelector('.resume-file-picker-name');
    const fileInput = document.getElementById('resumeFileInput');
    if (fileInput?.files?.[0]) return;
    const inner = picker.querySelector('div');
    if (inner && inner.children.length >= 2) {
      inner.children[0].textContent = sj(L, 'pickFile');
      if (nameEl) nameEl.textContent = sj(L, 'pickFileTypes');
    }
  }

  function getApplyTypeOptions(lang) {
    const L = global.TmaI18n.normalizeLang(lang);
    return [
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'indeed', label: 'Indeed' },
      { value: 'telegram', label: 'Telegram' },
      { value: 'external', label: sj(L, 'applyExternalSites') },
    ];
  }

  function getApplyTypeLabels(lang) {
    const L = global.TmaI18n.normalizeLang(lang);
    return {
      linkedin: 'LinkedIn',
      indeed: 'Indeed',
      telegram: 'Telegram',
      external: sj(L, 'applyExternalSites'),
      thirdParty: sj(L, 'applyThirdParty'),
    };
  }

  global.SeekerJobsI18n = {
    STRINGS,
    sj,
    applyStaticUi,
    refreshResumePickerStatic,
    getApplyTypeOptions,
    getApplyTypeLabels,
  };
})(window);
