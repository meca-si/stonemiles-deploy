// i18n.ts — STONEMILES multi-language framework (x's order, 2026-11-06).
//
// English is the SOURCE language. Every other language is a catalogue
// layered over it: a string that has no translation in the chosen
// language falls back to the English original, so a missing string is
// never a blank or a guess. Adding a language later is a catalogue
// job (add a column below), not a code change.
//
// Two catalogue shapes, both in this file:
//  - PAIRS — keyed by the exact English source string. The app's
//    long-standing tr(en, es) helper routes through pairText(), so
//    every screen that already carried an English/Spanish pair gains
//    Portuguese / Russian / Ukrainian for any string catalogued here,
//    with zero call-site changes.
//  - STRINGS — keyed by a stable key ("settings.language",
//    "meca.takeMeThere", …) for surfaces that never had a pair
//    (Settings labels, Ask Meca framing, console sections, the
//    English-governs note, panel headings in sibling modules).
//
// HONESTY BOUNDARIES (locked with the feature):
//  - Legal / regulatory / safety-governing text is NEVER replaced by
//    a translation: the English original stays on screen and the
//    translation rides alongside with the govern.note line ("the
//    English text governs") in the chosen language. See AtlasPanel
//    and PermitsPanel.
//  - Sealed records and exports stay in the language they were
//    recorded in — nothing here retro-translates stored data.
//  - Numbers, dates' VALUES, and units never change with language:
//    miles, °F, and lbs stay US trucking conventions. Only date/time
//    FORMATTING follows the language (localeFor / fmtDateTime).

export type Lang = "en" | "es" | "pt" | "ru" | "uk";

export const LANGS: readonly Lang[] = ["en", "es", "pt", "ru", "uk"] as const;

export const LANG_META: Record<Lang, { name: string; native: string; locale: string }> = {
  en: { name: "English", native: "English", locale: "en-US" },
  es: { name: "Spanish", native: "Español", locale: "es-US" },
  pt: { name: "Portuguese", native: "Português", locale: "pt-BR" },
  ru: { name: "Russian", native: "Русский", locale: "ru-RU" },
  uk: { name: "Ukrainian", native: "Українська", locale: "uk-UA" },
};

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "es" || v === "pt" || v === "ru" || v === "uk";
}

/** Coerce any stored value to a Lang, defaulting to the source. */
export function asLang(v: unknown): Lang {
  return isLang(v) ? v : "en";
}

/** BCP-47 locale for date/time formatting in this language. */
export function localeFor(lang: Lang): string {
  return LANG_META[lang].locale;
}

/** Format a date in the language's own format — the VALUE never changes. */
export function fmtDate(lang: Lang, d: Date): string {
  return d.toLocaleDateString(localeFor(lang));
}

/** Format a date + time in the language's own format. */
export function fmtDateTime(lang: Lang, d: Date): string {
  return d.toLocaleString(localeFor(lang));
}

// ---------------------------------------------------------------------
// PAIRS — translations keyed by the exact English source string.
// Spanish for these strings lives at the tr() call sites (the app's
// original pair); a PAIRS entry may also carry `es` for strings whose
// call site passes no literal. Lookup order: chosen language →
// Spanish literal (es only) → English source.
// ---------------------------------------------------------------------

export type PairEntry = Partial<Record<Exclude<Lang, "en">, string>>;

