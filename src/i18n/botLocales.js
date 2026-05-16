/** @typedef {'ru' | 'en'} BotLang */

/** @type {Record<BotLang, Record<string, string>>} */
export const BOT_LOCALES = {
  ru: {
    start_intro: ['Привет', '', 'Получи доступ к вакансиям на 100% удалёнку'].join('\n'),
    about_message: [
      'Забудьте про поиск работы вручную.',
      '',
      'У вас будет личный карьерный агент.',
      'Мы используем гибридную модель: человек-агент + ИИ.',
      '',
      'Что это значит на практике:',
      '- ИИ ищет релевантные remote вакансии и готовит отклики',
      '- Человек-агент проверяет качество и помогает там, где нужна ручная работа',
      '',
      'Если у сайта или бирж труда есть политика против автооткликов,',
      'или есть риск блокировки за автоматизацию — отклик делает человек-агент.',
      '',
      'Если таких ограничений нет, отклик отправляет ИИ-агент.',
      '',
      'Вы получаете скорость ИИ и надежность ручной проверки в одном процессе.',
      '',
      'Когда от вас потребуется действие, мы сразу напишем.',
      '',
      'Отчеты о проделанных откликах всегда доступны в разделе мои отклики',
    ].join('\n'),

    btn_open_jobs: 'Открыть вакансии',
    btn_subscribe_channel: '✈️ Подписаться на канал',
    btn_subscribed_confirm: '✅ Я подписался',
    start_channel_gate: [
      '<b>Подпишись на канал, для старта</b>',
      '',
      '',
      'Мы фильтруем <b>10 000+ вакансий в день</b> — это требует серьёзных ресурсов. Подписка на канал помогает нам покрывать часть расходов, чтобы сервис оставался максимально доступным для вас.',
    ].join('\n'),

    plans_intro:
      'Выберите формат оплаты через Telegram Stars. Нажмите Pricing, чтобы посмотреть доступные тарифы и описание.',
    btn_pricing: 'Pricing',
    plans_unavailable: 'Платные тарифы временно недоступны.',
    plans_menu_header: 'Тарифы:\n{details}\n\nВыберите подписку для оплаты в Telegram Stars:',
    plan_line:
      '• {name}: {opens} открытий/мес, {days} дней, {price}, {ai}',
    plan_ai_included: 'AI CV + Cover Letter включены',
    plan_ai_not_included: 'AI CV + Cover Letter не включены',
    plan_button: '{name} · {opens} открытий/мес · {price}',

    private_chat_only: 'Команда доступна только в личном чате с ботом.',
    scenario_private_only: 'Этот сценарий доступен только в личном чате с ботом.',
    user_not_found: 'Не удалось определить пользователя.',
    start_user_not_found: 'Не удалось определить пользователя. Откройте /start еще раз.',

    referral_invite: 'Пригласите друга и получите +{bonus} открытий вакансий.',
    referral_invited: 'Уже приглашено: {count}',
    referral_link_unavailable: 'Реферальная ссылка временно недоступна.',
    btn_share_referral: 'Поделиться ссылкой',
    referral_share_text: 'Привет! Попробуй бот для поиска удаленной работы:',
    referral_bonus_notify:
      '🎉 Ваш друг запустил бота по вашей ссылке. Начислено +{granted} открытий вакансий.',

    plan_not_payable: 'Этот тариф недоступен для оплаты.',
    plan_code_missing: 'Не удалось определить тариф для оплаты.',
    invoice_failed: 'Не удалось выставить счёт. Попробуйте позже.{details}',

    hireagent_send_cv:
      'Отправьте резюме файлом (PDF или изображение) — я разберу его и начну работу.\nКогда потребуются действия, я напишу.',

    position_service_unavailable: 'Сервис вакансий временно недоступен. Попробуйте позже.',
    position_not_found: 'Вакансия не найдена или уже архивирована.',
    position_header: 'Вакансия: {title}\nКомпания: {company}',
    position_website: 'Сайт компании: {website}',
    btn_apply_external: 'Откликнуться на сайте {company}',
    btn_apply_external_generic: 'Откликнуться на сайте работодателя',
    btn_open_other_jobs: 'Открыть другие вакансии на 100% удалёнку',
    position_send_cv_html: '<b>Чтобы откликнуться, отправьте резюме файлом PDF.</b>',

    subscribe_success: 'Спасибо! Подписка подтверждена.',
    subscribe_bonus: 'Начислено +{bonus} открытий вакансий.',
    subscribe_access: 'Доступ к вакансиям открыт.',

    jobsearch_intro:
      'Ищите удаленные вакансии, отмечайте релевантные роли и открывайте детали прямо в мини-приложении.',
    btn_jobsearch: 'Открыть поиск вакансий',
    jobsearch_https_error:
      'Страница поиска вакансий требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).',

    applications_title: 'Мои отклики',
    btn_applications: 'Мои отклики',
    applications_https_error:
      'Страница откликов требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).',

    cvscore_private_only: 'Эта команда доступна только в личном чате с ботом.',
    cvscore_prompt:
      'Отправьте ваше резюме файлом (PDF/TXT).\nЯ оценю CV как HR-эксперт, дам комментарии и верну улучшенную ATS-friendly версию.',
    btn_try_hireagent: 'Отправить резюме и попробовать',

    hireagent_sim_disabled:
      'Симуляция откликов сейчас отключена. Мы сообщим вам по результатам проверки резюме.',
    hireagent_need_cv_first: 'Сначала пройдите шаг с резюме в диалоге с агентом (/hireagent).',
    hireagent_decline_later:
      'Хорошо. Когда будете готовы — снова выберите «Делегировать отклики» в меню.',

    resume_unrecognized: 'Не удалось распознать файл резюме. Отправьте PDF или изображение еще раз.',
    resume_uploading: 'Спасибо! Загружаю и анализирую резюме…',
    cvscore_pdf_only:
      'Для CV score сейчас поддерживаются PDF/TXT файлы. Пожалуйста, отправьте резюме в PDF.',
    cvscore_extract_failed:
      'Не удалось извлечь текст из резюме. Попробуйте отправить PDF с текстовым слоем.',
    cvscore_received_choice:
      '✅ Резюме получено! Что хотите сделать?\n\n🌟 *Просто улучшить резюме* — анализ и ATS-friendly версия.\n\n💼 *На основе требований вакансии* — CV под конкретную вакансию.',
    btn_cv_improve_simple: '🌟 Просто улучшить резюме',
    btn_cv_improve_job: '💼 На основе требований вакансии',

    position_resume_accepted:
      '✅ Ваше резюме по этой вакансии получено.\n\nРекрутер позиции рассмотрит его. Если решит двигаться дальше, свяжется с вами здесь в Telegram или по контактам, которые вы указали.\n\nПока можно посмотреть другие открытые вакансии.',
    hireagent_found_jobs:
      'Готово. Я сохранил ваше резюме и нашёл 263 вакансии с полной удалёнкой (100%), которые вам подходят.\n\nЗапустить автоматические отклики?',
    btn_hireagent_yes: 'Да, начинай',
    btn_hireagent_no: 'Нет, позже',
    hireagent_resume_submitted:
      'Резюме принято. Мы передали его на проверку — свяжемся с вами с обратной связью.',
    cvscore_process_failed:
      'Не удалось обработать резюме для CV score. Попробуйте еще раз через минуту.',
    resume_save_failed:
      'Не удалось сохранить резюме. Проверьте настройки Azure Storage (AZURE_STORAGE_CONNECTION_STRING) и попробуйте снова.',

    profile_open: 'Открыть настройки:',
    btn_profile_settings: 'Настройки',
    profile_https_error:
      'Страница настроек требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).',

    companies_open: 'Открыть компании с удалёнкой:',
    btn_companies: 'Компании с удалёнкой',
    companies_https_error:
      'Страница компаний требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).',

    news_text:
      'Получайте последние новости про удалённую жизнь, релокацию и общение с единомышленниками.\n\nСообщество Digital nomads. Work from anywhere:',
    btn_news_read: 'Ознакомиться',

    payment_plan_not_found: 'Оплата получена, но тариф не найден. Напишите в поддержку.',
    payment_already_credited: 'Оплата уже была зачислена ранее. Подписка активна.',
    payment_user_not_found: 'Не удалось определить пользователя для зачисления подписки.',
    payment_subscriptions_unavailable:
      'Оплата получена, но таблица подписок недоступна. Напишите в поддержку.',
    payment_success: '✅ Оплата получена. Подписка {plan} активна до {until}.',
    payment_processing_failed:
      'Оплата получена, но автозачисление не завершилось. Напишите в поддержку.',

    awaiting_cv_text: 'Пожалуйста, отправьте резюме файлом (PDF или изображение), а не текстом.',
    cv_analyzing: 'Провожу HR-анализ и улучшаю структуру резюме…',
    cv_analyze_failed: 'Не удалось проанализировать резюме. Попробуйте ещё раз.',
    cv_report_open: 'Открыть полный отчет CV Score:',
    btn_cv_report: '📊 Открыть полный отчет',
    cv_enhanced_ready: 'Готово! Вот ваша улучшенная ATS-friendly версия резюме:',
    btn_cv_download: '⬇ Скачать улучшенное резюме',
    cv_enhance_failed: 'Не удалось сгенерировать улучшенное резюме. Попробуйте ещё раз.',
    awaiting_job_desc: '📋 Отправьте текст вакансии, под которую нужно адаптировать резюме:',
    job_desc_too_short: 'Текст слишком короткий. Пожалуйста, вставьте полное описание вакансии.',
    tailoring_cv: '⏳ Адаптирую резюме под вакансию…',
    tailored_ready: '✅ Готово! Вот ваше адаптированное резюме:',
    btn_tailored_download: '⬇ Скачать резюме',
    tailored_failed: 'Не удалось сгенерировать резюме. Попробуйте ещё раз.',
    choose_option_above: 'Пожалуйста, выберите один из вариантов выше.',

    hireagent_applying_start:
      '⏳ Запускаю автоматические отклики…\nСтатус: подготовка\n\nВакансии ({count}):\n{list}',
    hireagent_applying_status: 'Статус: отправка отклика…\nСейчас: {role} — {company}\n\n{list}',
    hireagent_applying_done: '✅ Первая партия откликов завершена (демо).\n\n{list}',
    hireagent_continue_message:
      'Я откликнулся на первые 10 позиций. Резюме и сопроводительные письма были адаптированы под каждую вакансию.\n\nПроверьте почту — возможно, уже есть письма от работодателей.\n\nЧтобы продолжить, купите подписку.',
    btn_continue: 'Продолжить',

    invoice_title: '{name} — {opens} открытий/мес — {price}',
    invoice_description:
      '{name}: {opens} открытий вакансий в месяц на {days} дней. {ai} Цена: {price}. Оплата через Telegram Stars.',
    invoice_price_label: '{name} ({days} дней)',
  },

  en: {
    start_intro: ['Hi', '', 'Get access to 100% remote job listings'].join('\n'),
    about_message: [
      'Forget about searching for jobs manually.',
      '',
      'You will have a personal career agent.',
      'We use a hybrid model: human agent + AI.',
      '',
      'What this means in practice:',
      '- AI finds relevant remote jobs and prepares applications',
      '- A human agent checks quality and helps where manual work is needed',
      '',
      'If a job board or company site prohibits auto-applications,',
      'or there is a risk of blocking due to automation — a human agent applies.',
      '',
      'When there are no such restrictions, the AI agent applies.',
      '',
      'You get AI speed and the reliability of human review in one process.',
      '',
      'When we need action from you, we will message you right away.',
      '',
      'Reports on submitted applications are always available in My applications',
    ].join('\n'),

    btn_open_jobs: 'Open jobs',
    btn_subscribe_channel: '✈️ Subscribe to channel',
    btn_subscribed_confirm: '✅ I subscribed',
    start_channel_gate: [
      '<b>Subscribe to the channel to get started</b>',
      '',
      '',
      'We filter <b>10,000+ jobs per day</b> — that takes serious resources. Subscribing to the channel helps us cover part of the costs so the service stays as accessible as possible for you.',
    ].join('\n'),

    plans_intro:
      'Choose payment via Telegram Stars. Tap Pricing to see available plans and descriptions.',
    btn_pricing: 'Pricing',
    plans_unavailable: 'Paid plans are temporarily unavailable.',
    plans_menu_header: 'Plans:\n{details}\n\nChoose a subscription to pay with Telegram Stars:',
    plan_line: '• {name}: {opens} opens/mo, {days} days, {price}, {ai}',
    plan_ai_included: 'AI CV + Cover Letter included',
    plan_ai_not_included: 'AI CV + Cover Letter not included',
    plan_button: '{name} · {opens} opens/mo · {price}',

    private_chat_only: 'This command is only available in a private chat with the bot.',
    scenario_private_only: 'This flow is only available in a private chat with the bot.',
    user_not_found: 'Could not identify the user.',
    start_user_not_found: 'Could not identify the user. Open /start again.',

    referral_invite: 'Invite a friend and get +{bonus} job opens.',
    referral_invited: 'Already invited: {count}',
    referral_link_unavailable: 'Referral link is temporarily unavailable.',
    btn_share_referral: 'Share link',
    referral_share_text: 'Hi! Try this bot for remote job search:',
    referral_bonus_notify:
      '🎉 Your friend started the bot via your link. +{granted} job opens credited.',

    plan_not_payable: 'This plan is not available for payment.',
    plan_code_missing: 'Could not determine the plan to pay for.',
    invoice_failed: 'Could not create an invoice. Try again later.{details}',

    hireagent_send_cv:
      'Send your resume as a file (PDF or image) — I will parse it and get started.\nI will message you when we need your input.',

    position_service_unavailable: 'Job service is temporarily unavailable. Try again later.',
    position_not_found: 'Job not found or already archived.',
    position_header: 'Job: {title}\nCompany: {company}',
    position_website: 'Company website: {website}',
    btn_apply_external: 'Apply on {company} website',
    btn_apply_external_generic: 'Apply on employer website',
    btn_open_other_jobs: 'Open other 100% remote jobs',
    position_send_cv_html: '<b>To apply, send your resume as a PDF file.</b>',

    subscribe_success: 'Thank you! Subscription confirmed.',
    subscribe_bonus: '+{bonus} job opens credited.',
    subscribe_access: 'Access to jobs is unlocked.',

    jobsearch_intro:
      'Search remote jobs, mark relevant roles, and open details right in the mini app.',
    btn_jobsearch: 'Open job search',
    jobsearch_https_error:
      'Job search page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).',

    applications_title: 'My applications',
    btn_applications: 'My applications',
    applications_https_error:
      'Applications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).',

    cvscore_private_only: 'This command is only available in a private chat with the bot.',
    cvscore_prompt:
      'Send your resume as a file (PDF/TXT).\nI will review it as an HR expert, give feedback, and return an improved ATS-friendly version.',
    btn_try_hireagent: 'Send resume and try',

    hireagent_sim_disabled:
      'Application simulation is currently disabled. We will contact you after resume review.',
    hireagent_need_cv_first: 'Complete the resume step in the agent dialog first (/hireagent).',
    hireagent_decline_later:
      'OK. When you are ready — choose “Delegate applications” in the menu again.',

    resume_unrecognized: 'Could not recognize the resume file. Send a PDF or image again.',
    resume_uploading: 'Thanks! Uploading and analyzing your resume…',
    cvscore_pdf_only: 'CV score currently supports PDF/TXT files. Please send a PDF resume.',
    cvscore_extract_failed:
      'Could not extract text from the resume. Try sending a PDF with a text layer.',
    cvscore_received_choice:
      '✅ Resume received! What would you like to do?\n\n🌟 *Just improve resume* — analysis and ATS-friendly version.\n\n💼 *Based on job requirements* — CV tailored to a specific job.',
    btn_cv_improve_simple: '🌟 Just improve resume',
    btn_cv_improve_job: '💼 Based on job requirements',

    position_resume_accepted:
      '✅ We received your resume for this role.\n\nThe recruiter will review it. If they decide to move forward, they will contact you here in Telegram or using the contact details you provided.\n\nIn the meantime, feel free to browse other open positions.',
    hireagent_found_jobs:
      'Done. I saved your resume and found 263 fully remote (100%) jobs that match you.\n\nStart automatic applications?',
    btn_hireagent_yes: 'Yes, start',
    btn_hireagent_no: 'Not now',
    hireagent_resume_submitted:
      'Resume received. We sent it for review — we will get back to you with feedback.',
    cvscore_process_failed: 'Could not process resume for CV score. Try again in a minute.',
    resume_save_failed:
      'Could not save resume. Check Azure Storage settings (AZURE_STORAGE_CONNECTION_STRING) and try again.',

    profile_open: 'Open settings:',
    btn_profile_settings: 'Settings',
    profile_https_error:
      'Settings page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).',

    companies_open: 'Open remote-friendly companies:',
    btn_companies: 'Remote companies',
    companies_https_error:
      'Companies page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).',

    news_text:
      'Get the latest news on remote life, relocation, and connecting with like-minded people.\n\nDigital nomads community. Work from anywhere:',
    btn_news_read: 'Learn more',

    payment_plan_not_found: 'Payment received, but plan not found. Contact support.',
    payment_already_credited: 'Payment was already credited. Subscription is active.',
    payment_user_not_found: 'Could not identify user to credit subscription.',
    payment_subscriptions_unavailable:
      'Payment received, but subscriptions table is unavailable. Contact support.',
    payment_success: '✅ Payment received. {plan} subscription active until {until}.',
    payment_processing_failed:
      'Payment received, but auto-credit did not complete. Contact support.',

    awaiting_cv_text: 'Please send your resume as a file (PDF or image), not as text.',
    cv_analyzing: 'Running HR analysis and improving resume structure…',
    cv_analyze_failed: 'Could not analyze resume. Please try again.',
    cv_report_open: 'Open full CV Score report:',
    btn_cv_report: '📊 Open full report',
    cv_enhanced_ready: 'Done! Here is your improved ATS-friendly resume:',
    btn_cv_download: '⬇ Download improved resume',
    cv_enhance_failed: 'Could not generate improved resume. Please try again.',
    awaiting_job_desc: '📋 Send the job text you want to tailor the resume for:',
    job_desc_too_short: 'Text is too short. Please paste the full job description.',
    tailoring_cv: '⏳ Tailoring resume to the job…',
    tailored_ready: '✅ Done! Here is your tailored resume:',
    btn_tailored_download: '⬇ Download resume',
    tailored_failed: 'Could not generate resume. Please try again.',
    choose_option_above: 'Please choose one of the options above.',

    hireagent_applying_start:
      '⏳ Starting automatic applications…\nStatus: preparing\n\nJobs ({count}):\n{list}',
    hireagent_applying_status: 'Status: sending application…\nCurrent: {role} — {company}\n\n{list}',
    hireagent_applying_done: '✅ First batch of applications completed (demo).\n\n{list}',
    hireagent_continue_message:
      'I applied to the first 10 roles. Resumes and cover letters were tailored for each job.\n\nCheck your email — you may already have messages from employers.\n\nTo continue, buy a subscription.',
    btn_continue: 'Continue',

    invoice_title: '{name} — {opens} opens/mo — {price}',
    invoice_description:
      '{name}: {opens} job opens per month for {days} days. {ai} Price: {price}. Payment via Telegram Stars.',
    invoice_price_label: '{name} ({days} days)',
  },
};

/** @type {Record<BotLang, Array<{ command: string, description: string }>>} */
export const BOT_MENU_COMMANDS = {
  ru: [
    { command: 'start', description: 'Вакансии на удалёнку' },
    { command: 'cvscore', description: 'Проверка и улучшение резюме' },
    { command: 'companies', description: 'Компании с удалёнкой' },
    { command: 'referrals', description: 'Реферальная программа' },
    { command: 'news', description: 'Новости про релокацию, удалёнку и ИИ' },
  ],
  en: [
    { command: 'start', description: '100% remote jobs' },
    { command: 'cvscore', description: 'Resume review and improvement' },
    { command: 'companies', description: 'Remote-friendly companies' },
    { command: 'referrals', description: 'Referral program' },
    { command: 'news', description: 'News on relocation, remote work & AI' },
  ],
};