export const PAIRS: Record<string, PairEntry> = {
  // --- Bottom dock / tabs -------------------------------------------
  "Today": { pt: "Hoje", ru: "Сегодня", uk: "Сьогодні" },
  "Drive": { pt: "Dirigir", ru: "В путь", uk: "В дорогу" },
  "Loads": { pt: "Cargas", ru: "Грузы", uk: "Вантажі" },
  "Money": { pt: "Dinheiro", ru: "Деньги", uk: "Гроші" },
  "More": { pt: "Mais", ru: "Ещё", uk: "Ще" },
  "Routes": { pt: "Rotas", ru: "Маршруты", uk: "Маршрути" },
  "Trips": { pt: "Viagens", ru: "Рейсы", uk: "Рейси" },
  "Driver": { pt: "Motorista", ru: "Водитель", uk: "Водій" },
  "Settings": { pt: "Ajustes", ru: "Настройки", uk: "Налаштування" },
  "Plans": { pt: "Planos", ru: "Тарифы", uk: "Тарифи" },
  "Atlas": { pt: "Atlas", ru: "Атлас", uk: "Атлас" },
  "Fuel": { pt: "Diesel", ru: "Топливо", uk: "Пальне" },
  "Parking": { pt: "Estacionamento", ru: "Стоянка", uk: "Стоянка" },
  "🅿️ Parking": { pt: "🅿️ Estacionamento", ru: "🅿️ Стоянка", uk: "🅿️ Стоянка" },
  "Pay Book": { pt: "Livro de Pagamentos", ru: "Книга выплат", uk: "Книга виплат" },
  "My Desk": { pt: "Minha Mesa", ru: "Мой стол", uk: "Мій стіл" },
  "Open My Desk": { pt: "Abrir Minha Mesa", ru: "Открыть «Мой стол»", uk: "Відкрити «Мій стіл»" },
  "Broker Desk": { pt: "Mesa do Corretor", ru: "Стол брокера", uk: "Стіл брокера" },
  "Open Broker Desk": { pt: "Abrir a Mesa do Corretor", ru: "Открыть стол брокера", uk: "Відкрити стіл брокера" },
  "Owner Desk": { pt: "Mesa do Proprietário", ru: "Стол владельца", uk: "Стіл власника" },
  "Open Owner Desk": { pt: "Abrir a Mesa do Proprietário", ru: "Открыть стол владельца", uk: "Відкрити стіл власника" },
  "Open Board": { pt: "Quadro Aberto", ru: "Открытая биржа", uk: "Відкрита біржа" },
  "Shipper Portal": { pt: "Portal do Embarcador", ru: "Портал грузоотправителя", uk: "Портал відправника" },
  "Broker Portal": { pt: "Portal do Corretor", ru: "Портал брокера", uk: "Портал брокера" },
  "Document vault": { pt: "Cofre de documentos", ru: "Хранилище документов", uk: "Сховище документів" },
  "Safety Academy": { pt: "Academia de Segurança", ru: "Академия безопасности", uk: "Академія безпеки" },
  "DOT Inspection": { pt: "Inspeção DOT", ru: "Проверка DOT", uk: "Перевірка DOT" },
  "Verify & Audit": { pt: "Verificar e Auditar", ru: "Проверка и аудит", uk: "Перевірка й аудит" },
  "OS/OW Permits": { pt: "Licenças OS/OW", ru: "Разрешения OS/OW", uk: "Дозволи OS/OW" },
  "Settlement Checker": { pt: "Conferente de Liquidações", ru: "Проверка расчётов", uk: "Перевірка розрахунків" },
  "Open the Settlement Checker": { pt: "Abrir o Conferente de Liquidações", ru: "Открыть проверку расчётов", uk: "Відкрити перевірку розрахунків" },
  "Getting started": { pt: "Primeiros passos", ru: "Начало работы", uk: "Початок роботи" },
  "Full menu": { pt: "Menu completo", ru: "Полное меню", uk: "Повне меню" },
  "Everything else": { pt: "Todo o resto", ru: "Всё остальное", uk: "Все інше" },
  "Show less of More": { pt: "Mostrar menos de Mais", ru: "Показать меньше", uk: "Показати менше" },
  "Show everything else in More": { pt: "Mostrar todo o resto em Mais", ru: "Показать всё остальное", uk: "Показати все інше" },

  // --- Tool directory (dashboard cleanup, 2026-11-06): the five
  // group names, the group contents lines (Today's Find-a-tool rows),
  // and every directory label — one name per tool in all five
  // languages, shared by the dashboard, the More menu, and (through
  // DEST_LABELS) Ask Meca. Pinned by toolDirectory.test.ts.
  "Loads & Money": { pt: "Cargas e Dinheiro", ru: "Грузы и деньги", uk: "Вантажі і гроші" },
  "Truck & Trailer": { pt: "Caminhão e Reboque", ru: "Грузовик и прицеп", uk: "Вантажівка і причіп" },
  "Records & Taxes": { pt: "Registros e Impostos", ru: "Записи и налоги", uk: "Записи і податки" },
  "More & Settings": { pt: "Mais e Ajustes", ru: "Ещё и настройки", uk: "Ще і налаштування" },
  "Map, routes, fuel, weather, scales, parking, Atlas": { pt: "Mapa, rotas, diesel, clima, balanças, estacionamento, Atlas", ru: "Карта, маршруты, топливо, погода, весы, стоянка, Атлас", uk: "Мапа, маршрути, пальне, погода, ваги, стоянка, Атлас" },
  "Loads, pay owed to you, true rate, claims, pay book": { pt: "Cargas, o que te devem, taxa real, reclamações, livro de pagamentos", ru: "Грузы, кто вам должен, реальная ставка, претензии, книга выплат", uk: "Вантажі, хто вам винен, реальна ставка, претензії, книга виплат" },
  "Trailer tools, maintenance, breakdown, scale tickets": { pt: "Ferramentas do reboque, manutenção, pane, tickets de balança", ru: "Инструменты прицепа, обслуживание, поломка, весовые талоны", uk: "Інструменти причепа, обслуговування, поломка, вагові талони" },
  "Trip sheets, IFTA, taxes, documents, hours": { pt: "Folhas de viagem, IFTA, impostos, documentos, horas", ru: "Путевые листы, IFTA, налоги, документы, часы", uk: "Шляхові листи, IFTA, податки, документи, години" },
  "Chat, driver profile, plans, settings, language": { pt: "Chat, perfil do motorista, planos, ajustes, idioma", ru: "Чат, профиль водителя, тарифы, настройки, язык", uk: "Чат, профіль водія, тарифи, налаштування, мова" },
  "Find a tool": { pt: "Encontre uma ferramenta", ru: "Найти инструмент", uk: "Знайти інструмент" },
  "Every tool in the app, grouped — two taps to anything": { pt: "Todas as ferramentas do app, agrupadas — dois toques para qualquer uma", ru: "Все инструменты приложения, по группам — два касания до любого", uk: "Всі інструменти застосунку, за групами — два дотики до будь-якого" },
  "Drive map": { pt: "Mapa de direção", ru: "Карта вождения", uk: "Мапа водіння" },
  "Route weather": { pt: "Clima na rota", ru: "Погода на маршруте", uk: "Погода на маршруті" },
  "Satellite view & tilt": { pt: "Vista de satélite e inclinação", ru: "Спутниковый вид и наклон", uk: "Супутниковий вигляд і нахил" },
  "Sign check": { pt: "Checagem de placas", ru: "Проверка знаков", uk: "Перевірка знаків" },
  "Weigh stations": { pt: "Postos de pesagem", ru: "Весовые станции", uk: "Вагові станції" },
  "Hill grade alerts": { pt: "Alertas de inclinação", ru: "Предупреждения об уклоне", uk: "Попередження про ухил" },
  "Scales finder": { pt: "Encontrar uma balança", ru: "Найти весы", uk: "Знайти ваги" },
  "Night parking": { pt: "Estacionamento noturno", ru: "Ночная стоянка", uk: "Нічна стоянка" },
  "Load tracker": { pt: "Rastreador de cargas", ru: "Трекер грузов", uk: "Трекер вантажів" },
  "Detention pay": { pt: "Pagamento por detenção", ru: "Оплата простоя", uk: "Оплата простою" },
  "Facility memory": { pt: "Memória de instalações", ru: "Память объектов", uk: "Пам'ять об'єктів" },
  "Who owes me": { pt: "Quem me deve", ru: "Кто мне должен", uk: "Хто мені винен" },
  "True rate": { pt: "Taxa real", ru: "Реальная ставка", uk: "Реальна ставка" },
  "TONU & layover logger": { pt: "Registro de TONU e layover", ru: "Журнал TONU и layover", uk: "Журнал TONU і layover" },
  "Wallet & points": { pt: "Carteira e pontos", ru: "Кошелёк и баллы", uk: "Гаманець і бали" },
  "Fleet board": { pt: "Quadro da frota", ru: "Биржа парка", uk: "Біржа парку" },
  "Broker Inbox": { pt: "Caixa do corretor", ru: "Входящие брокера", uk: "Вхідні брокера" },
  "Trailer tools": { pt: "Ferramentas do reboque", ru: "Инструменты прицепа", uk: "Інструменти причепа" },
  "Maintenance countdown": { pt: "Contagem de manutenção", ru: "Обратный отсчёт обслуживания", uk: "Зворотний відлік обслуговування" },
  "Breakdown mode": { pt: "Modo pane", ru: "Режим поломки", uk: "Режим поломки" },
  "Scale tickets": { pt: "Tickets de balança", ru: "Весовые талоны", uk: "Вагові талони" },
  "IFTA estimator": { pt: "Estimador IFTA", ru: "Оценка IFTA", uk: "Оцінка IFTA" },
  "Tax records": { pt: "Registros de impostos", ru: "Налоговые записи", uk: "Податкові записи" },
  "Library": { pt: "Biblioteca", ru: "Библиотека", uk: "Бібліотека" },
  "Document expiry wallet": { pt: "Carteira de vencimentos", ru: "Кошелёк сроков документов", uk: "Гаманець строків документів" },
  "Hours & HOS": { pt: "Horas / HOS", ru: "Часы / HOS", uk: "Години / HOS" },
  "Chat": { pt: "Chat", ru: "Чат", uk: "Чат" },
  "STONEMILES SI": { pt: "STONEMILES SI (superinteligente)", ru: "STONEMILES SI (суперинтеллект)", uk: "STONEMILES SI (суперінтелект)" },
  "Live updates": { pt: "Atualizações ao vivo", ru: "Живые обновления", uk: "Живі оновлення" },
  "Road learning": { pt: "Aprendizado de rotas", ru: "Изучение дорог", uk: "Вивчення доріг" },
  "App language": { pt: "Idioma do app", ru: "Язык приложения", uk: "Мова застосунку" },

  // --- Drive screen --------------------------------------------------
  "Start trip": { pt: "Iniciar viagem", ru: "Начать рейс", uk: "Почати рейс" },
  "Trip running": { pt: "Viagem em andamento", ru: "Рейс идёт", uk: "Рейс триває" },
  "End trip": { pt: "Encerrar a viagem", ru: "Завершить рейс", uk: "Завершити рейс" },
  "End the current trip": { pt: "Encerrar a viagem atual", ru: "Завершить текущий рейс", uk: "Завершити поточний рейс" },
  "End route": { pt: "Encerrar a rota", ru: "Завершить маршрут", uk: "Завершити маршрут" },
  "■ End route": { pt: "■ Encerrar a rota", ru: "■ Завершить маршрут", uk: "■ Завершити маршрут" },
  "End route — stop guidance, voice directions, and rerouting": { pt: "Encerrar a rota — para a orientação, as direções por voz e o recálculo", ru: "Завершить маршрут — остановить навигацию, голосовые подсказки и перестроение", uk: "Завершити маршрут — зупинити навігацію, голосові підказки та перебудову" },
  "Start a route": { pt: "Iniciar uma rota", ru: "Построить маршрут", uk: "Прокласти маршрут" },
  "Start a route — where are you headed": { pt: "Iniciar uma rota — para onde você vai", ru: "Построить маршрут — куда едем", uk: "Прокласти маршрут — куди їдемо" },
  "Where are you headed? Starts from where you are now.": { pt: "Para onde você vai? Começa de onde você está agora.", ru: "Куда едем? Маршрут начнётся оттуда, где вы сейчас.", uk: "Куди їдемо? Маршрут почнеться звідти, де ви зараз." },
  "Search a city, address, or place…": { pt: "Busque uma cidade, endereço ou lugar…", ru: "Ищите город, адрес или место…", uk: "Шукайте місто, адресу або місце…" },
  "Start rolling": { pt: "Começar a rodar", ru: "В путь", uk: "В дорогу" },
  "Rolling": { pt: "Rodando", ru: "В движении", uk: "В русі" },
  "Rolling — open Drive": { pt: "Rodando — abrir Dirigir", ru: "В движении — открыть «В путь»", uk: "В русі — відкрити «В дорогу»" },
  "Open Drive while rolling": { pt: "Abrir Dirigir em movimento", ru: "Открыть «В путь» на ходу", uk: "Відкрити «В дорогу» на ходу" },
  "Show the full app while rolling": { pt: "Mostrar o app completo em movimento", ru: "Показать весь app в движении", uk: "Показати весь застосунок у русі" },
  "Show the full app — Drive Mode returns when you stop and roll again": { pt: "Mostrar o app completo — o Modo Dirigir volta quando você parar e sair de novo", ru: "Показать весь app — режим вождения вернётся, когда вы остановитесь и снова тронетесь", uk: "Показати весь застосунок — режим водіння повернеться, коли ви зупинитеся і знову рушите" },
  "Drive mode": { pt: "Modo dirigir", ru: "Режим вождения", uk: "Режим водіння" },
  "GPS STARTING…": { pt: "GPS INICIANDO…", ru: "GPS ЗАПУСКАЕТСЯ…", uk: "GPS ЗАПУСКАЄТЬСЯ…" },
  "GPS is live — your trip starts itself at 1 mile of movement.": { pt: "O GPS está ativo — sua viagem começa sozinha a 1 milha de movimento.", ru: "GPS работает — рейс начнётся сам через 1 милю движения.", uk: "GPS працює — рейс почнеться сам через 1 милю руху." },
  "GPS is seeking a fix — once it lands, your trip starts itself at 1 mile of movement.": { pt: "O GPS busca sinal — quando encontrar, sua viagem começa sozinha a 1 milha de movimento.", ru: "GPS ищет сигнал — как только найдёт, рейс начнётся сам через 1 милю движения.", uk: "GPS шукає сигнал — щойно знайде, рейс почнеться сам через 1 милю руху." },
  "GPS turns itself on when the app opens and stays on — no switch to find. If this stays up, allow location for this page in your browser settings. Your trip starts itself after 1 mile of movement — and the app asks your duty status, never guesses.": { pt: "O GPS liga sozinho quando o app abre e fica ligado — não há interruptor. Se isto não sair, permita a localização para esta página nas configurações do navegador. Sua viagem começa sozinha após 1 milha de movimento — e o app pergunta seu status de serviço, nunca adivinha.", ru: "GPS включается сам при открытии приложения и остаётся включённым — искать переключатель не нужно. Если это сообщение не уходит, разрешите доступ к геолокации для этой страницы в настройках браузера. Рейс начнётся сам после 1 мили движения — а приложение спросит ваш статус службы, а не будет угадывать.", uk: "GPS вмикається сам при відкритті застосунку і лишається увімкненим — перемикача немає. Якщо це повідомлення не зникає, дозвольте геолокацію для цієї сторінки в налаштуваннях браузера. Рейс почнеться сам після 1 милі руху — а застосунок запитає ваш статус служби, а не вгадуватиме." },
  "Trip paused — resume it": { pt: "Viagem pausada — retomar", ru: "Рейс на паузе — продолжить", uk: "Рейс на паузі — продовжити" },
  "Resume the paused trip": { pt: "Retomar a viagem pausada", ru: "Продолжить рейс на паузе", uk: "Продовжити рейс на паузі" },
  "already logged": { pt: "já registrados", ru: "уже записано", uk: "вже записано" },
  "Offline — records queue and seal in order when you're back.": { pt: "Sem conexão — os registros ficam na fila e são selados em ordem quando você voltar.", ru: "Нет связи — записи встанут в очередь и будут запечатаны по порядку, когда связь вернётся.", uk: "Немає зв'язку — записи стануть у чергу і будуть запечатані по порядку, коли зв'язок повернеться." },
  "Offline map is showing — your saved map tiles. The live map returns when signal does.": { pt: "O mapa offline está aparecendo — seus blocos de mapa salvos. O mapa ao vivo volta com o sinal.", ru: "Показан офлайн-атлас — ваши сохранённые фрагменты карты. Живая карта вернётся вместе с сигналом.", uk: "Показано офлайн-мапу — ваші збережені фрагменти мапи. Жива мапа повернеться разом із сигналом." },
  "Satellite needs signal — the offline map is showing instead. Satellite returns on its own when signal does.": { pt: "O satélite precisa de sinal — o mapa offline está aparecendo no lugar. O satélite volta sozinho com o sinal.", ru: "Спутнику нужен сигнал — вместо него показан офлайн-атлас. Спутник вернётся сам вместе с сигналом.", uk: "Супутнику потрібен сигнал — натомість показано офлайн-мапу. Супутник повернеться сам разом із сигналом." },
  "Current speed": { pt: "Velocidade atual", ru: "Текущая скорость", uk: "Поточна швидкість" },
  "LIMIT": { pt: "LIMITE", ru: "ЛИМИТ", uk: "ЛІМІТ" },
  "Next turn": { pt: "Próxima curva", ru: "Следующий поворот", uk: "Наступний поворот" },
  "Estimated arrival": { pt: "Chegada estimada", ru: "Расчётное прибытие", uk: "Розрахункове прибуття" },
  "ETA — arrive": { pt: "ETA — chegar", ru: "ETA — прибытие", uk: "ETA — прибуття" },
  "TIME LEFT": { pt: "TEMPO RESTANTE", ru: "ОСТАЛОСЬ ВРЕМЕНИ", uk: "ЗАЛИШИЛОСЯ ЧАСУ" },
  "Drive left": { pt: "Restante de direção", ru: "Осталось за рулём", uk: "Залишилося за кермом" },
  "left": { pt: "restantes", ru: "осталось", uk: "залишилося" },
  "to go": { pt: "para chegar", ru: "осталось ехать", uk: "залишилося їхати" },
  "of 11h": { pt: "de 11h", ru: "из 11 ч", uk: "з 11 год" },
  "Cycle": { pt: "Ciclo", ru: "Цикл", uk: "Цикл" },
  "Window": { pt: "Janela", ru: "Смена", uk: "Зміна" },
  "Break in": { pt: "Pausa em", ru: "Перерыв через", uk: "Перерва через" },
  "You've arrived": { pt: "Você chegou", ru: "Вы прибыли", uk: "Ви прибули" },
  "· LAST KNOWN": { pt: "· ÚLTIMA POSIÇÃO", ru: "· ПОСЛЕДНЕЕ ИЗВЕСТНОЕ", uk: "· ОСТАННЄ ВІДОМЕ" },
  " · WITH TRAFFIC": { pt: " · COM TRÂNSITO", ru: " · С ПРОБКАМИ", uk: " · ІЗ ЗАТОРАМИ" },
  "EST": { pt: "EST", ru: "РАСЧ.", uk: "РОЗРАХ." },
  "LEFT": { pt: "ESQUERDA", ru: "НАЛЕВО", uk: "ЛІВОРУЧ" },
  "No route set": { pt: "Sem rota definida", ru: "Маршрут не задан", uk: "Маршрут не задано" },
  "Reroute now": { pt: "Recalcular agora", ru: "Перестроить сейчас", uk: "Перебудувати зараз" },
  "Reroute now — try a fresh reroute from where you are": { pt: "Recalcular agora — tentar um novo cálculo de onde você está", ru: "Перестроить сейчас — попробовать новое перестроение оттуда, где вы находитесь", uk: "Перебудувати зараз — спробувати нову перебудову звідти, де ви перебуваєте" },
  "You're off the planned route — rerouting from here in a few seconds.": { pt: "Você saiu da rota planejada — recalculando daqui em alguns segundos.", ru: "Вы отклонились от маршрута — перестроение отсюда через несколько секунд.", uk: "Ви відхилилися від маршруту — перебудова звідси за кілька секунд." },
  "Reroute isn't settling here — you're still off the planned line. Follow posted signs; automatic rerouting pauses until you're moving again.": { pt: "O recálculo não está assentando aqui — você ainda está fora da linha planejada. Siga as placas; o recálculo automático pausa até você voltar a se mover.", ru: "Перестроение здесь не получается — вы всё ещё вне запланированной линии. Следуйте дорожным знакам; автоматическое перестроение на паузе, пока вы снова не тронетесь.", uk: "Перебудова тут не вдається — ви все ще поза запланованою лінією. Дотримуйтесь дорожніх знаків; автоматична перебудова на паузі, доки ви знову не рушите." },
  "Take the alternate route": { pt: "Pegar a rota alternativa", ru: "Выбрать объезд", uk: "Обрати об'їзд" },
  "Keep my route": { pt: "Manter minha rota", ru: "Остаться на маршруте", uk: "Лишитися на маршруті" },
  " — it routes around the trouble": { pt: " — desvia do problema", ru: " — объезжает проблему", uk: " — об'їжджає проблему" },
  "about the same time as staying": { pt: "quase o mesmo tempo que ficar", ru: "примерно то же время, что остаться", uk: "приблизно той самий час, що лишитися" },
  "Got it": { pt: "Entendi", ru: "Понятно", uk: "Зрозуміло" },
  "Dismiss": { pt: "Dispensar", ru: "Закрыть", uk: "Закрити" },

  // --- Scan ahead / hazards ------------------------------------------
  "Scan ahead (30 min):": { pt: "Verificação à frente (30 min):", ru: "Сканирование впереди (30 мин):", uk: "Сканування попереду (30 хв):" },
  "scanning the road ahead…": { pt: "verificando a estrada à frente…", ru: "сканирую дорогу впереди…", uk: "сканую дорогу попереду…" },
  "warming up…": { pt: "preparando…", ru: "подготовка…", uk: "підготовка…" },
  "clear": { pt: "livre", ru: "чисто", uk: "чисто" },
  "nothing reported in the next": { pt: "nada reportado nos próximos", ru: "ничего не сообщено в следующих", uk: "нічого не повідомлено в наступних" },
  "live traffic adds": { pt: "o trânsito ao vivo adiciona", ru: "живой трафик добавляет", uk: "живий трафік додає" },
  "through this stretch": { pt: "neste trecho", ru: "на этом участке", uk: "на цій ділянці" },
  "report(s) ahead — you're staying on your route": { pt: "relato(s) à frente — você continua na sua rota", ru: "сообщение(я) впереди — вы остаётесь на маршруте", uk: "повідомлення попереду — ви лишаєтеся на маршруті" },
  "checked": { pt: "verificado", ru: "проверено", uk: "перевірено" },
  "Scan now": { pt: "Verificar agora", ru: "Сканировать сейчас", uk: "Сканувати зараз" },
  "Hazard": { pt: "Perigo", ru: "Опасность", uk: "Небезпека" },
  "Report a road hazard": { pt: "Reportar um perigo na estrada", ru: "Сообщить об опасности на дороге", uk: "Повідомити про небезпеку на дорозі" },
  "Reading your sealed records…": { pt: "Lendo seus registros selados…", ru: "Читаю ваши запечатанные записи…", uk: "Читаю ваші запечатані записи…" },

  // --- Today / home ---------------------------------------------------
  "Next load": { pt: "Próxima carga", ru: "Следующий груз", uk: "Наступний вантаж" },
  "No active load": { pt: "Sem carga ativa", ru: "Нет активного груза", uk: "Немає активного вантажу" },
  "Add a load": { pt: "Adicionar uma carga", ru: "Добавить груз", uk: "Додати вантаж" },
  "Add a load from a photo of the BOL or rate con and its next step will live here.": { pt: "Adicione uma carga com uma foto do BOL ou da confirmação de frete e o próximo passo dela fica aqui.", ru: "Добавьте груз по фото BOL или подтверждения ставки — и его следующий шаг появится здесь.", uk: "Додайте вантаж за фото BOL або підтвердження ставки — і його наступний крок з'явиться тут." },
  "Add a load from a photo of the BOL or rate con — its next step will live right here.": { pt: "Adicione uma carga com uma foto do BOL ou da confirmação de frete — o próximo passo dela fica bem aqui.", ru: "Добавьте груз по фото BOL или подтверждения ставки — его следующий шаг появится прямо здесь.", uk: "Додайте вантаж за фото BOL або підтвердження ставки — його наступний крок з'явиться прямо тут." },
  "Active load next step": { pt: "Próximo passo da carga ativa", ru: "Следующий шаг активного груза", uk: "Наступний крок активного вантажу" },
  "Load": { pt: "Carga", ru: "Груз", uk: "Вантаж" },
  "Open load": { pt: "Abrir a carga", ru: "Открыть груз", uk: "Відкрити вантаж" },
  "Next step lives on the load — open it and the one action you need is at the top.": { pt: "O próximo passo está na carga — abra e a única ação que você precisa está no topo.", ru: "Следующий шаг — в грузе: откройте его, и нужное действие будет наверху.", uk: "Наступний крок — у вантажі: відкрийте його, і потрібна дія буде вгорі." },
  "Next step: route it and roll to the pickup.": { pt: "Próximo passo: trace a rota e rode até a coleta.", ru: "Следующий шаг: постройте маршрут и езжайте на загрузку.", uk: "Наступний крок: прокладіть маршрут і їдьте на завантаження." },
  "Next step: keep rolling — seal the delivery at the drop.": { pt: "Próximo passo: continue rodando — sele a entrega na descarga.", ru: "Следующий шаг: продолжайте путь — запечатайте доставку на выгрузке.", uk: "Наступний крок: продовжуйте шлях — запечатайте доставку на розвантаженні." },
  "You're at the drop — seal the delivery and the proof is locked in.": { pt: "Você está na descarga — sele a entrega e a prova fica travada.", ru: "Вы на выгрузке — запечатайте доставку, и доказательство будет зафиксировано.", uk: "Ви на розвантаженні — запечатайте доставку, і доказ буде зафіксовано." },
  "You're inside the delivery area — one more tap seals the proof of delivery.": { pt: "Você está na área de entrega — mais um toque sela a prova de entrega.", ru: "Вы в зоне доставки — ещё одно нажатие запечатает подтверждение доставки.", uk: "Ви в зоні доставки — ще один дотик запечатає підтвердження доставки." },
  "Seal delivery": { pt: "Selar a entrega", ru: "Запечатать доставку", uk: "Запечатати доставку" },
  "Seal a delivery": { pt: "Selar uma entrega", ru: "Запечатать доставку", uk: "Запечатати доставку" },
  "Delivered and sealed — the proof lives in the tracker below.": { pt: "Entregue e selado — a prova fica no rastreador abaixo.", ru: "Доставлено и запечатано — доказательство в трекере ниже.", uk: "Доставлено і запечатано — доказ у трекері нижче." },
  "Fuel plan": { pt: "Plano de diesel", ru: "Топливный план", uk: "Паливний план" },
  "Best NET price on your corridor:": { pt: "Melhor preço LÍQUIDO no seu corredor:", ru: "Лучшая ЧИСТАЯ цена на вашем коридоре:", uk: "Найкраща ЧИСТА ціна на вашому коридорі:" },
  "ahead": { pt: "à frente", ru: "впереди", uk: "попереду" },
  "Net = pump price minus that state's fuel tax — the price that actually matters under IFTA.": { pt: "Líquido = preço da bomba menos o imposto estadual de combustível — o preço que realmente importa no IFTA.", ru: "Чистая цена = цена на колонке минус топливный налог штата — цена, которая действительно важна в IFTA.", uk: "Чиста ціна = ціна на колонці мінус паливний податок штату — ціна, яка справді важлива в IFTA." },
  "Set a route and the cheapest true-cost stop on your corridor shows here.": { pt: "Defina uma rota e a parada de menor custo real do seu corredor aparece aqui.", ru: "Задайте маршрут — и самая дешёвая по реальной цене остановка на вашем коридоре появится здесь.", uk: "Задайте маршрут — і найдешевша за реальною ціною зупинка на вашому коридорі з'явиться тут." },
  "Set a route and the stops along your corridor show on the Fuel tab. The full Net-Price Fuel Planner (net-of-tax ranking) is part of Diamond's full fuel assistance; Gold keeps the basic stops list with prices from your fuel log and labelled driver reports.": { pt: "Defina uma rota e as paradas do seu corredor aparecem na guia de Diesel. O Planejador de Preço Líquido completo (ranking sem imposto) faz parte da assistência completa de combustível do Diamond; o Gold mantém a lista básica de paradas com preços do seu registro de diesel e relatos etiquetados de motoristas.", ru: "Задайте маршрут — и остановки на вашем коридоре появятся на вкладке «Топливо». Полный планировщик чистой цены (рейтинг без налога) — часть полной топливной помощи Diamond; Gold сохраняет базовый список остановок с ценами из вашего топливного журнала и помеченными отчётами водителей.", uk: "Задайте маршрут — і зупинки на вашому коридорі з'являться на вкладці «Пальне». Повний планувальник чистої ціни (рейтинг без податку) — частина повної паливної допомоги Diamond; Gold зберігає базовий список зупинок із цінами з вашого паливного журналу та позначеними звітами водіїв." },
  "Gold keeps the basics: stops along your route — with prices from your own fuel log and labelled driver reports — are on the Fuel tab. The full Net-Price Fuel Planner (net-of-tax ranking) is part of Diamond's full fuel assistance.": { pt: "O Gold mantém o básico: as paradas na sua rota — com preços do seu próprio registro de diesel e relatos etiquetados de motoristas — estão na guia de Diesel. O Planejador de Preço Líquido completo (ranking sem imposto) faz parte da assistência completa de combustível do Diamond.", ru: "Gold сохраняет базу: остановки на вашем маршруте — с ценами из вашего топливного журнала и помеченными отчётами водителей — на вкладке «Топливо». Полный планировщик чистой цены (рейтинг без налога) — часть полной топливной помощи Diamond.", uk: "Gold зберігає базу: зупинки на вашому маршруті — із цінами з вашого паливного журналу та позначеними звітами водіїв — на вкладці «Пальне». Повний планувальник чистої ціни (рейтинг без податку) — частина повної паливної допомоги Diamond." },
  "Fuel stops": { pt: "Paradas de diesel", ru: "Топливные остановки", uk: "Паливні зупинки" },
  "Open fuel stops": { pt: "Abrir paradas de diesel", ru: "Открыть топливные остановки", uk: "Відкрити паливні зупинки" },
  "Find truck parking": { pt: "Buscar estacionamento de caminhão", ru: "Найти стоянку для грузовика", uk: "Знайти стоянку для вантажівки" },
  "Find truck parking ahead": { pt: "Buscar estacionamento à frente", ru: "Найти стоянку впереди", uk: "Знайти стоянку попереду" },
  "Plan my stops": { pt: "Planejar minhas paradas", ru: "Спланировать остановки", uk: "Спланувати зупинки" },
  "Plan my stops — fuel, break, and shutdown planner": { pt: "Planejar minhas paradas — planejador de diesel, pausa e fim do dia", ru: "Спланировать остановки — планировщик топлива, перерывов и стоянки на ночь", uk: "Спланувати зупинки — планувальник пального, перерв і нічної стоянки" },
  "Snap a BOL": { pt: "Foto do BOL", ru: "Фото BOL", uk: "Фото BOL" },
  "Snap a bill of lading or document": { pt: "Fotografar um BOL ou documento", ru: "Сфотографировать BOL или документ", uk: "Сфотографувати BOL або документ" },
  "Log fuel": { pt: "Registrar diesel", ru: "Записать топливо", uk: "Записати пальне" },
  "Log fuel at a stop": { pt: "Registrar diesel numa parada", ru: "Записать топливо на остановке", uk: "Записати пальне на зупинці" },
  "Inspection checklists": { pt: "Listas de inspeção", ru: "Чек-листы осмотра", uk: "Чек-листи огляду" },
  "Walk the truck at both ends of the day — each signed checklist seals into your HOS day and earns its points line.": { pt: "Inspecione o caminhão no começo e no fim do dia — cada lista assinada é selada no seu dia HOS e ganha sua linha de pontos.", ru: "Осматривайте грузовик в начале и в конце дня — каждый подписанный чек-лист запечатывается в ваш день HOS и даёт свою строку баллов.", uk: "Оглядайте вантажівку на початку і в кінці дня — кожен підписаний чек-лист запечатується у ваш день HOS і дає свій рядок балів." },
  "Pre-trip": { pt: "Pré-viagem", ru: "Предрейсовый осмотр", uk: "Передрейсовий огляд" },
  "Open the pre-trip checklist — start of day, earns 50 points": { pt: "Abrir a lista pré-viagem — início do dia, ganha 50 pontos", ru: "Открыть предрейсовый чек-лист — начало дня, даёт 50 баллов", uk: "Відкрити передрейсовий чек-лист — початок дня, дає 50 балів" },
  "Start of day · stamps you On Duty · +50 pts": { pt: "Início do dia · marca você Em Serviço · +50 pts", ru: "Начало дня · ставит «На службе» · +50 баллов", uk: "Початок дня · ставить «На службі» · +50 балів" },
  "Post-trip": { pt: "Pós-viagem", ru: "Послерейсовый осмотр", uk: "Післярейсовий огляд" },
  "Open the post-trip checklist — end of day, earns 25 points": { pt: "Abrir a lista pós-viagem — fim do dia, ganha 25 pontos", ru: "Открыть послерейсовый чек-лист — конец дня, даёт 25 баллов", uk: "Відкрити післярейсовий чек-лист — кінець дня, дає 25 балів" },
  "End of day · +25 pts": { pt: "Fim do dia · +25 pts", ru: "Конец дня · +25 баллов", uk: "Кінець дня · +25 балів" },
  "Perfect day": { pt: "Dia perfeito", ru: "Идеальный день", uk: "Ідеальний день" },
  "Perfect day progress": { pt: "Progresso do dia perfeito", ru: "Прогресс идеального дня", uk: "Прогрес ідеального дня" },
  "Today's points": { pt: "Pontos de hoje", ru: "Баллы за сегодня", uk: "Бали за сьогодні" },
  "of": { pt: "de", ru: "из", uk: "з" },
  "daily tasks done": { pt: "tarefas diárias feitas", ru: "дневных задач выполнено", uk: "денних завдань виконано" },
  "balance": { pt: "saldo", ru: "баланс", uk: "баланс" },
  "Points & $STONER": { pt: "Pontos e $STONER", ru: "Баллы и $STONER", uk: "Бали і $STONER" },
  "Open points and STONER in Money": { pt: "Abrir pontos e STONER em Dinheiro", ru: "Открыть баллы и STONER в «Деньгах»", uk: "Відкрити бали і STONER у «Грошах»" },
  "Post-trip debrief": { pt: "Resumo pós-viagem", ru: "Разбор после рейса", uk: "Розбір після рейсу" },
  "Dismiss the post-trip debrief": { pt: "Dispensar o resumo pós-viagem", ru: "Закрыть разбор после рейса", uk: "Закрити розбір після рейсу" },
  "Breakdown": { pt: "Pane", ru: "Поломка", uk: "Поломка" },
  "🔧 Breakdown": { pt: "🔧 Pane", ru: "🔧 Поломка", uk: "🔧 Поломка" },
  "Breakdown emergency": { pt: "Emergência de pane", ru: "Экстренная поломка", uk: "Екстрена поломка" },

  // --- Money ----------------------------------------------------------
  "Money this week": { pt: "Dinheiro esta semana", ru: "Деньги за эту неделю", uk: "Гроші за цей тиждень" },
  "This week — true net": { pt: "Esta semana — líquido real", ru: "Эта неделя — чистый итог", uk: "Цей тиждень — чистий підсумок" },
  "Revenue": { pt: "Receita", ru: "Выручка", uk: "Виручка" },
  "Cost / mile": { pt: "Custo / milha", ru: "Стоимость / миля", uk: "Вартість / миля" },
  "Nothing logged this week yet. Log fuel and expenses below and your true net — revenue minus fuel and costs — appears here from your own sealed records only.": { pt: "Nada registrado esta semana ainda. Registre diesel e despesas abaixo e seu líquido real — receita menos diesel e custos — aparece aqui, só dos seus próprios registros selados.", ru: "На этой неделе пока ничего не записано. Запишите топливо и расходы ниже — и ваш чистый итог (выручка минус топливо и расходы) появится здесь, только из ваших собственных запечатанных записей.", uk: "Цього тижня поки нічого не записано. Запишіть пальне і витрати нижче — і ваш чистий підсумок (виручка мінус пальне і витрати) з'явиться тут, лише з ваших власних запечатаних записів." },
  "Wallet & $STONER": { pt: "Carteira e $STONER", ru: "Кошелёк и $STONER", uk: "Гаманець і $STONER" },
  "Balances, welcome credits, cash-out, CHIP market — PIN-gated": { pt: "Saldos, créditos de boas-vindas, saque, mercado CHIP — com PIN", ru: "Балансы, приветственные кредиты, вывод, рынок CHIP — по PIN", uk: "Баланси, вітальні кредити, виведення, ринок CHIP — за PIN" },
  "Hide wallet and STONER details": { pt: "Ocultar detalhes da carteira e do STONER", ru: "Скрыть детали кошелька и STONER", uk: "Сховати деталі гаманця і STONER" },
  "Show wallet and STONER details": { pt: "Mostrar detalhes da carteira e do STONER", ru: "Показать детали кошелька и STONER", uk: "Показати деталі гаманця і STONER" },
  "Points and conversion progress": { pt: "Pontos e progresso de conversão", ru: "Баллы и прогресс конвертации", uk: "Бали і прогрес конвертації" },
  "point conversion minimum": { pt: "mínimo de conversão de pontos", ru: "минимум конвертации баллов", uk: "мінімум конвертації балів" },
  "Progress to the points conversion minimum": { pt: "Progresso até o mínimo de conversão de pontos", ru: "Прогресс до минимума конвертации баллов", uk: "Прогрес до мінімуму конвертації балів" },
  "of value, paid in $STONER at the market price": { pt: "de valor, pago em $STONER ao preço de mercado", ru: "стоимости, выплачивается в $STONER по рыночной цене", uk: "вартості, виплачується в $STONER за ринковою ціною" },
  " Reactivate to convert and cash out — your points are still here, retained in full.": { pt: " Reative para converter e sacar — seus pontos continuam aqui, guardados por inteiro.", ru: " Активируйте снова, чтобы конвертировать и вывести — ваши баллы на месте, сохранены полностью.", uk: " Активуйте знову, щоб конвертувати і вивести — ваші бали на місці, збережені повністю." },
  " On the free Basic plan your points are yours — they keep stacking and never expire — and converting unlocks when you upgrade to a paid plan.": { pt: "  No plano Basic gratuito seus pontos são seus — continuam acumulando e nunca expiram — e a conversão libera quando você assina um plano pago.", ru: "  На бесплатном тарифе Basic баллы ваши — они продолжают копиться и никогда не сгорают, а конвертация откроется при переходе на платный тариф.", uk: "  На безкоштовному тарифі Basic бали ваші — вони продовжують накопичуватися і ніколи не згорають, а конвертація відкриється при переході на платний тариф." },

  // --- More-tab launcher subs ------------------------------------------
  "The handful you open every week is right here — everything else in STONEMILES is one tap below it.": { pt: "O que você abre toda semana está bem aqui — todo o resto do STONEMILES está um toque abaixo.", ru: "То, что вы открываете каждую неделю, — прямо здесь; всё остальное в STONEMILES — одним нажатием ниже.", uk: "Те, що ви відкриваєте щотижня, — прямо тут; усе інше в STONEMILES — одним дотиком нижче." },
  "Your dispatcher's desk — your pipeline, your fee, your platform fees": { pt: "A mesa do seu despachante — suas cargas, sua tarifa, seus encargos de plataforma", ru: "Стол вашего диспетчера — ваши грузы, ваша ставка, ваши платформенные сборы", uk: "Стіл вашого диспетчера — ваші вантажі, ваша ставка, ваші платформні збори" },
  "Your poster's desk — your posted loads, your fee, your totals": { pt: "A mesa de quem publica — suas cargas publicadas, sua tarifa, seus totais", ru: "Стол разместившего — ваши опубликованные грузы, ваша ставка, ваши итоги", uk: "Стіл того, хто публікує, — ваші опубліковані вантажі, ваша ставка, ваші підсумки" },
  "Your fleet's command screen — pipeline, review queue, roster, plan, totals": { pt: "A tela de comando da sua frota — cargas, fila de revisão, equipe, plano, totais", ru: "Командный экран вашего парка — грузы, очередь проверки, состав, тариф, итоги", uk: "Командний екран вашого парку — вантажі, черга перевірки, склад, тариф, підсумки" },
  "Truck-legal routes, compared on miles, fuel, tolls, safety, pay": { pt: "Rotas legais para caminhão, comparadas por milhas, diesel, pedágios, segurança e pagamento", ru: "Легальные для грузовиков маршруты — сравнение по милям, топливу, tolls (платным дорогам), безопасности и оплате", uk: "Легальні для вантажівок маршрути — порівняння за милями, пальним, платними дорогами, безпекою та оплатою" },
  "Stops on your corridor, Love's & Pilot/Flying J — full Net-Price Planner on Diamond": { pt: "Paradas no seu corredor, Love's e Pilot/Flying J — Planejador de Preço Líquido completo no Diamond", ru: "Остановки на вашем коридоре, Love's и Pilot/Flying J — полный планировщик чистой цены на Diamond", uk: "Зупинки на вашому коридорі, Love's і Pilot/Flying J — повний планувальник чистої ціни на Diamond" },
  "Fuel + break + shutdown on one timeline — tank, cheapest refuels, your added stops": { pt: "Diesel + pausa + fim do dia numa linha só — tanque, abastecimentos mais baratos, suas paradas", ru: "Топливо + перерывы + ночёвка на одной линии — бак, самые дешёвые заправки, ваши остановки", uk: "Пальне + перерви + ночівля на одній лінії — бак, найдешевші заправки, ваші зупинки" },
  "Trip sheets — miles by state, pay, sealed proof & export": { pt: "Folhas de viagem — milhas por estado, pagamento, prova selada e exportação", ru: "Путевые листы — мили по штатам, оплата, запечатанное доказательство и экспорт", uk: "Шляхові листи — милі за штатами, оплата, запечатаний доказ і експорт" },
  "Every state's road rules — weight limits, length & width, low clearances, weigh stations, DOT & patrol contacts. Works offline": { pt: "As regras de estrada de cada estado — limites de peso, comprimento e largura, alturas baixas, balanças, contatos do DOT e da patrulha. Funciona offline", ru: "Дорожные правила каждого штата — лимиты веса, длина и ширина, низкие мосты, весовые станции, контакты DOT и патруля. Работает офлайн", uk: "Дорожні правила кожного штату — ліміти ваги, довжина і ширина, низькі мости, вагові станції, контакти DOT і патруля. Працює офлайн" },
  "Shippers post loads to RUGGS LOGISTICS — desk reviews, then the board": { pt: "Embarcadores publicam cargas na RUGGS LOGISTICS — a mesa revisa, depois o quadro", ru: "Грузоотправители публикуют грузы в RUGGS LOGISTICS — стол проверяет, потом биржа", uk: "Відправники публікують вантажі в RUGGS LOGISTICS — стіл перевіряє, потім біржа" },
  "Desk-invited brokers post loads to the Open Board under their own name — desk reviews first": { pt: "Corretores convidados pela mesa publicam cargas no Quadro Aberto com seu próprio nome — a mesa revisa primeiro", ru: "Приглашённые столом брокеры публикуют грузы на Открытой бирже под своим именем — стол проверяет первым", uk: "Запрошені столом брокери публікують вантажі на Відкритій біржі під своїм ім'ям — стіл перевіряє першим" },
  "Broker loads & fleet overflow for vetted owner operators — pay runs direct, dispatch fee applies once": { pt: "Cargas de corretores e excedente de frotas para proprietários verificados — pagamento direto, tarifa de despacho uma vez", ru: "Грузы брокеров и переполнение парков для проверенных владельцев — оплата напрямую, диспетчерский сбор один раз", uk: "Вантажі брокерів і переповнення парків для перевірених власників — оплата напряму, диспетчерський збір один раз" },
  "Company chat, groups, DMs, other drivers": { pt: "Chat da empresa, grupos, mensagens diretas, outros motoristas", ru: "Чат компании, группы, личные сообщения, другие водители", uk: "Чат компанії, групи, особисті повідомлення, інші водії" },
  "Duty status, HOS detail, scores, passport, proof & verify": { pt: "Status de serviço, detalhe HOS, pontuações, passaporte, prova e verificação", ru: "Статус службы, детали HOS, очки, паспорт, доказательство и проверка", uk: "Статус служби, деталі HOS, очки, паспорт, доказ і перевірка" },
  "Super Intelligent layer — preps, heals, vets; decisions only, public records only": { pt: "Camada Super Inteligente — prepara, corrige, verifica; só decisões, só registros públicos", ru: "Слой Super Intelligent — готовит, исправляет, проверяет; только решения, только публичные записи", uk: "Шар Super Intelligent — готує, виправляє, перевіряє; лише рішення, лише публічні записи" },
  "Weather on your route — corridor ahead, gusts, tonight at your stop, radar": { pt: "Clima na sua rota — corredor à frente, rajadas, esta noite na sua parada, radar", ru: "Погода на маршруте — коридор впереди, порывы, сегодня ночью на вашей стоянке, радар", uk: "Погода на маршруті — коридор попереду, пориви, сьогодні вночі на вашій стоянці, радар" },
  "Your pay — log pay & per diem, W-2 & 1099 totals, Year-to-Date lane pies, tax packets": { pt: "Seu pagamento — registre pagamento e per diem, totais W-2 e 1099, gráficos do ano por faixa, pacotes de impostos", ru: "Ваша оплата — записывайте выплаты и суточные (per diem), итоги W-2 и 1099, годовые диаграммы по линиям, налоговые пакеты", uk: "Ваша оплата — записуйте виплати і добові (per diem), підсумки W-2 і 1099, річні діаграми за лініями, податкові пакети" },
  "Log a paycheck, add per diem, see your W-2 & 1099 totals, the Year-to-Date lane pies, and tax packets.": { pt: "Registre um pagamento, adicione per diem, veja seus totais W-2 e 1099, os gráficos do ano por faixa e os pacotes de impostos.", ru: "Запишите выплату, добавьте суточные (per diem), смотрите итоги W-2 и 1099, годовые диаграммы по линиям и налоговые пакеты.", uk: "Запишіть виплату, додайте добові (per diem), дивіться підсумки W-2 і 1099, річні діаграми за лініями і податкові пакети." },
  "Open the Pay Book at Log pay": { pt: "Abrir o Livro de Pagamentos em Registrar pagamento", ru: "Открыть Книгу выплат на записи выплаты", uk: "Відкрити Книгу виплат на записі виплати" },
  "CDL, medical card, insurance — renewal reminders": { pt: "CDL, cartão médico, seguro — lembretes de renovação", ru: "CDL, медкарта, страховка — напоминания о продлении", uk: "CDL, медкартка, страховка — нагадування про поновлення" },
  "Scan a permit, file the docket, drive the approved route": { pt: "Escaneie uma licença, arquive o dossiê, dirija a rota aprovada", ru: "Отсканируйте разрешение, заведите досье, езжайте по утверждённому маршруту", uk: "Відскануйте дозвіл, заведіть досьє, їдьте затвердженим маршрутом" },
  "10 courses, quizzes, sealed completion records": { pt: "10 cursos, testes, registros de conclusão selados", ru: "10 курсов, тесты, запечатанные записи о прохождении", uk: "10 курсів, тести, запечатані записи про проходження" },
  "Officer view — 8-day HOS logs, DVIR, verify code": { pt: "Vista do oficial — registros HOS de 8 dias, DVIR, código de verificação", ru: "Вид для офицера — журналы HOS за 8 дней, DVIR, код проверки", uk: "Вигляд для офіцера — журнали HOS за 8 днів, DVIR, код перевірки" },
  "Chain verification, proof lookup, ELD & settlement audits, audit trail": { pt: "Verificação da cadeia, busca de provas, auditorias de ELD e liquidações, trilha de auditoria", ru: "Проверка цепочки, поиск доказательств, аудиты ELD и расчётов, журнал аудита", uk: "Перевірка ланцюга, пошук доказів, аудити ELD і розрахунків, журнал аудиту" },
  "The guided onboarding checklist — progress saved": { pt: "A lista guiada de início — progresso salvo", ru: "Ведомый чек-лист начала работы — прогресс сохраняется", uk: "Ведений чек-лист початку роботи — прогрес зберігається" },
  "Basic, Gold, Diamond, Owner — and the coin flow": { pt: "Basic, Gold, Diamond, Owner — e o fluxo da moeda", ru: "Basic, Gold, Diamond, Owner — и поток монеты", uk: "Basic, Gold, Diamond, Owner — і потік монети" },
  "Appearance, driving, truck, alerts, security, privacy": { pt: "Aparência, direção, caminhão, alertas, segurança, privacidade", ru: "Внешний вид, вождение, грузовик, оповещения, безопасность, приватность", uk: "Вигляд, водіння, вантажівка, сповіщення, безпека, приватність" },
  "Dictionary, FAQ, About, support, disclaimer": { pt: "Dicionário, FAQ, Sobre, suporte, aviso legal", ru: "Словарь, FAQ, О приложении, поддержка, отказ от ответственности", uk: "Словник, FAQ, Про застосунок, підтримка, відмова від відповідальності" },
  "Document vault, Safety Academy, DOT Inspection, Getting started, Plans, Settings, Full menu": { pt: "Cofre de documentos, Academia de Segurança, Inspeção DOT, Primeiros passos, Planos, Ajustes, Menu completo", ru: "Хранилище документов, Академия безопасности, Проверка DOT, Начало работы, Тарифы, Настройки, Полное меню", uk: "Сховище документів, Академія безпеки, Перевірка DOT, Початок роботи, Тарифи, Налаштування, Повне меню" },
  "Ask Meca assistant": { pt: "Assistente Ask Meca", ru: "Ассистент Ask Meca", uk: "Асистент Ask Meca" },
  "Compare a settlement against your sealed loads — underpayments flagged with amounts.": { pt: "Compare uma liquidação com suas cargas seladas — pagamentos a menos sinalizados com valores.", ru: "Сравните расчёт с вашими запечатанными грузами — недоплаты помечаются с суммами.", uk: "Порівняйте розрахунок із вашими запечатаними вантажами — недоплати позначаються із сумами." },
  "carries": { pt: "carrega", ru: "несёт", uk: "несе" },
  "each": { pt: "cada", ru: "каждый", uk: "кожен" },
  "points to the": { pt: "pontos até o", ru: "баллов до", uk: "балів до" },
  "Set a destination from Routes when you're parked — guidance takes this screen over.": { pt: "Defina um destino em Rotas quando estiver parado — a orientação assume esta tela.", ru: "Задайте пункт назначения в «Маршрутах», когда стоите, — навигация займёт этот экран.", uk: "Задайте пункт призначення в «Маршрутах», коли стоїте, — навігація займе цей екран." },
};

// ---------------------------------------------------------------------
// STRINGS — keyed catalogue for surfaces that never had an (en, es)
// pair. Every key carries the English source; other languages layer
// over it and fall back to English when a string is missing.
// ---------------------------------------------------------------------

export const STRINGS: Record<string, Partial<Record<Lang, string>>> = {
  // Settings — Appearance / language picker
  "settings.appearance": { en: "Appearance", es: "Apariencia", pt: "Aparência", ru: "Внешний вид", uk: "Вигляд" },
  "settings.appearanceWord": { en: "Appearance", es: "Apariencia", pt: "Aparência", ru: "Оформление", uk: "Оформлення" },
  "settings.fontSize": { en: "Font size", es: "Tamaño de letra", pt: "Tamanho da letra", ru: "Размер шрифта", uk: "Розмір шрифту" },
  "settings.fontStandard": { en: "Standard", es: "Estándar", pt: "Padrão", ru: "Обычный", uk: "Звичайний" },
  "settings.fontLarge": { en: "Large", es: "Grande", pt: "Grande", ru: "Крупный", uk: "Великий" },
  "settings.fontXLarge": { en: "Extra Large", es: "Extra grande", pt: "Extra grande", ru: "Очень крупный", uk: "Дуже великий" },
  "settings.theme": { en: "Theme", es: "Tema", pt: "Tema", ru: "Тема", uk: "Тема" },
  "settings.themeDark": { en: "Dark", es: "Oscuro", pt: "Escuro", ru: "Тёмная", uk: "Темна" },
  "settings.themeLight": { en: "Light", es: "Claro", pt: "Claro", ru: "Светлая", uk: "Світла" },
  "settings.themeSystem": { en: "Follow device", es: "Según el dispositivo", pt: "Seguir o aparelho", ru: "Как на устройстве", uk: "Як на пристрої" },
  "settings.language": { en: "Language", es: "Idioma", pt: "Idioma", ru: "Язык", uk: "Мова" },
  "settings.languageNote": {
    en: "The whole app follows your language — dashboard, menus, tool names, and the working screens. Legal and safety text always keeps its English original next to the translation, and the English text governs. Records, paperwork, and exports stay in the language they were written in. Miles, °F, and lbs stay the same in every language.",
    es: "Toda la app sigue tu idioma: el panel, los menús, los nombres de las herramientas y las pantallas de trabajo. El texto legal y de seguridad siempre conserva su original en inglés junto a la traducción, y el texto en inglés es el que manda. Los registros, el papeleo y las exportaciones quedan en el idioma en que se escribieron. Las millas, °F y lbs quedan iguales en todos los idiomas.",
    pt: "O app inteiro segue seu idioma: painel, menus, nomes das ferramentas e as telas de trabalho. O texto legal e de segurança sempre mantém o original em inglês ao lado da tradução, e o texto em inglês é o que vale. Registros, papelada e exportações ficam no idioma em que foram escritos. Milhas, °F e lbs ficam iguais em todos os idiomas.",
    ru: "Всё приложение следует за вашим языком: панель, меню, названия инструментов и рабочие экраны. Юридический текст и текст по безопасности всегда сохраняет английский оригинал рядом с переводом, и главным считается английский текст. Записи, документы и экспорты остаются на том языке, на котором были сделаны. Мили, °F и фунты (lbs) одинаковы на всех языках.",
    uk: "Весь застосунок слідує за вашою мовою: панель, меню, назви інструментів і робочі екрани. Юридичний текст і текст з безпеки завжди зберігає англійський оригінал поруч із перекладом, і головним вважається англійський текст. Записи, документи й експорти лишаються тією мовою, якою були зроблені. Милі, °F і фунти (lbs) однакові всіма мовами.",
  },
  // The English-governs note — shown beside any translated legal /
  // regulatory / safety text, in the chosen language.
  "govern.note": {
    en: "English text governs.",
    es: "El texto en inglés es el que manda.",
    pt: "O texto em inglês é o que vale.",
    ru: "Главным считается английский текст.",
    uk: "Головним вважається англійський текст.",
  },
  "govern.atlasLine": {
    en: "Reference only — posted signs, your permit, and your ELD govern.",
    es: "Solo referencia — mandan las señales colocadas, tu permiso y tu ELD.",
    pt: "Apenas referência — valem as placas colocadas, sua licença e seu ELD.",
    ru: "Только справочно — главными остаются дорожные знаки, ваше разрешение и ваш ELD.",
    uk: "Лише довідково — головними лишаються дорожні знаки, ваш дозвіл і ваш ELD.",
  },
  "govern.permitsNote": {
    en: "Permit terms print in English exactly as issued — that text governs.",
    es: "Los términos del permiso se imprimen en inglés tal como fueron emitidos — ese texto es el que manda.",
    pt: "Os termos da licença são impressos em inglês exatamente como emitidos — esse texto é o que vale.",
    ru: "Условия разрешения печатаются по-английски в точности как выданы — главным считается этот текст.",
    uk: "Умови дозволу друкуються англійською в точності як видані — головним вважається цей текст.",
  },
  // Ask Meca chrome
  "meca.askMeca": { en: "Ask Meca", es: "Pregunta a Meca", pt: "Pergunte à Meca", ru: "Спросить Meca", uk: "Запитати Meca" },
  "meca.takeMeThere": { en: "Take me there", es: "Llévame ahí", pt: "Me leve lá", ru: "Покажи, где это", uk: "Покажи, де це" },
  "meca.takeMeThereInstead": { en: "Take me there instead", es: "Llévame ahí mejor", pt: "Me leve lá então", ru: "Покажи это вместо того", uk: "Покажи це натомість" },
  "meca.notAvailable": { en: "not available on this account", es: "no disponible en esta cuenta", pt: "não disponível nesta conta", ru: "недоступно на этом аккаунте", uk: "недоступно на цьому акаунті" },
  "meca.tapTakeMeThere": {
    en: "Tap “Take me there” below and I'll open it.",
    es: "Toca «Llévame ahí» abajo y lo abro.",
    pt: "Toque em «Me leve lá» abaixo e eu abro.",
    ru: "Нажмите «Покажи, где это» ниже — и я открою.",
    uk: "Натисніть «Покажи, де це» нижче — і я відкрию.",
  },
  "meca.placeholder": {
    en: "Ask Meca — where things live, or what's on your run…",
    es: "Pregunta a Meca — dónde está algo, o qué hay en tu ruta…",
    pt: "Pergunte à Meca — onde fica algo, ou o que há na sua rota…",
    ru: "Спросите Meca — где что находится или что по вашему рейсу…",
    uk: "Запитайте Meca — де що знаходиться або що за вашим рейсом…",
  },
  // Owner Console sections
  "console.ownerConsole": { en: "Owner Console", es: "Consola del Propietario", pt: "Console do Proprietário", ru: "Консоль владельца", uk: "Консоль власника" },
  "console.dashboard": { en: "Dashboard", es: "Panel", pt: "Painel", ru: "Панель", uk: "Панель" },
  "console.fleetmap": { en: "Fleet Map", es: "Mapa de la flota", pt: "Mapa da frota", ru: "Карта парка", uk: "Мапа парку" },
  "console.board": { en: "Load Board", es: "Tablero de cargas", pt: "Quadro de cargas", ru: "Биржа грузов", uk: "Біржа вантажів" },
  "console.openboard": { en: "Open Board", es: "Tablero Abierto", pt: "Quadro Aberto", ru: "Открытая биржа", uk: "Відкрита біржа" },
  "console.shipper": { en: "Shipper Portal", es: "Portal del cargador", pt: "Portal do Embarcador", ru: "Портал грузоотправителя", uk: "Портал відправника" },
  "console.brokerportal": { en: "Broker Portal", es: "Portal del corredor", pt: "Portal do Corretor", ru: "Портал брокера", uk: "Портал брокера" },
  "console.ledger": { en: "RUGGS LLC Ledger", es: "Libro de RUGGS LLC", pt: "Livro da RUGGS LLC", ru: "Книга RUGGS LLC", uk: "Книга RUGGS LLC" },
  "console.giveaways": { en: "Giveaways", es: "Sorteos", pt: "Sorteios", ru: "Розыгрыши", uk: "Розіграші" },
  "console.drivers": { en: "Drivers", es: "Choferes", pt: "Motoristas", ru: "Водители", uk: "Водії" },
  "console.hours": { en: "Hours", es: "Horas", pt: "Horas", ru: "Часы", uk: "Години" },
  "console.settlements": { en: "Settlements", es: "Liquidaciones", pt: "Liquidações", ru: "Расчёты", uk: "Розрахунки" },
  "console.paystubs": { en: "Send Pay Stubs", es: "Enviar recibos de pago", pt: "Enviar comprovantes de pagamento", ru: "Отправить расчётные листки", uk: "Надіслати розрахункові листки" },
  "console.documents": { en: "Documents", es: "Documentos", pt: "Documentos", ru: "Документы", uk: "Документи" },
  "console.verify": { en: "Verify & Audit", es: "Verificar y auditar", pt: "Verificar e Auditar", ru: "Проверка и аудит", uk: "Перевірка й аудит" },
  "console.chat": { en: "Company Chat", es: "Chat de la empresa", pt: "Chat da empresa", ru: "Чат компании", uk: "Чат компанії" },
  "console.settings": { en: "Settings", es: "Ajustes", pt: "Ajustes", ru: "Настройки", uk: "Налаштування" },
  // Trailer tools (TrailerPanel headings)
  "trailer.tools": { en: "Trailer tools", es: "Herramientas del remolque", pt: "Ferramentas do reboque", ru: "Инструменты прицепа", uk: "Інструменти причепа" },
  "trailer.profile": { en: "Trailer profile", es: "Perfil del remolque", pt: "Perfil do reboque", ru: "Профиль прицепа", uk: "Профіль причепа" },
  "trailer.dryVan": { en: "Dry Van", es: "Caja seca", pt: "Baú seco (Dry Van)", ru: "Сухой фургон (Dry Van)", uk: "Сухий фургон (Dry Van)" },
  "trailer.reefer": { en: "Reefer", es: "Refrigerado", pt: "Refrigerado (Reefer)", ru: "Рефрижератор (Reefer)", uk: "Рефрижератор (Reefer)" },
  "trailer.flatbed": { en: "Flatbed", es: "Plataforma", pt: "Plataforma (Flatbed)", ru: "Платформа (Flatbed)", uk: "Платформа (Flatbed)" },
  "trailer.stepDeck": { en: "Step Deck", es: "Plataforma escalonada", pt: "Plataforma rebaixada (Step Deck)", ru: "Низкорамная платформа (Step Deck)", uk: "Низькорамна платформа (Step Deck)" },
  "trailer.rgn": { en: "RGN", es: "RGN", pt: "RGN", ru: "RGN (трал)", uk: "RGN (трал)" },
  "trailer.reeferLog": { en: "Reefer cold-chain log", es: "Registro de cadena de frío", pt: "Registro da cadeia do frio", ru: "Журнал холодовой цепи", uk: "Журнал холодового ланцюга" },
  "trailer.setpoint": { en: "Setpoint", es: "Punto de ajuste", pt: "Ponto de ajuste (setpoint)", ru: "Заданная температура (setpoint)", uk: "Задана температура (setpoint)" },
  "trailer.securement": { en: "Securement calculator", es: "Calculadora de sujeción", pt: "Calculadora de amarração", ru: "Калькулятор крепления груза", uk: "Калькулятор кріплення вантажу" },
  "trailer.loadedHeight": { en: "Loaded height", es: "Altura cargada", pt: "Altura carregada", ru: "Высота с грузом", uk: "Висота з вантажем" },
  "trailer.axle": { en: "Axle weight & spacing calculator", es: "Calculadora de peso y distancia entre ejes", pt: "Calculadora de peso e distância entre eixos", ru: "Калькулятор нагрузки на оси и межосевых расстояний", uk: "Калькулятор навантаження на осі та міжосьових відстаней" },
  "trailer.dockHelper": { en: "Dock helper", es: "Ayudante de muelle", pt: "Ajudante de doca", ru: "Помощник на рампе", uk: "Помічник на рампі" },
  "trailer.lumperFee": { en: "Lumper fee", es: "Tarifa de lumper", pt: "Taxa de lumper", ru: "Плата лампера (разгрузка)", uk: "Плата лампера (розвантаження)" },
  "trailer.pretrip": { en: "Pre-trip inspection", es: "Inspección pre-viaje", pt: "Inspeção pré-viagem", ru: "Предрейсовый осмотр", uk: "Передрейсовий огляд" },
  "trailer.windAdvisory": { en: "High-wind advisory", es: "Aviso de viento fuerte", pt: "Aviso de vento forte", ru: "Предупреждение о сильном ветре", uk: "Попередження про сильний вітер" },
  "trailer.toolsFor": { en: "Trailer tools — {type}", es: "Herramientas del remolque — {type}", pt: "Ferramentas do reboque — {type}", ru: "Инструменты прицепа — {type}", uk: "Інструменти причепа — {type}" },
  "trailer.moreTools": { en: "More trailer tools", es: "Más herramientas del remolque", pt: "Mais ferramentas do reboque", ru: "Ещё инструменты прицепа", uk: "Ще інструменти причепа" },
  "trailer.loadedHeightThisLoad": { en: "Loaded height — this load", es: "Altura cargada — esta carga", pt: "Altura carregada — esta carga", ru: "Высота с грузом — этот груз", uk: "Висота з вантажем — цей вантаж" },
  "trailer.securementFmcsa": { en: "Securement calculator — FMCSA general freight", es: "Calculadora de sujeción — carga general FMCSA", pt: "Calculadora de amarração — carga geral FMCSA", ru: "Калькулятор крепления — генеральные грузы FMCSA", uk: "Калькулятор кріплення — генеральні вантажі FMCSA" },
  "trailer.axleBridge": { en: "Axle weight & spacing — federal Bridge Formula", es: "Peso y distancia entre ejes — Fórmula Bridge federal", pt: "Peso e distância entre eixos — Fórmula Bridge federal", ru: "Нагрузка на оси и расстояния — федеральная формула Bridge", uk: "Навантаження на осі та відстані — федеральна формула Bridge" },
  "trailer.pretripFor": { en: "Pre-trip inspection — {type}", es: "Inspección pre-viaje — {type}", pt: "Inspeção pré-viagem — {type}", ru: "Предрейсовый осмотр — {type}", uk: "Передрейсовий огляд — {type}" },
  "trailer.detention": { en: "Detention", es: "Detención", pt: "Detenção (espera)", ru: "Простой (detention)", uk: "Простій (detention)" },
  "trailer.deadhead": { en: "Deadhead", es: "Millas en vacío", pt: "Milhas vazias (deadhead)", ru: "Порожний пробег (deadhead)", uk: "Порожній пробіг (deadhead)" },
  // Money & Flow batch + Pay Book / Records panel titles
  "money.expiryWallet": { en: "🗓️ Document expiry wallet — CDL, med card, registration, insurance, DOT inspection", es: "🗓️ Cartera de vencimientos — CDL, tarjeta médica, registro, seguro, inspección DOT", pt: "🗓️ Carteira de vencimentos — CDL, cartão médico, registro, seguro, inspeção DOT", ru: "🗓️ Кошелёк сроков документов — CDL, медкарта, регистрация, страховка, проверка DOT", uk: "🗓️ Гаманець строків документів — CDL, медкартка, реєстрація, страховка, перевірка DOT" },
  "money.owed": { en: "💰 Who owes me — delivered, not yet paid", es: "💰 Quién me debe — entregado, aún no pagado", pt: "💰 Quem me deve — entregue, ainda não pago", ru: "💰 Кто мне должен — доставлено, ещё не оплачено", uk: "💰 Хто мені винен — доставлено, ще не оплачено" },
  "money.trueRateTitle": { en: "🧮 True rate — pay ÷ ALL miles, net after fuel", es: "🧮 Tarifa real — pago ÷ TODAS las millas, neto tras el diésel", pt: "🧮 Taxa real — pagamento ÷ TODAS as milhas, líquido após o diesel", ru: "🧮 Реальная ставка — оплата ÷ ВСЕ мили, чисто после топлива", uk: "🧮 Реальна ставка — оплата ÷ ВСІ милі, чисто після пального" },
  "money.tonu": { en: "🧾 TONU + layover logger — claim events beside Detention Pay", es: "🧾 Registro TONU + layover — reclamos junto al Pago por detención", pt: "🧾 Registro de TONU + layover — reclamações junto ao Pagamento por detenção", ru: "🧾 Журнал TONU + layover — претензии рядом с оплатой простоя", uk: "🧾 Журнал TONU + layover — претензії поруч з оплатою простою" },
  "money.maintenanceTitle": { en: "🔧 Maintenance countdown — by odometer, not calendar", es: "🔧 Cuenta atrás de mantenimiento — por odómetro, no por calendario", pt: "🔧 Contagem de manutenção — por hodômetro, não por calendário", ru: "🔧 Обратный отсчёт обслуживания — по одометру, не по календарю", uk: "🔧 Зворотний відлік обслуговування — за одометром, не за календарем" },
  "money.breakdownTitle": { en: "🛠️ Breakdown mode — downtime + cost log", es: "🛠️ Modo avería — registro de parada y costos", pt: "🛠️ Modo pane — registro de parada e custos", ru: "🛠️ Режим поломки — журнал простоя и расходов", uk: "🛠️ Режим поломки — журнал простою і витрат" },
  "money.ifta": { en: "⛽ IFTA Complete — fuel + quarterly report", es: "⛽ IFTA Completo — diésel + informe trimestral", pt: "⛽ IFTA Completo — diesel + relatório trimestral", ru: "⛽ IFTA полностью — топливо + квартальный отчёт", uk: "⛽ IFTA повністю — пальне + квартальний звіт" },
  "money.truth": { en: "💰 Money Truth — your real cost per mile", es: "💰 La verdad del dinero — tu costo real por milla", pt: "💰 A verdade do dinheiro — seu custo real por milha", ru: "💰 Правда денег — ваша реальная стоимость мили", uk: "💰 Правда грошей — ваша реальна вартість милі" },
  "money.paybookTitle": { en: "🧾 Pay Book — W-2 + 1099 pay", es: "🧾 Libro de Pagos — pago W-2 + 1099", pt: "🧾 Livro de Pagamentos — pagamento W-2 + 1099", ru: "🧾 Книга выплат — оплата W-2 + 1099", uk: "🧾 Книга виплат — оплата W-2 + 1099" },
  "money.advisor": { en: "🎯 Load Worth-It Advisor", es: "🎯 Asesor de cargas que valen la pena", pt: "🎯 Conselheiro de cargas que valem a pena", ru: "🎯 Советник «стоит ли груз»", uk: "🎯 Радник «чи вартий вантаж»" },
  "money.settlementTitle": { en: "🧾 Settlement Checker — get paid what you're owed", es: "🧾 Conferente de liquidaciones — cobra lo que te deben", pt: "🧾 Conferente de liquidações — receba o que te devem", ru: "🧾 Проверка расчётов — получите то, что вам должны", uk: "🧾 Перевірка розрахунків — отримайте те, що вам винні" },
  "records.scale": { en: "⚖️ Scale tickets — CAT scales & weights", es: "⚖️ Tickets de báscula — básculas CAT y pesos", pt: "⚖️ Tickets de balança — balanças CAT e pesos", ru: "⚖️ Весовые талоны — весы CAT и веса", uk: "⚖️ Вагові талони — ваги CAT і ваги" },
  "records.vault": { en: "🗄️ Personal document vault + renewal reminders", es: "🗄️ Bóveda personal de documentos + recordatorios de renovación", pt: "🗄️ Cofre pessoal de documentos + lembretes de renovação", ru: "🗄️ Личное хранилище документов + напоминания о продлении", uk: "🗄️ Особисте сховище документів + нагадування про поновлення" },
  "records.dvir": { en: "📝 Inspection checklists — pre-trip & post-trip DVIR", es: "📝 Listas de inspección — DVIR pre-viaje y post-viaje", pt: "📝 Listas de inspeção — DVIR pré-viagem e pós-viagem", ru: "📝 Чек-листы осмотра — DVIR до и после рейса", uk: "📝 Чек-листи огляду — DVIR до і після рейсу" },
  // Final Extras batch (2026-11-06)
  "extras.taxTitle": { en: "🧮 Tax records — expenses by category + per-diem days", es: "🧮 Registros de impuestos — gastos por categoría + días de viáticos", pt: "🧮 Registros de impostos — despesas por categoria + dias de per-diem", ru: "🧮 Налоговые записи — расходы по категориям + дни per-diem", uk: "🧮 Податкові записи — витрати за категоріями + дні per-diem" },
  "extras.perDiemDays": { en: "Per-diem days this year", es: "Días de viáticos este año", pt: "Dias de per-diem este ano", ru: "Дней per-diem в этом году", uk: "Днів per-diem цього року" },
  "extras.perDiemNote": { en: "Counted automatically from your sealed trip records — every day a trip was on the road, counted once. Per-diem is an owner-operator / 1099 deduction; W-2 company drivers cannot claim it (removed by the 2017 tax law change). A record for tax prep — not tax advice.", es: "Contados automáticamente de tus registros de viaje sellados — cada día que un viaje estuvo en la ruta, contado una vez. Los viáticos son una deducción para propietarios-operadores / 1099; los conductores W-2 de empresa no pueden reclamarlos (eliminados por el cambio de ley fiscal de 2017). Un registro para preparar impuestos — no es asesoría fiscal.", pt: "Contados automaticamente dos seus registros de viagem selados — cada dia em que uma viagem esteve na estrada, contado uma vez. O per-diem é uma dedução para proprietários-operadores / 1099; motoristas W-2 de empresa não podem reivindicá-lo (removido pela mudança da lei fiscal de 2017). Um registro para preparo de impostos — não é consultoria fiscal.", ru: "Считаются автоматически из ваших запечатанных записей рейсов — каждый день, когда рейс был в пути, считается один раз. Per-diem — вычет для владельцев-операторов / 1099; водители W-2 в компании не могут его заявлять (отменён изменением налогового закона 2017 года). Запись для подготовки налогов — не налоговая консультация.", uk: "Рахуються автоматично з ваших запечатаних записів рейсів — кожен день, коли рейс був у дорозі, рахується один раз. Per-diem — відрахування для власників-операторів / 1099; водії W-2 у компанії не можуть його заявляти (скасовано зміною податкового закону 2017 року). Запис для підготовки податків — не податкова консультація." },
  "extras.facilityTitle": { en: "🏭 Facility Memory — what to expect here", es: "🏭 Memoria de instalaciones — qué esperar aquí", pt: "🏭 Memória de instalações — o que esperar aqui", ru: "🏭 Память объектов — чего ожидать здесь", uk: "🏭 Пам'ять об'єктів — чого очікувати тут" },
  "extras.facilityOwnOnly": { en: "From your own sealed history only — your detention, your lumper fees, your check-in notes. Nobody else's.", es: "Solo de tu propio historial sellado — tu detención, tus tarifas de lumper, tus notas de registro. De nadie más.", pt: "Apenas do seu próprio histórico selado — sua detenção, suas taxas de lumper, suas notas de check-in. De mais ninguém.", ru: "Только из вашей собственной запечатанной истории — ваш простой, ваши сборы lumper, ваши заметки о регистрации. Никого другого.", uk: "Лише з вашої власної запечатаної історії — ваш простій, ваші збори lumper, ваші нотатки про реєстрацію. Нікого іншого." },
  "extras.facilityNone": { en: "No history here yet — no sealed visits at this facility in your records. It builds as you seal arrivals and departures.", es: "Aún no hay historial aquí — no hay visitas selladas en esta instalación en tus registros. Se construye a medida que sellas llegadas y salidas.", pt: "Ainda não há histórico aqui — nenhuma visita selada nesta instalação nos seus registros. Ele se constrói conforme você sela chegadas e partidas.", ru: "Здесь пока нет истории — в ваших записях нет запечатанных визитов на этот объект. Она строится, когда вы запечатываете прибытия и отправления.", uk: "Тут ще немає історії — у ваших записах немає запечатаних візитів на цей об'єкт. Вона будується, коли ви запечатуєте прибуття та відправлення." },
  "extras.checkInNote": { en: "Check-in note (for next time)", es: "Nota de registro (para la próxima vez)", pt: "Nota de check-in (para a próxima vez)", ru: "Заметка о регистрации (на следующий раз)", uk: "Нотатка про реєстрацію (на наступний раз)" },
  "extras.driverEntered": { en: "Driver-entered", es: "Ingresado por el conductor", pt: "Inserido pelo motorista", ru: "Введено водителем", uk: "Введено водієм" },
  "extras.scaleFinderNote": { en: "Scales from map data (OpenStreetMap) — CAT Scale, weighbridges, and truck stops tagged with scales. Locations only; the map data carries no live status.", es: "Básculas de los datos del mapa (OpenStreetMap) — CAT Scale, básculas puente y paradas de camiones marcadas con báscula. Solo ubicaciones; el mapa no trae estado en vivo.", pt: "Balanças dos dados do mapa (OpenStreetMap) — CAT Scale, balanças rodoviárias e paradas de caminhões marcadas com balança. Apenas localizações; o mapa não traz status ao vivo.", ru: "Весы из данных карты (OpenStreetMap) — CAT Scale, весовые мосты и стоянки с отметкой о весах. Только местоположения; в данных карты нет живого статуса.", uk: "Ваги з даних мапи (OpenStreetMap) — CAT Scale, вагові мости та стоянки з позначкою про ваги. Лише розташування; у даних мапи немає живого статусу." },
  "extras.nightParking": { en: "🌙 Night parking — from map data", es: "🌙 Estacionamiento nocturno — de los datos del mapa", pt: "🌙 Estacionamento noturno — dos dados do mapa", ru: "🌙 Ночная парковка — из данных карты", uk: "🌙 Нічна парковка — з даних мапи" },
  "extras.nightParkingNote": { en: "Truck parking and rest areas from the map data (OpenStreetMap). Space counts are lot sizes from map tags — not live availability; the app has no live parking feed, so nothing here claims a space is free.", es: "Estacionamiento de camiones y áreas de descanso de los datos del mapa (OpenStreetMap). Los conteos de espacios son tamaños de lote de las etiquetas del mapa — no disponibilidad en vivo; la app no tiene un feed de estacionamiento en vivo, así que nada aquí afirma que un espacio esté libre.", pt: "Estacionamento de caminhões e áreas de descanso dos dados do mapa (OpenStreetMap). As contagens de vagas são tamanhos de lote das etiquetas do mapa — não disponibilidade ao vivo; o app não tem um feed de estacionamento ao vivo, então nada aqui afirma que uma vaga está livre.", ru: "Парковка для грузовиков и зоны отдыха из данных карты (OpenStreetMap). Количество мест — это размеры стоянок из тегов карты, а не живая доступность; у приложения нет живого фида парковки, поэтому ничто здесь не утверждает, что место свободно.", uk: "Парковка для вантажівок і зони відпочинку з даних мапи (OpenStreetMap). Кількість місць — це розміри стоянок із тегів мапи, а не жива доступність; застосунок не має живого фіду парковки, тому ніщо тут не стверджує, що місце вільне." },
  // Common buttons / words
  "common.save": { en: "Save", es: "Guardar", pt: "Salvar", ru: "Сохранить", uk: "Зберегти" },
  "common.cancel": { en: "Cancel", es: "Cancelar", pt: "Cancelar", ru: "Отмена", uk: "Скасувати" },
  "common.close": { en: "Close", es: "Cerrar", pt: "Fechar", ru: "Закрыть", uk: "Закрити" },
  "common.back": { en: "Back", es: "Atrás", pt: "Voltar", ru: "Назад", uk: "Назад" },
  "common.add": { en: "Add", es: "Agregar", pt: "Adicionar", ru: "Добавить", uk: "Додати" },
  "common.edit": { en: "Edit", es: "Editar", pt: "Editar", ru: "Изменить", uk: "Змінити" },
  "common.delete": { en: "Delete", es: "Borrar", pt: "Excluir", ru: "Удалить", uk: "Видалити" },
  "common.done": { en: "Done", es: "Listo", pt: "Pronto", ru: "Готово", uk: "Готово" },
  "common.search": { en: "Search", es: "Buscar", pt: "Buscar", ru: "Поиск", uk: "Пошук" },
  "common.open": { en: "Open", es: "Abrir", pt: "Abrir", ru: "Открыть", uk: "Відкрити" },
};

/**
 * The tr() engine: given the English source string and the Spanish
 * literal the call site already carries, return the string in `lang`.
 * Lookup: PAIRS[en][lang] → (es ? literal ?? PAIRS es) → English.
 * A string with no catalogue entry comes back in English — the
 * documented fallback, never a blank.
 */
export function pairText(lang: Lang, en: string, esText?: string): string {
  if (lang === "en") return en;
  const entry = PAIRS[en];
  if (lang === "es") return esText ?? entry?.es ?? en;
  return entry?.[lang] ?? en;
}

/**
 * Keyed lookup with {name} interpolation. Missing key or missing
 * language → the English source → the key itself (so a typo shows
 * up visibly in development instead of rendering blank).
 */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let out = entry?.[lang] ?? entry?.en ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** True when `key` has a real translation in `lang` (not a fallback). */
export function hasTranslation(lang: Lang, key: string): boolean {
  return typeof STRINGS[key]?.[lang] === "string";
}

// ---------------------------------------------------------------------
// Ask Meca destination labels — the "Parent → Child" path labels Meca
// speaks and the Take-me-there button carries. Segment-translated per
// destination id; the long English explainer blurbs stay English
// (labelled in the report): navigation and the labels are what must
// work in every language.
// ---------------------------------------------------------------------

export const DEST_LABELS: Record<string, Partial<Record<Lang, string>>> = {
  today: { es: "Hoy", pt: "Hoje", ru: "Сегодня", uk: "Сьогодні" },
  drive: { es: "Conducir → Mapa", pt: "Dirigir → Mapa", ru: "В путь → Карта", uk: "В дорогу → Мапа" },
  explore: { es: "Conducir → Explorar", pt: "Dirigir → Explorar", ru: "В путь → Обзор", uk: "В дорогу → Огляд" },
  go: { es: "Conducir → En marcha", pt: "Dirigir → Rodando", ru: "В путь → Режим вождения", uk: "В дорогу → Режим водіння" },
  satellite_view: { es: "Conducir → Vista satelital e inclinación", pt: "Dirigir → Vista de satélite e inclinação", ru: "В путь → Спутниковый вид и наклон", uk: "В дорогу → Супутниковий вигляд і нахил" },
  routes: { es: "Rutas", pt: "Rotas", ru: "Маршруты", uk: "Маршрути" },
  stops: { es: "Paradas de diésel", pt: "Paradas de diesel", ru: "Топливные остановки", uk: "Паливні зупинки" },
  loads: { es: "Cargas → Todas las cargas", pt: "Cargas → Todas as cargas", ru: "Грузы → Все грузы", uk: "Вантажі → Усі вантажі" },
  loads_tracker: { es: "Cargas → Rastreador de cargas", pt: "Cargas → Rastreador de cargas", ru: "Грузы → Трекер грузов", uk: "Вантажі → Трекер вантажів" },
  fleet_board: { es: "Tablero de la flota", pt: "Quadro da frota", ru: "Биржа парка", uk: "Біржа парку" },
  broker_inbox: { es: "Cargas → Bandeja del corredor", pt: "Cargas → Caixa do corretor", ru: "Грузы → Входящие брокера", uk: "Вантажі → Вхідні брокера" },
  open_board: { es: "Tablero Abierto", pt: "Quadro Aberto", ru: "Открытая биржа", uk: "Відкрита біржа" },
  shipper_portal: { es: "Portal del cargador", pt: "Portal do Embarcador", ru: "Портал грузоотправителя", uk: "Портал відправника" },
  broker_portal: { es: "Portal del corredor", pt: "Portal do Corretor", ru: "Портал брокера", uk: "Портал брокера" },
  team_portal: { es: "Portal del equipo", pt: "Portal da equipe", ru: "Портал команды", uk: "Портал команди" },
  trips: { es: "Viajes → Hojas de viaje", pt: "Viagens → Folhas de viagem", ru: "Рейсы → Путевые листы", uk: "Рейси → Шляхові листи" },
  hours: { es: "Chofer → Horas / HOS", pt: "Motorista → Horas / HOS", ru: "Водитель → Часы / HOS", uk: "Водій → Години / HOS" },
  settlements: { es: "Liquidaciones", pt: "Liquidações", ru: "Расчёты", uk: "Розрахунки" },
  detention: { es: "Pago por detención", pt: "Pagamento por detenção", ru: "Оплата простоя", uk: "Оплата простою" },
  documents: { es: "Documentos", pt: "Documentos", ru: "Документы", uk: "Документи" },
  chat: { es: "Chat", pt: "Chat", ru: "Чат", uk: "Чат" },
  company: { es: "Chat → Mi empresa", pt: "Chat → Minha empresa", ru: "Чат → Моя компания", uk: "Чат → Моя компанія" },
  milestones_board: { es: "Chat → Tablero de hitos", pt: "Chat → Quadro de marcos", ru: "Чат → Доска достижений", uk: "Чат → Дошка досягнень" },
  wallet: { es: "Dinero → Cartera y puntos", pt: "Dinheiro → Carteira e pontos", ru: "Деньги → Кошелёк и баллы", uk: "Гроші → Гаманець і бали" },
  pay_book: { es: "Dinero → Libro de Pagos", pt: "Dinheiro → Livro de Pagamentos", ru: "Деньги → Книга выплат", uk: "Гроші → Книга виплат" },
  pay_book_ytd: { es: "Dinero → Libro de Pagos → Gráficos del año", pt: "Dinheiro → Livro de Pagamentos → Gráficos do ano", ru: "Деньги → Книга выплат → Годовые диаграммы", uk: "Гроші → Книга виплат → Річні діаграми" },
  settings: { es: "Ajustes", pt: "Ajustes", ru: "Настройки", uk: "Налаштування" },
  language: { es: "Ajustes → Apariencia → Idioma", pt: "Ajustes → Aparência → Idioma", ru: "Настройки → Внешний вид → Язык", uk: "Налаштування → Вигляд → Мова" },
  app_performance: { es: "Ajustes → Conducción → Rendimiento de la app", pt: "Ajustes → Direção → Desempenho do app", ru: "Настройки → Вождение → Производительность приложения", uk: "Налаштування → Водіння → Продуктивність застосунку" },
  plans: { es: "Planes", pt: "Planos", ru: "Тарифы", uk: "Тарифи" },
  parking: { es: "Estacionamiento", pt: "Estacionamento", ru: "Стоянка", uk: "Стоянка" },
  saved_pins: { es: "Pines guardados 📍", pt: "Pins salvos 📍", ru: "Сохранённые метки 📍", uk: "Збережені мітки 📍" },
  safety_academy: { es: "Chofer → Academia de Seguridad", pt: "Motorista → Academia de Segurança", ru: "Водитель → Академия безопасности", uk: "Водій → Академія безпеки" },
  console_dashboard: { es: "Consola del Propietario → Panel", pt: "Console do Proprietário → Painel", ru: "Консоль владельца → Панель", uk: "Консоль власника → Панель" },
  console_fleetmap: { es: "Consola del Propietario → Mapa de la flota", pt: "Console do Proprietário → Mapa da frota", ru: "Консоль владельца → Карта парка", uk: "Консоль власника → Мапа парку" },
  console_drivers: { es: "Consola del Propietario → Choferes", pt: "Console do Proprietário → Motoristas", ru: "Консоль владельца → Водители", uk: "Консоль власника → Водії" },
  road_learning: { es: "Chofer → Aprendizaje de rutas", pt: "Motorista → Aprendizado de rotas", ru: "Водитель → Изучение дорог", uk: "Водій → Вивчення доріг" },
  si_layer: { es: "Chofer → STONEMILES SI", pt: "Motorista → STONEMILES SI", ru: "Водитель → STONEMILES SI", uk: "Водій → STONEMILES SI" },
  live_updates: { es: "Chofer → Actualizaciones en vivo — Salud de la app", pt: "Motorista → Atualizações ao vivo — Saúde do app", ru: "Водитель → Живые обновления — Здоровье приложения", uk: "Водій → Живі оновлення — Здоров'я застосунку" },
  route_weather: { es: "Conducir → Clima en la ruta", pt: "Dirigir → Clima na rota", ru: "В путь → Погода на маршруте", uk: "В дорогу → Погода на маршруті" },
  stop_planner: { es: "Conducir → Planificar mis paradas", pt: "Dirigir → Planejar minhas paradas", ru: "В путь → Спланировать остановки", uk: "В дорогу → Спланувати зупинки" },
  weigh_station_status: { es: "Conducir → Estado de básculas", pt: "Dirigir → Status das balanças", ru: "В путь → Статус весовых станций", uk: "В дорогу → Статус вагових станцій" },
  dispatch_desk: { es: "Escritorio de Despacho", pt: "Mesa de Despacho", ru: "Стол диспетчера", uk: "Стіл диспетчера" },
  my_desk: { es: "Mi Escritorio", pt: "Minha Mesa", ru: "Мой стол", uk: "Мій стіл" },
  broker_desk: { es: "Escritorio del Corredor", pt: "Mesa do Corretor", ru: "Стол брокера", uk: "Стіл брокера" },
  owner_desk: { es: "Escritorio del Propietario", pt: "Mesa do Proprietário", ru: "Стол владельца", uk: "Стіл власника" },
  sign_out: { es: "Cerrar sesión", pt: "Sair da conta", ru: "Выйти", uk: "Вийти" },
  doc_expiry: { es: "Chofer → Cartera de vencimientos", pt: "Motorista → Carteira de vencimentos", ru: "Водитель → Кошелёк сроков документов", uk: "Водій → Гаманець строків документів" },
  owed_board: { es: "Chofer → Quién me debe", pt: "Motorista → Quem me deve", ru: "Водитель → Кто мне должен", uk: "Водій → Хто мені винен" },
  true_rate: { es: "Chofer → Tarifa real", pt: "Motorista → Taxa real", ru: "Водитель → Реальная ставка", uk: "Водій → Реальна ставка" },
  claims_log: { es: "Chofer → Registro TONU y layover", pt: "Motorista → Registro de TONU e layover", ru: "Водитель → Журнал TONU и простоя (layover)", uk: "Водій → Журнал TONU і простою (layover)" },
  ifta: { es: "Chofer → Estimador IFTA", pt: "Motorista → Estimador IFTA", ru: "Водитель → Оценка IFTA", uk: "Водій → Оцінка IFTA" },
  maintenance: { es: "Chofer → Cuenta atrás de mantenimiento", pt: "Motorista → Contagem de manutenção", ru: "Водитель → Обратный отсчёт обслуживания", uk: "Водій → Зворотний відлік обслуговування" },
  breakdown_log: { es: "Chofer → Modo avería y registro", pt: "Motorista → Modo pane e registro", ru: "Водитель → Режим поломки и журнал", uk: "Водій → Режим поломки і журнал" },
  facility_memory: { es: "Cargas → Memoria de instalaciones", pt: "Cargas → Memória de instalações", ru: "Грузы → Память объектов", uk: "Вантажі → Пам'ять об'єктів" },
  scale_tickets: { es: "Chofer → Tickets de báscula", pt: "Motorista → Tickets de balança", ru: "Водитель → Весовые талоны", uk: "Водій → Вагові талони" },
  scale_finder: { es: "Conducir → Buscar una báscula", pt: "Dirigir → Encontrar uma balança", ru: "В путь → Найти весы", uk: "В дорогу → Знайти ваги" },
  tax_records: { es: "Chofer → Registros de impuestos", pt: "Motorista → Registros de impostos", ru: "Водитель → Налоговые записи", uk: "Водій → Податкові записи" },
  night_parking: { es: "Conducir → Estacionamiento nocturno", pt: "Dirigir → Estacionamento noturno", ru: "В путь → Ночная парковка", uk: "В дорогу → Нічна парковка" },
  trailer_tools: { es: "Cargas → Herramientas del remolque", pt: "Cargas → Ferramentas do reboque", ru: "Грузы → Инструменты прицепа", uk: "Вантажі → Інструменти причепа" },
  atlas: { es: "Atlas", pt: "Atlas", ru: "Атлас", uk: "Атлас" },
  sign_check: { es: "Conducir → Revisión de señales", pt: "Dirigir → Checagem de placas", ru: "В путь → Проверка знаков", uk: "В дорогу → Перевірка знаків" },
};

/** The destination's path label in the chosen language (fallback: the English label). */
export function destLabel(lang: Lang, destId: string, fallbackLabel: string): string {
  if (lang === "en") return fallbackLabel;
  return DEST_LABELS[destId]?.[lang] ?? fallbackLabel;
}

// ---------------------------------------------------------------------
// Ask Meca navigation in the driver's own language. Meca's English
// matcher is a regex chain in App.tsx; this is its catalogue-driven
// counterpart: ordered [phrase, destination id] pairs per language,
// most specific first, matched as plain substrings of the lowercased
// question (substring matching is script-safe for Cyrillic, where
// \b word boundaries are not). Covers the everyday working
// destinations; anything it misses falls through to the English
// matcher and then to Meca's model answer, whose reply language the
// server sets from the same setting.
// ---------------------------------------------------------------------

const NAV_PHRASES: Partial<Record<Lang, readonly (readonly [string, string])[]>> = {
  es: [
    ["días de viáticos", "tax_records"], ["cuántos días fuera", "tax_records"], ["registros de impuestos", "tax_records"], ["gastos por categoría", "tax_records"],
    ["memoria de instalaciones", "facility_memory"], ["qué esperar en", "facility_memory"], ["detención en", "facility_memory"],
    ["tickets de báscula", "scale_tickets"], ["ticket de báscula", "scale_tickets"], ["buscar una báscula", "scale_finder"], ["báscula cat", "scale_finder"], ["dónde hay una báscula", "scale_finder"],
    ["estacionamiento nocturno", "night_parking"], ["dónde dormir", "night_parking"], ["estacionamiento para la noche", "night_parking"],
    ["cuánto me deben", "owed_board"], ["quién me debe", "owed_board"], ["quien me debe", "owed_board"],
    ["cartera de vencimientos", "doc_expiry"], ["cuándo vence", "doc_expiry"], ["cuando vence", "doc_expiry"], ["vence mi", "doc_expiry"], ["mi tarjeta médica", "doc_expiry"], ["mi cdl", "doc_expiry"],
    ["clima en la ruta", "route_weather"], ["clima adelante", "route_weather"], ["tiempo en la ruta", "route_weather"],
    ["herramientas del remolque", "trailer_tools"], ["cadena de frío", "trailer_tools"], ["punto de ajuste", "trailer_tools"], ["sujeción de la carga", "trailer_tools"], ["mi remolque", "trailer_tools"], ["refrigerado", "trailer_tools"],
    ["estimador ifta", "ifta"], ["impuesto ifta", "ifta"], ["ifta", "ifta"],
    ["cuenta atrás de mantenimiento", "maintenance"], ["mantenimiento", "maintenance"], ["cambio de aceite", "maintenance"],
    ["registro de averías", "breakdown_log"], ["avería", "breakdown_log"],
    ["tarifa real", "true_rate"], ["tasa real", "true_rate"],
    ["tonu", "claims_log"], ["layover", "claims_log"], ["registro de reclamos", "claims_log"],
    ["pago por detención", "detention"], ["detención", "detention"],
    ["libro de pagos", "pay_book"], ["mi pago", "pay_book"], ["registrar pago", "pay_book"], ["viáticos", "pay_book"], ["per diem", "pay_book"],
    ["cartera y puntos", "wallet"], ["mis puntos", "wallet"], ["cartera", "wallet"], ["dinero", "wallet"],
    ["hojas de viaje", "trips"], ["mis viajes", "trips"], ["viajes", "trips"],
    ["horas de servicio", "hours"], ["mis horas", "hours"], ["horas", "hours"], ["hos", "hours"],
    ["liquidaciones", "settlements"], ["liquidación", "settlements"],
    ["bóveda de documentos", "documents"], ["mis documentos", "documents"], ["documentos", "documents"],
    ["academia de seguridad", "safety_academy"], ["cursos de seguridad", "safety_academy"],
    ["planificar mis paradas", "stop_planner"], ["planear paradas", "stop_planner"],
    ["paradas de diésel", "stops"], ["dónde cargo diésel", "stops"], ["diésel barato", "stops"],
    ["estacionamiento", "parking"], ["dónde estaciono", "parking"], ["parqueo", "parking"],
    ["pines guardados", "saved_pins"], ["mis pines", "saved_pins"],
    ["estado de básculas", "weigh_station_status"], ["básculas", "weigh_station_status"],
    ["revisión de señales", "sign_check"],
    ["vista satelital", "satellite_view"], ["satélite", "satellite_view"], ["inclinación", "satellite_view"],
    ["tablero abierto", "open_board"], ["portal del cargador", "shipper_portal"], ["portal del corredor", "broker_portal"],
    ["todas las cargas", "loads"], ["mis cargas", "loads"], ["cargas", "loads"], ["carga", "loads"],
    ["rutas", "routes"], ["ruta", "routes"],
    ["atlas", "atlas"],
    ["planes", "plans"], ["mi plan", "plans"],
    ["cambiar el idioma", "language"], ["idioma de la app", "language"], ["idioma", "language"],
    ["ajustes", "settings"], ["configuración", "settings"],
    ["cerrar sesión", "sign_out"], ["salir de la cuenta", "sign_out"],
    ["mi empresa", "company"], ["chat", "chat"],
    ["inicio", "today"], ["hoy", "today"], ["pantalla principal", "today"],
    ["mapa", "drive"], ["conducir", "drive"],
  ],
  pt: [
    ["dias de per-diem", "tax_records"], ["quantos dias fora", "tax_records"], ["registros de impostos", "tax_records"], ["despesas por categoria", "tax_records"],
    ["memória de instalações", "facility_memory"], ["o que esperar em", "facility_memory"], ["detenção em", "facility_memory"],
    ["tickets de balança", "scale_tickets"], ["ticket de balança", "scale_tickets"], ["encontrar uma balança", "scale_finder"], ["balança cat", "scale_finder"], ["onde tem uma balança", "scale_finder"],
    ["estacionamento noturno", "night_parking"], ["onde dormir", "night_parking"], ["estacionamento para a noite", "night_parking"],
    ["quem me deve", "owed_board"], ["quanto me devem", "owed_board"],
    ["carteira de vencimentos", "doc_expiry"], ["quando vence", "doc_expiry"], ["vence meu", "doc_expiry"], ["meu cartão médico", "doc_expiry"], ["minha cdl", "doc_expiry"],
    ["clima na rota", "route_weather"], ["tempo na rota", "route_weather"], ["clima à frente", "route_weather"],
    ["ferramentas do reboque", "trailer_tools"], ["cadeia do frio", "trailer_tools"], ["amarração", "trailer_tools"], ["meu reboque", "trailer_tools"], ["refrigerado", "trailer_tools"],
    ["estimador ifta", "ifta"], ["imposto ifta", "ifta"], ["ifta", "ifta"],
    ["contagem de manutenção", "maintenance"], ["manutenção", "maintenance"], ["troca de óleo", "maintenance"],
    ["registro de panes", "breakdown_log"], ["pane", "breakdown_log"], ["quebra", "breakdown_log"],
    ["taxa real", "true_rate"], ["tarifa real", "true_rate"],
    ["tonu", "claims_log"], ["layover", "claims_log"],
    ["detenção", "detention"], ["espera no embarque", "detention"],
    ["livro de pagamentos", "pay_book"], ["meu pagamento", "pay_book"], ["registrar pagamento", "pay_book"], ["per diem", "pay_book"],
    ["carteira e pontos", "wallet"], ["meus pontos", "wallet"], ["carteira", "wallet"], ["dinheiro", "wallet"],
    ["folhas de viagem", "trips"], ["minhas viagens", "trips"], ["viagens", "trips"],
    ["horas de serviço", "hours"], ["minhas horas", "hours"], ["horas", "hours"], ["hos", "hours"],
    ["liquidações", "settlements"], ["liquidação", "settlements"],
    ["cofre de documentos", "documents"], ["meus documentos", "documents"], ["documentos", "documents"],
    ["academia de segurança", "safety_academy"], ["cursos de segurança", "safety_academy"],
    ["planejar minhas paradas", "stop_planner"], ["paradas de diesel", "stops"], ["diesel barato", "stops"], ["onde abasteço", "stops"],
    ["estacionamento", "parking"], ["onde estaciono", "parking"],
    ["pins salvos", "saved_pins"], ["meus pins", "saved_pins"],
    ["status das balanças", "weigh_station_status"], ["balanças", "weigh_station_status"],
    ["checagem de placas", "sign_check"],
    ["vista de satélite", "satellite_view"], ["satélite", "satellite_view"], ["inclinação", "satellite_view"],
    ["quadro aberto", "open_board"], ["portal do embarcador", "shipper_portal"], ["portal do corretor", "broker_portal"],
    ["todas as cargas", "loads"], ["minhas cargas", "loads"], ["cargas", "loads"], ["carga", "loads"],
    ["rotas", "routes"], ["rota", "routes"],
    ["atlas", "atlas"],
    ["planos", "plans"], ["meu plano", "plans"],
    ["mudar o idioma", "language"], ["idioma do app", "language"], ["idioma", "language"],
    ["ajustes", "settings"], ["configurações", "settings"],
    ["sair da conta", "sign_out"],
    ["minha empresa", "company"], ["chat", "chat"],
    ["início", "today"], ["hoje", "today"], ["tela principal", "today"],
    ["mapa", "drive"], ["dirigir", "drive"],
  ],
  ru: [
    ["дней per-diem", "tax_records"], ["сколько дней в пути", "tax_records"], ["налоговые записи", "tax_records"], ["расходы по категориям", "tax_records"],
    ["память объектов", "facility_memory"], ["чего ожидать", "facility_memory"], ["простой в", "facility_memory"],
    ["весовые талоны", "scale_tickets"], ["весовой талон", "scale_tickets"], ["найти весы", "scale_finder"], ["весы cat", "scale_finder"], ["где весы", "scale_finder"],
    ["ночная парковка", "night_parking"], ["где ночевать", "night_parking"], ["парковка на ночь", "night_parking"],
    ["кто мне должен", "owed_board"], ["сколько мне должны", "owed_board"],
    ["сроки документов", "doc_expiry"], ["когда истекает", "doc_expiry"], ["истекает моя", "doc_expiry"], ["медкарта", "doc_expiry"], ["мой cdl", "doc_expiry"],
    ["погода на маршруте", "route_weather"], ["погода впереди", "route_weather"],
    ["инструменты прицепа", "trailer_tools"], ["холодовая цепь", "trailer_tools"], ["холодовой цепи", "trailer_tools"], ["крепление груза", "trailer_tools"], ["мой прицеп", "trailer_tools"], ["рефрижератор", "trailer_tools"],
    ["оценка ifta", "ifta"], ["налог ifta", "ifta"], ["ifta", "ifta"],
    ["обратный отсчёт обслуживания", "maintenance"], ["обслуживание", "maintenance"], ["замена масла", "maintenance"], ["техобслуживание", "maintenance"],
    ["журнал поломок", "breakdown_log"], ["поломка", "breakdown_log"],
    ["реальная ставка", "true_rate"],
    ["tonu", "claims_log"], ["простой layover", "claims_log"],
    ["оплата простоя", "detention"], ["простой", "detention"],
    ["книга выплат", "pay_book"], ["моя оплата", "pay_book"], ["моя зарплата", "pay_book"], ["суточные", "pay_book"], ["per diem", "pay_book"],
    ["кошелёк и баллы", "wallet"], ["мои баллы", "wallet"], ["кошелёк", "wallet"], ["деньги", "wallet"],
    ["путевые листы", "trips"], ["мои рейсы", "trips"], ["рейсы", "trips"],
    ["часы службы", "hours"], ["мои часы", "hours"], ["часы", "hours"], ["hos", "hours"],
    ["расчёты", "settlements"], ["расчёт", "settlements"],
    ["хранилище документов", "documents"], ["мои документы", "documents"], ["документы", "documents"],
    ["академия безопасности", "safety_academy"], ["курсы безопасности", "safety_academy"],
    ["спланировать остановки", "stop_planner"], ["топливные остановки", "stops"], ["дешёвое топливо", "stops"], ["где заправиться", "stops"],
    ["стоянка", "parking"], ["где встать на ночь", "parking"], ["парковка", "parking"],
    ["сохранённые метки", "saved_pins"], ["мои метки", "saved_pins"],
    ["статус весовых", "weigh_station_status"], ["весовые станции", "weigh_station_status"],
    ["проверка знаков", "sign_check"],
    ["спутниковый вид", "satellite_view"], ["спутник", "satellite_view"], ["наклон", "satellite_view"],
    ["открытая биржа", "open_board"], ["портал грузоотправителя", "shipper_portal"], ["портал брокера", "broker_portal"],
    ["все грузы", "loads"], ["мои грузы", "loads"], ["грузы", "loads"], ["груз", "loads"],
    ["маршруты", "routes"], ["маршрут", "routes"],
    ["атлас", "atlas"],
    ["тарифы", "plans"], ["мой тариф", "plans"],
    ["сменить язык", "language"], ["изменить язык", "language"], ["язык приложения", "language"], ["язык", "language"],
    ["настройки", "settings"],
    ["выйти", "sign_out"],
    ["моя компания", "company"], ["чат", "chat"],
    ["сегодня", "today"], ["главный экран", "today"],
    ["карта", "drive"], ["в путь", "drive"],
  ],
  uk: [
    ["днів per-diem", "tax_records"], ["скільки днів у дорозі", "tax_records"], ["податкові записи", "tax_records"], ["витрати за категоріями", "tax_records"],
    ["пам'ять об'єктів", "facility_memory"], ["чого очікувати", "facility_memory"], ["простій у", "facility_memory"],
    ["вагові талони", "scale_tickets"], ["ваговий талон", "scale_tickets"], ["знайти ваги", "scale_finder"], ["ваги cat", "scale_finder"], ["де ваги", "scale_finder"],
    ["нічна парковка", "night_parking"], ["де ночувати", "night_parking"], ["парковка на ніч", "night_parking"],
    ["хто мені винен", "owed_board"], ["скільки мені винні", "owed_board"],
    ["строки документів", "doc_expiry"], ["коли спливає", "doc_expiry"], ["спливає моя", "doc_expiry"], ["медкартка", "doc_expiry"], ["мій cdl", "doc_expiry"],
    ["погода на маршруті", "route_weather"], ["погода попереду", "route_weather"],
    ["інструменти причепа", "trailer_tools"], ["холодовий ланцюг", "trailer_tools"], ["кріплення вантажу", "trailer_tools"], ["мій причеп", "trailer_tools"], ["рефрижератор", "trailer_tools"],
    ["оцінка ifta", "ifta"], ["податок ifta", "ifta"], ["ifta", "ifta"],
    ["зворотний відлік обслуговування", "maintenance"], ["обслуговування", "maintenance"], ["заміна оливи", "maintenance"], ["техобслуговування", "maintenance"],
    ["журнал поломок", "breakdown_log"], ["поломка", "breakdown_log"],
    ["реальна ставка", "true_rate"],
    ["tonu", "claims_log"],
    ["оплата простою", "detention"], ["простій", "detention"],
    ["книга виплат", "pay_book"], ["моя оплата", "pay_book"], ["моя зарплата", "pay_book"], ["добові", "pay_book"], ["per diem", "pay_book"],
    ["гаманець і бали", "wallet"], ["мої бали", "wallet"], ["гаманець", "wallet"], ["гроші", "wallet"],
    ["шляхові листи", "trips"], ["мої рейси", "trips"], ["рейси", "trips"],
    ["години служби", "hours"], ["мої години", "hours"], ["години", "hours"], ["hos", "hours"],
    ["розрахунки", "settlements"], ["розрахунок", "settlements"],
    ["сховище документів", "documents"], ["мої документи", "documents"], ["документи", "documents"],
    ["академія безпеки", "safety_academy"], ["курси безпеки", "safety_academy"],
    ["спланувати зупинки", "stop_planner"], ["паливні зупинки", "stops"], ["дешеве пальне", "stops"], ["де заправитися", "stops"],
    ["стоянка", "parking"], ["де стати на ніч", "parking"], ["парковка", "parking"],
    ["збережені мітки", "saved_pins"], ["мої мітки", "saved_pins"],
    ["статус вагових", "weigh_station_status"], ["вагові станції", "weigh_station_status"],
    ["перевірка знаків", "sign_check"],
    ["супутниковий вигляд", "satellite_view"], ["супутник", "satellite_view"], ["нахил", "satellite_view"],
    ["відкрита біржа", "open_board"], ["портал відправника", "shipper_portal"], ["портал брокера", "broker_portal"],
    ["усі вантажі", "loads"], ["мої вантажі", "loads"], ["вантажі", "loads"], ["вантаж", "loads"],
    ["маршрути", "routes"], ["маршрут", "routes"],
    ["атлас", "atlas"],
    ["тарифи", "plans"], ["мій тариф", "plans"],
    ["змінити мову", "language"], ["мова застосунку", "language"], ["мова", "language"],
    ["налаштування", "settings"],
    ["вийти", "sign_out"],
    ["моя компанія", "company"], ["чат", "chat"],
    ["сьогодні", "today"], ["головний екран", "today"],
    ["мапа", "drive"], ["в дорогу", "drive"],
  ],
};

/**
 * Map a question written in the chosen language to a destination id
 * (the same ids App's English matcher returns), or null when no
 * phrase matches. English questions return null here — the English
 * regex chain owns them.
 */
export function destForLocalizedQuery(lang: Lang, question: string): string | null {
  if (lang === "en") return null;
  const list = NAV_PHRASES[lang];
  if (!list) return null;
  const q = question.toLowerCase();
  for (const [phrase, dest] of list) {
    if (q.includes(phrase)) return dest;
  }
  return null;
}
