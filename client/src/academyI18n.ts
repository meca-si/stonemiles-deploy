// Academy overlay translations (2026-11-06 multi-language build): the
// Safety Academy's course content — titles, blurbs, lesson titles and
// bodies, quiz questions and options — in Portuguese, Russian, and
// Ukrainian, aligned by index with the English/Spanish COURSES data in
// SafetyAcademy.tsx. Safety-governing content: the Academy renders the
// translation WITH the English original paired beneath it plus the
// "English governs" note (i18n govern.note) whenever the app language
// is pt/ru/uk. Quiz grading is by option INDEX on the server, and
// option order here matches optsEn exactly — the translation must
// never reorder options. Numbers and US units stay as recorded
// (mph, feet, psi, 4/32) in every language, per the build's rule.

import type { Lang } from "./i18n";

export type AcademyLang3 = Exclude<Lang, "en" | "es">;
type T3 = Record<AcademyLang3, string>;
type T3Arr = Record<AcademyLang3, string[]>;

export interface AcademyCourseI18n {
  title: T3;
  blurb: T3;
  lessons: { title: T3; body: T3 }[];
  quiz: { q: T3; opts: T3Arr }[];
}

const t3 = (pt: string, ru: string, uk: string): T3 => ({ pt, ru, uk });
const a3 = (pt: string[], ru: string[], uk: string[]): T3Arr => ({ pt, ru, uk });

export const ACADEMY_I18N: Record<string, AcademyCourseI18n> = {
  "defensive-driving": {
    title: t3("Direção Defensiva", "Защитное вождение", "Оборонне водіння"),
    blurb: t3(
      "Espaço, observação e movimentos suaves — os hábitos que mantêm um caminhão grande fora dos acidentes dos outros.",
      "Дистанция, обзор и плавные движения — привычки, которые держат большой грузовик подальше от чужих аварий.",
      "Дистанція, огляд і плавні рухи — звички, які тримають велику вантажівку подалі від чужих аварій.",
    ),
    lessons: [
      {
        title: t3("O espaço é o seu sistema de segurança", "Дистанция — ваша система безопасности", "Дистанція — ваша система безпеки"),
        body: t3(
          "Um cavalo-mecânico com carreta carregada, em velocidade de rodovia, precisa de uma longa distância para parar, então o seu espaço à frente é o sistema de segurança que está sempre ligado. Uma boa regra: pelo menos um segundo de distância para cada 10 pés de comprimento do veículo em velocidades abaixo de 40 mph, e o dobro acima de 40 mph ou com mau tempo — para uma combinação de 70 pés em velocidade de rodovia, isso significa aproximadamente 7 segundos ou mais. Conte usando um ponto fixo: quando o veículo à frente passar por ele, você deve terminar a contagem antes de chegar a ele. Se o tráfego tomar o seu espaço, tire o pé do acelerador e reconstrua a distância. O espaço que você mantém é um acidente que nunca acontece.",
          "Гружёному автопоезду на скорости трассы нужно много места, чтобы остановиться, поэтому дистанция впереди — единственная система безопасности, которая работает всегда. Хорошее правило: не меньше одной секунды дистанции на каждые 10 футов длины машины при скорости ниже 40 миль/ч, и вдвое больше выше 40 миль/ч или в плохую погоду — для автопоезда в 70 футов на скорости трассы это примерно 7 секунд и больше. Считайте по неподвижной точке: когда машина впереди проходит её, вы должны закончить счёт до того, как доедете до неё. Если поток отбирает вашу дистанцию, отпустите газ и восстановите её. Дистанция, которую вы держите, — это авария, которой не случилось.",
          "Завантаженому автопоїзду на швидкості траси треба багато місця, щоб зупинитися, тож дистанція попереду — єдина система безпеки, що працює завжди. Добре правило: щонайменше одна секунда дистанції на кожні 10 футів довжини машини за швидкості нижче 40 миль/год, і вдвічі більше понад 40 миль/год або в негоду — для автопоїзда у 70 футів на швидкості траси це приблизно 7 секунд і більше. Рахуйте за нерухомою точкою: коли машина попереду проїде її, ви маєте закінчити рахунок до того, як доїдете до неї. Якщо потік забирає вашу дистанцію, відпустіть газ і відновіть її. Дистанція, яку ви тримаєте, — це аварія, якої не сталося.",
        ),
      },
      {
        title: t3("Veja cedo, dirija suave", "Смотри рано, рули плавно", "Дивись рано, рулюй плавно"),
        body: t3(
          "Mire os olhos 12 a 15 segundos à frente — é de lá que vêm as suas decisões. Verifique os espelhos a cada 5 a 8 segundos para saber sempre o que está ao lado e atrás, e observe as luzes de freio dois ou três veículos à frente, não só o veículo logo adiante. Direção brusca é o que capota caminhões: uma guinada forte em velocidade de rodovia pode tombar uma carreta carregada mesmo com a pista livre. Movimentos suaves e antecipados — uma troca de faixa gentil, tirar o pé do acelerador cedo — mantêm a carga estável e dão tempo para todos ao redor reagirem.",
          "Направляйте взгляд на 12–15 секунд вперёд — оттуда приходят ваши решения. Проверяйте зеркала каждые 5–8 секунд, чтобы всегда знать, что рядом и сзади, и смотрите на стоп-сигналы двух-трёх машин впереди, а не только ближайшей. Резкие движения рулём опрокидывают грузовики: резкий рывок на скорости трассы может положить гружёный прицеп даже на пустой дороге. Плавные, ранние действия — мягкая смена полосы, ранний сброс газа — удерживают груз спокойно и дают всем вокруг время среагировать.",
          "Спрямовуйте погляд на 12–15 секунд уперед — звідти приходять ваші рішення. Перевіряйте дзеркала кожні 5–8 секунд, щоб завжди знати, що поруч і позаду, і дивіться на стоп-сигнали двох-трьох машин попереду, а не лише найближчої. Різкі рухи кермом перевертають вантажівки: різкий ривок на швидкості траси може покласти завантажений причіп навіть на порожній дорозі. Плавні, ранні дії — м'яка зміна смуги, раннє відпускання газу — тримають вантаж спокійно і дають усім навколо час зреагувати.",
        ),
      },
      {
        title: t3("A velocidade se ajusta à estrada, não ao horário", "Скорость под дорогу, а не под расписание", "Швидкість під дорогу, а не під розклад"),
        body: t3(
          "O limite afixado é um máximo para condições perfeitas, não uma promessa. Em curvas e rampas de saída, as velocidades recomendadas em amarelo são calculadas para carros com bom tempo — um caminhão carregado deve rodar de 5 a 10 mph abaixo delas. Em uma descida longa, escolha a marcha ANTES da descida e deixe o freio motor segurar você; pisar nos freios de serviço sem parar os superaquece até eles perderem a eficiência. Chegar dez minutos atrasado é um telefonema. Ir rápido demais em uma curva é a história inteira.",
          "Знак ограничения — это максимум для идеальных условий, а не обещание. На кривых и съездах жёлтые рекомендуемые скорости рассчитаны на легковые машины в хорошую погоду — гружёный грузовик должен идти на 5–10 миль/ч ниже. На длинном спуске выберите передачу ДО спуска и дайте моторному тормозу держать вас; езда на рабочих тормозах перегревает их, пока они не потеряют эффективность. Опоздать на десять минут — это телефонный звонок. Одна кривая на слишком большой скорости — это вся история.",
          "Знак обмеження — це максимум для ідеальних умов, а не обіцянка. На кривих і з'їздах жовті рекомендовані швидкості розраховані на легкові машини за доброї погоди — завантажена вантажівка має йти на 5–10 миль/год нижче. На довгому спуску виберіть передачу ДО спуску і дайте моторному гальму тримати вас; їзда на робочих гальмах перегріває їх, доки вони не втратять ефективність. Запізнитись на десять хвилин — це телефонний дзвінок. Одна крива на надто великій швидкості — це вся історія.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Em velocidade de rodovia, com a pista seca, uma distância de seguimento segura para uma combinação de 70 pés é de aproximadamente…",
          "На скорости трассы по сухой дороге безопасная дистанция для автопоезда в 70 футов — примерно…",
          "На швидкості траси сухою дорогою безпечна дистанція для автопоїзда у 70 футів — приблизно…",
        ),
        opts: a3(
          ["2 segundos", "O comprimento de um caminhão", "7 segundos ou mais", "Não importa se os seus freios estão bons"],
          ["2 секунды", "Одна длина грузовика", "7 секунд и больше", "Неважно, если тормоза хорошие"],
          ["2 секунди", "Одна довжина вантажівки", "7 секунд і більше", "Неважливо, якщо гальма добрі"],
        ),
      },
      {
        q: t3(
          "A que distância à frente os seus olhos devem estar varrendo enquanto você dirige?",
          "Как далеко вперёд должен смотреть ваш взгляд за рулём?",
          "Як далеко вперед має дивитися ваш погляд за кермом?",
        ),
        opts: a3(
          ["Só o veículo logo à frente", "Cerca de 5 segundos à frente", "De 12 a 15 segundos à frente", "No ornamento do capô"],
          ["Только на машину прямо впереди", "Примерно на 5 секунд вперёд", "На 12–15 секунд вперёд", "На фигурку на капоте"],
          ["Лише на машину просто попереду", "Приблизно на 5 секунд уперед", "На 12–15 секунд уперед", "На фігурку на капоті"],
        ),
      },
      {
        q: t3(
          "Um carro se mete e toma o seu espaço. A melhor resposta é…",
          "Машина вклинивается и отбирает вашу дистанцию. Лучший ответ — …",
          "Машина вклинюється і забирає вашу дистанцію. Найкраща відповідь — …",
        ),
        opts: a3(
          ["Frear forte para ele aprender a lição", "Tirar o pé do acelerador e reconstruir o seu espaço", "Mudar de faixa imediatamente, sem precisar de seta", "Piscar as luzes e buzinar até ele sair"],
          ["Резко затормозить, чтобы проучить", "Отпустить газ и восстановить дистанцию", "Сразу сменить полосу, сигнал не нужен", "Моргать фарами и сигналить, пока не уйдёт"],
          ["Різко загальмувати, щоб провчити", "Відпустити газ і відновити дистанцію", "Одразу змінити смугу, сигнал не треба", "Блимати фарами і сигналити, доки не піде"],
        ),
      },
      {
        q: t3(
          "As velocidades recomendadas em amarelo em rampas e curvas são calculadas para…",
          "Жёлтые рекомендуемые скорости на съездах и кривых рассчитаны на…",
          "Жовті рекомендовані швидкості на з'їздах і кривих розраховані на…",
        ),
        opts: a3(
          ["Caminhões totalmente carregados", "A velocidade mínima legal", "Caminhões só à noite", "Carros com bom tempo — caminhões devem ir mais devagar"],
          ["Полностью гружёные грузовики", "Минимальную разрешённую скорость", "Грузовики только ночью", "Легковые машины в хорошую погоду — грузовики должны ехать медленнее"],
          ["Повністю завантажені вантажівки", "Мінімальну дозволену швидкість", "Вантажівки лише вночі", "Легкові машини за доброї погоди — вантажівки мають їхати повільніше"],
        ),
      },
      {
        q: t3(
          "Antes de uma descida longa, você deve…",
          "Перед длинным спуском следует…",
          "Перед довгим спуском слід…",
        ),
        opts: a3(
          ["Usar os freios de serviço sem parar para manter o limite", "Descer em ponto morto para economizar combustível", "Selecionar uma marcha mais baixa antes de descer e deixar o freio motor trabalhar", "Acelerar para passar menos tempo na descida"],
          ["Держать рабочие тормоза, чтобы не превышать лимит", "Спускаться на нейтрали ради экономии топлива", "Выбрать пониженную передачу до спуска и дать моторному тормозу работать", "Ускориться, чтобы быстрее пройти спуск"],
          ["Тримати робочі гальма, щоб не перевищувати ліміт", "Спускатися на нейтралі задля економії пального", "Вибрати знижену передачу до спуску і дати моторному гальму працювати", "Прискоритися, щоб швидше пройти спуск"],
        ),
      },
    ],
  },
  "hos-rules": {
    title: t3("Regras de Horas de Serviço e Registros", "Правила часов работы и журналы", "Правила годин роботи та журнали"),
    blurb: t3(
      "Os quatro relógios, a regra da pausa, o camarote dividido e por que o registro tem que ser a verdade.",
      "Четыре счётчика, правило перерыва, разделённый сон в спальнике и почему журнал должен быть правдой.",
      "Чотири лічильники, правило перерви, розділений спальник і чому журнал має бути правдою.",
    ),
    lessons: [
      {
        title: t3("Os quatro relógios", "Четыре счётчика", "Чотири лічильники"),
        body: t3(
          "Os motoristas de carga vivem por quatro limites. O limite de 11 horas de direção: depois de 10 horas consecutivas fora de serviço, você pode dirigir até 11 horas. A janela de 14 horas: quando você entra em serviço, a direção tem que parar 14 horas depois, não importa quantas pausas você fez dentro da janela. O limite de 70 horas/8 dias: seu tempo em serviço nos últimos 8 dias não pode passar de 70 horas (um reinício de 34 horas o zera). E os relógios só zeram do jeito que as regras dizem — um cochilo dentro da janela de 14 horas não para essa janela. Saiba qual relógio acaba primeiro; esse é o seu prazo de verdade.",
          "Водители грузовых перевозок живут по четырём лимитам. Лимит вождения 11 часов: после 10 часов отдыха подряд вы можете вести до 11 часов. Окно 14 часов: как только вы вышли на смену, вождение должно прекратиться через 14 часов, сколько бы перерывов вы ни делали внутри окна. Лимит 70 часов за 8 дней: ваше рабочее время за последние 8 дней не может превысить 70 часов (перезапуск на 34 часа сбрасывает его). И счётчики сбрасываются только так, как говорят правила, — дремота внутри окна 14 часов не останавливает это окно. Знайте, какой счётчик закончится первым; он и есть ваш настоящий срок.",
          "Водії вантажних перевезень живуть за чотирма лімітами. Ліміт водіння 11 годин: після 10 годин відпочинку поспіль ви можете вести до 11 годин. Вікно 14 годин: щойно ви вийшли на зміну, водіння має припинитися через 14 годин, скільки б перерв ви не робили всередині вікна. Ліміт 70 годин за 8 днів: ваш робочий час за останні 8 днів не може перевищити 70 годин (перезапуск на 34 години скидає його). І лічильники скидаються лише так, як кажуть правила, — дрімота всередині вікна 14 годин не зупиняє це вікно. Знайте, який лічильник закінчиться першим; він і є ваш справжній строк.",
        ),
      },
      {
        title: t3("A pausa de 30 minutos e o camarote dividido", "Перерыв 30 минут и разделённый спальник", "Перерва 30 хвилин і розділений спальник"),
        body: t3(
          "Depois de 8 horas acumuladas de tempo de direção, você não pode dirigir de novo até fazer uma interrupção de 30 minutos — fora de serviço, no camarote ou em serviço sem dirigir, tudo conta. A regra do camarote dividido permite dividir seu descanso de 10 horas em dois períodos válidos (pelo menos 7 horas no camarote mais pelo menos 2 horas fora ou no camarote, ou 8/2 de qualquer jeito), desde que o par some 10 — e um par válido pausa o relógio de 14 horas. Usado direito, o camarote dividido é como um motorista contorna legalmente um atraso no embarcador em vez de ficar sem horas em um doca.",
          "После 8 суммарных часов вождения вы не можете вести снова, пока не сделаете перерыв в 30 минут — не на смене, в спальнике или на смене без вождения, всё засчитывается. Правило разделённого спальника позволяет разделить ваш 10-часовой отдых на два подходящих периода (не менее 7 часов в спальнике плюс не менее 2 часов не на смене или в спальнике, или 8/2 в любом порядке), если пара в сумме даёт 10, — и подходящая пара ставит окно 14 часов на паузу. При правильном использовании разделённый спальник — это способ легально обойти задержку у грузоотправителя, а не остаться без часов у рампы.",
          "Після 8 сумарних годин водіння ви не можете вести знову, доки не зробите перерву на 30 хвилин — не на зміні, у спальнику або на зміні без водіння, все зараховується. Правило розділеного спальника дозволяє розділити ваш 10-годинний відпочинок на два придатні періоди (щонайменше 7 годин у спальнику плюс щонайменше 2 години не на зміні або в спальнику, або 8/2 у будь-якому порядку), якщо пара в сумі дає 10, — і придатна пара ставить вікно 14 годин на паузу. За правильного використання розділений спальник — це спосіб легально обійти затримку у відправника, а не залишитися без годин біля рампи.",
        ),
      },
      {
        title: t3("Registre a verdade", "Пишите правду", "Пишіть правду"),
        body: t3(
          "Seu ELD é o registro oficial, e o registro tem que corresponder à realidade: um registro falsificado é uma das maneiras mais rápidas de perder sua CDL e, depois de um acidente, sua liberdade. Existem duas exceções estreitas. Condições adversas de direção — mau tempo ou problemas na estrada que você não conhecia antes do despacho — podem estender o limite de direção e a janela em até 2 horas (nunca a pausa nem o limite semanal). Uso pessoal do veículo (personal conveyance) é movimento fora de serviço do caminhão por motivos pessoais, como dirigir até um jantar depois do turno; não é avançar uma carga, e usá-lo para chegar mais perto de uma entrega é violação. Na dúvida, registre o que você realmente fez.",
          "Ваш ELD — официальный журнал, и журнал должен совпадать с реальностью: поддельный журнал — один из самых быстрых способов потерять CDL, а после аварии — и свободу. Есть два узких исключения. Неблагоприятные условия вождения — погода или дорожные неприятности, о которых вы не знали до отправки, — могут продлить лимит вождения и окно до 2 часов (никогда — перерыв или недельный лимит). Личное использование (personal conveyance) — это движение грузовика вне смены по личным причинам, например поездка на ужин после смены; это не продвижение груза, и использовать его, чтобы подъехать ближе к доставке, — нарушение. Сомневаетесь — пишите то, что делали на самом деле.",
          "Ваш ELD — офіційний журнал, і журнал має збігатися з реальністю: підроблений журнал — один із найшвидших способів втратити CDL, а після аварії — і волю. Є два вузькі винятки. Несприятливі умови водіння — погода або дорожні негаразди, про які ви не знали до відправлення, — можуть подовжити ліміт водіння та вікно до 2 годин (ніколи — перерву чи тижневий ліміт). Особисте використання (personal conveyance) — це рух вантажівки поза зміною з особистих причин, наприклад поїздка на вечерю після зміни; це не просування вантажу, і використовувати його, щоб під'їхати ближче до доставки, — порушення. Сумніваєтеся — пишіть те, що робили насправді.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Depois de 10 horas consecutivas fora de serviço, qual é o tempo máximo de direção antes de outro descanso de 10 horas?",
          "После 10 часов отдыха подряд каково максимальное время вождения до следующего 10-часового перерыва?",
          "Після 10 годин відпочинку поспіль який максимальний час водіння до наступної 10-годинної перерви?",
        ),
        opts: a3(
          ["10 horas", "11 horas", "12 horas", "14 horas"],
          ["10 часов", "11 часов", "12 часов", "14 часов"],
          ["10 годин", "11 годин", "12 годин", "14 годин"],
        ),
      },
      {
        q: t3(
          "A regra das 14 horas significa…",
          "Правило 14 часов означает…",
          "Правило 14 годин означає…",
        ),
        opts: a3(
          ["Você pode estar em serviço 14 horas mas dirigir 16", "Quando você entra em serviço, toda a direção deve parar 14 horas depois, com as pausas contadas dentro", "Você deve dormir 14 horas depois de um turno", "Seu total semanal é limitado a uma média de 14 horas por dia"],
          ["Можно быть на смене 14 часов, а вести 16", "Как только вы вышли на смену, всё вождение должно прекратиться через 14 часов, перерывы считаются внутри", "Нужно спать 14 часов после смены", "Недельный итог ограничен средним 14 часов в день"],
          ["Можна бути на зміні 14 годин, а вести 16", "Щойно ви вийшли на зміну, все водіння має припинитися через 14 годин, перерви рахуються всередині", "Треба спати 14 годин після зміни", "Тижневий підсумок обмежений середнім 14 годин на день"],
        ),
      },
      {
        q: t3(
          "Uma pausa de 30 minutos é exigida depois de…",
          "Перерыв 30 минут обязателен после…",
          "Перерва 30 хвилин обов'язкова після…",
        ),
        opts: a3(
          ["8 horas acumuladas de tempo de direção", "Cada parada de combustível", "5 horas em serviço, dirigindo ou não", "Só quando você se sente cansado"],
          ["8 суммарных часов времени вождения", "Каждой заправки", "5 часов на смене, за рулём или нет", "Только когда вы устали"],
          ["8 сумарних годин часу водіння", "Кожної заправки", "5 годин на зміні, за кермом чи ні", "Лише коли ви втомилися"],
        ),
      },
      {
        q: t3(
          "Qual par de camarote dividido é válido (e pausa o relógio de 14 horas)?",
          "Какая пара разделённого спальника подходит (и ставит окно 14 часов на паузу)?",
          "Яка пара розділеного спальника підходить (і ставить вікно 14 годин на паузу)?",
        ),
        opts: a3(
          ["5 horas + 5 horas", "6 horas + 4 horas", "7 horas no camarote + 2 horas fora de serviço", "Dois cochilos que pareçam descansar"],
          ["5 часов + 5 часов", "6 часов + 4 часов", "7 часов в спальнике + 2 часа не на смене", "Любые два сна, после которых отдохнул"],
          ["5 годин + 5 годин", "6 годин + 4 години", "7 годин у спальнику + 2 години не на зміні", "Будь-які два сни, після яких відпочив"],
        ),
      },
      {
        q: t3(
          "As condições adversas de direção podem estender…",
          "Неблагоприятные условия вождения могут продлить…",
          "Несприятливі умови водіння можуть подовжити…",
        ),
        opts: a3(
          ["Nada — essa regra não existe", "Só o seu pagamento", "O tempo da sua pausa", "O limite de direção e a janela de 14 horas em até 2 horas"],
          ["Ничего — такого правила нет", "Только вашу оплату", "Время вашего перерыва", "Лимит вождения и окно 14 часов — до 2 часов"],
          ["Нічого — такого правила немає", "Лише вашу оплату", "Час вашої перерви", "Ліміт водіння та вікно 14 годин — до 2 годин"],
        ),
      },
    ],
  },
  "pretrip-dvir": {
    title: t3("Inspeção Pré-Viagem e DVIR", "Предрейсовый осмотр и DVIR", "Передрейсовий огляд і DVIR"),
    blurb: t3(
      "O mesmo círculo toda vez, os cinco críticos de segurança e um DVIR escrito como prova.",
      "Один и тот же круг каждый раз, пять критичных для безопасности систем и DVIR, написанный как доказательство.",
      "Одне й те саме коло щоразу, п'ять критичних для безпеки систем і DVIR, написаний як доказ.",
    ),
    lessons: [
      {
        title: t3("Ande o mesmo círculo toda vez", "Ходите один и тот же круг каждый раз", "Ходіть одне й те саме коло щоразу"),
        body: t3(
          "Uma boa inspeção pré-viagem é uma rotina, não uma busca. Comece no mesmo lugar todos os dias — aproxime-se do caminhão procurando vazamentos e inclinação, verifique o compartimento do motor, ligue o motor e observe os medidores, teste as luzes, depois ande pelo lado do motorista, o acoplamento, a carreta, a traseira, e volte pelo lado do passageiro. A mesma ordem toda vez significa que um defeito tem que se esconder de um sistema, não da sua memória. Leva mais ou menos o tempo de um café, e é a inspeção que o policial no posto de pesagem presume que você fez.",
          "Хороший предрейсовый осмотр — это привычная процедура, а не поиск. Начинайте каждый день с одного места — подходите к грузовику, ища утечки и крен, проверьте моторный отсек, заведите двигатель и смотрите на приборы, проверьте свет, затем обойдите сторону водителя, сцепку, прицеп, заднюю часть и вернитесь по стороне пассажира. Один и тот же порядок каждый раз означает, что дефект должен прятаться от системы, а не от вашей памяти. Это занимает примерно столько же, сколько чашка кофе, и это тот осмотр, который, как считает инспектор на весовом посту, вы сделали.",
          "Добрий передрейсовий огляд — це рутина, а не пошук. Починайте щодня з одного місця — підходьте до вантажівки, шукаючи витоки та крен, перевірте моторний відсік, заведіть двигун і дивіться на прилади, перевірте світло, потім обійдіть бік водія, зчеплення, причіп, задню частину і поверніться пасажирським боком. Один і той самий порядок щоразу означає, що дефект має ховатися від системи, а не від вашої пам'яті. Це займає приблизно стільки ж, скільки чашка кави, і це той огляд, який, як вважає інспектор на ваговому пості, ви зробили.",
        ),
      },
      {
        title: t3("Os cinco críticos de segurança", "Пять критичных для безопасности систем", "П'ять критичних для безпеки систем"),
        body: t3(
          "Cinco sistemas podem matar pessoas quando falham, e eles merecem seus olhos mais atentos: pneus (banda de rodagem, calibragem, danos — pneus de direção precisam de pelo menos 4/32 de sulco), freios (folga, vazamentos, aviso de ar baixo, freio de estacionamento segurando), luzes e refletores (todas as luzes funcionando, lentes limpas), acoplamento (quinta-roda travada, garras fechadas no pino-rei, correntes de segurança e mangueiras de ar certas em uma carreta) e fixação da carga. Um defeito em qualquer um deles não é um item de 'ficar de olho' — é um item de consertar antes de rodar, e o app o marca para o seu proprietário exatamente por esse motivo.",
          "Пять систем при отказе могут убить людей, и им нужны ваши самые внимательные глаза: шины (протектор, давление, повреждения — рулевым шинам нужно не менее 4/32 протектора), тормоза (люфт, утечки, сигнал низкого воздуха, удержание стояночным тормозом), свет и отражатели (все фонари работают, стёкла чистые), сцепка (седельное устройство заперто, захваты закрыты на шкворне, страховочные цепи и воздушные магистрали на прицепе — правильно) и крепление груза. Дефект в одной из этих систем — не пункт «понаблюдать», а пункт «исправить до выезда», и приложение отмечает его вашему владельцу именно по этой причине.",
          "П'ять систем у разі відмови можуть вбити людей, і їм потрібні ваші найуважніші очі: шини (протектор, тиск, пошкодження — кермовим шинам треба щонайменше 4/32 протектора), гальма (люфт, витоки, сигнал низького повітря, утримання стоянковим гальмом), світло та відбивачі (усі ліхтарі працюють, лінзи чисті), зчеплення (сідельний пристрій замкнено, захвати закриті на шкворні, страхувальні ланцюги та повітряні магістралі на причепі — правильно) і кріплення вантажу. Дефект в одній із цих систем — не пункт «понаглядати», а пункт «виправити до виїзду», і застосунок позначає його вашому власнику саме з цієї причини.",
        ),
      },
      {
        title: t3("Escreva o DVIR como se importasse", "Пишите DVIR так, будто это важно", "Пишіть DVIR так, ніби це важливо"),
        body: t3(
          "O Relatório de Inspeção do Veículo pelo Motorista (DVIR) é a trilha de papel dessa volta. Antes de dirigir, revise o DVIR ANTERIOR: qualquer defeito listado nele deve ter sido reparado ou certificado como não precisando de reparo antes que o caminhão rode de novo. Anote seus próprios defeitos com clareza — o que é e onde fica — assine e guarde a cópia. Um dia sem defeitos ainda recebe um relatório assinado onde sua empresa exige um. Depois de uma quebra ou de uma inspeção na estrada, esse histórico honesto de DVIR é o que prova que o caminhão foi cuidado.",
          "Отчёт водителя об осмотре транспортного средства (DVIR) — это бумажный след этого круга. Перед поездкой просмотрите ПРЕДЫДУЩИЙ DVIR: любой дефект, указанный в нём, должен быть устранён или заверен как не требующий ремонта до того, как грузовик снова выедет. Свои дефекты записывайте просто — что это и где — подписывайте и храните копию. День без дефектов всё равно получает подписанный отчёт там, где ваша компания его требует. После поломки или дорожной инспекции именно эта честная история DVIR доказывает, что за грузовиком следили.",
          "Звіт водія про огляд транспортного засобу (DVIR) — це паперовий слід цього кола. Перед поїздкою перегляньте ПОПЕРЕДНІЙ DVIR: будь-який дефект, зазначений у ньому, має бути усунений або засвідчений як такий, що не потребує ремонту, до того, як вантажівка знову виїде. Свої дефекти записуйте просто — що це і де — підписуйте і зберігайте копію. День без дефектів усе одно отримує підписаний звіт там, де ваша компанія його вимагає. Після поломки або дорожньої інспекції саме ця чесна історія DVIR доводить, що за вантажівкою доглядали.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Qual defeito deve ser consertado ANTES de o caminhão rodar?",
          "Какой дефект нужно исправить ДО того, как грузовик выедет?",
          "Який дефект треба виправити ДО того, як вантажівка виїде?",
        ),
        opts: a3(
          ["O rádio da cabine está morto", "Fluido do lavador de para-brisa baixo", "Um vazamento no freio a ar com o aviso de ar baixo acendendo", "Um para-lama arranhado"],
          ["Радио в кабине не работает", "Мало жидкости омывателя", "Утечка воздуха в тормозах, срабатывает сигнал низкого воздуха", "Потёртый брызговик"],
          ["Радіо в кабіні не працює", "Мало рідини омивача", "Витік повітря в гальмах, спрацьовує сигнал низького повітря", "Потертий бризковик"],
        ),
      },
      {
        q: t3(
          "Antes de dirigir, o DVIR anterior importa porque…",
          "Перед поездкой предыдущий DVIR важен, потому что…",
          "Перед поїздкою попередній DVIR важливий, бо…",
        ),
        opts: a3(
          ["Ele diz o nível de combustível", "Defeitos listados nele devem ser reparados, ou certificados como não precisando de reparo, antes de o caminhão rodar de novo", "Policiais nunca olham para ele", "Ele substitui a inspeção de hoje se estava limpo"],
          ["Он показывает уровень топлива", "Дефекты из него должны быть устранены или заверены как не требующие ремонта до следующего выезда грузовика", "Инспекторы никогда его не смотрят", "Он заменяет сегодняшний осмотр, если был чистым"],
          ["Він показує рівень пального", "Дефекти з нього мають бути усунені або засвідчені як такі, що не потребують ремонту, до наступного виїзду вантажівки", "Інспектори ніколи його не дивляться", "Він замінює сьогоднішній огляд, якщо був чистим"],
        ),
      },
      {
        q: t3(
          "A profundidade mínima do sulco para pneus de DIREÇÃO é…",
          "Минимальная глубина протектора для РУЛЕВЫХ шин — …",
          "Мінімальна глибина протектора для КЕРМОВИХ шин — …",
        ),
        opts: a3(
          ["2/32 de polegada", "Sem mínimo se o pneu segura ar", "4/32 de polegada", "8/32 de polegada"],
          ["2/32 дюйма", "Минимума нет, если шина держит воздух", "4/32 дюйма", "8/32 дюйма"],
          ["2/32 дюйма", "Мінімуму немає, якщо шина тримає повітря", "4/32 дюйма", "8/32 дюйма"],
        ),
      },
      {
        q: t3(
          "Quando a pressão do ar cai para cerca de 60 psi em um caminhão típico com freio a ar…",
          "Когда давление воздуха падает примерно до 60 psi на типичном грузовике с пневмотормозами…",
          "Коли тиск повітря падає приблизно до 60 psi на типовій вантажівці з пневмогальмами…",
        ),
        opts: a3(
          ["Nada acontece", "O aviso de ar baixo deve acender — um defeito para consertar, não para dirigir com ele", "Os freios funcionam melhor", "O governador adiciona mais ar automaticamente"],
          ["Ничего не происходит", "Должен включиться сигнал низкого воздуха — это дефект для исправления, а не для езды", "Тормоза работают лучше", "Регулятор автоматически добавляет воздух"],
          ["Нічого не відбувається", "Має ввімкнутися сигнал низького повітря — це дефект для виправлення, а не для їзди", "Гальма працюють краще", "Регулятор автоматично додає повітря"],
        ),
      },
      {
        q: t3(
          "Durante a verificação do acoplamento, o que prova que a quinta-roda está travada no pino-rei?",
          "При проверке сцепки что доказывает, что седельное устройство заперто на шкворне?",
          "Під час перевірки зчеплення що доводить, що сідельний пристрій замкнено на шкворні?",
        ),
        opts: a3(
          ["A carreta parece nivelada", "A alavanca de liberação está para dentro, as garras estão fechadas ao redor do pino-rei e não há folga entre a quinta-roda e a placa do avental da carreta", "As mangueiras de ar estão conectadas", "O trem de pouso está levantado"],
          ["Прицеп выглядит ровно", "Рукоять расцепления прижата, захваты закрыты вокруг шкворня, и нет зазора между седельным устройством и опорной плитой прицепа", "Воздушные магистрали подключены", "Опорные стойки подняты"],
          ["Причіп виглядає рівно", "Руків'я розчеплення притиснуте, захвати закриті навколо шкворня, і немає зазору між сідельним пристроєм та опорною плитою причепа", "Повітряні магістралі підключені", "Опорні стійки підняті"],
        ),
      },
    ],
  },
  "winter-ice": {
    title: t3("Direção no Inverno e no Gelo", "Вождение зимой и по льду", "Водіння взимку та на льоду"),
    blurb: t3(
      "Reduza antes de ser obrigado, leia o gelo negro, coloque correntes a tempo e saiba quando a resposta é estacionar.",
      "Снижайте скорость до того, как придётся, читайте чёрный лёд, ставьте цепи вовремя и знайте, когда ответ — встать на стоянку.",
      "Знижуйте швидкість до того, як доведеться, читайте чорний лід, ставте ланцюги вчасно і знайте, коли відповідь — стати на стоянку.",
    ),
    lessons: [
      {
        title: t3("Reduza antes de ser obrigado", "Снижайте скорость до того, как придётся", "Знижуйте швидкість до того, як доведеться"),
        body: t3(
          "Tração perdida é velocidade que você não recupera. Em pista molhada, corte a velocidade em cerca de um terço; em neve compactada, corte pela metade; no gelo, a velocidade segura pode ser um arrastar — ou zero. Se a estrada está com gelo e o vento está empurrando, estacionar não é desistir, é a decisão profissional. Pontes e viadutos congelam primeiro porque o ar frio passa por baixo deles, e curvas sombreadas continuam com gelo depois que os trechos ensolarados já limparam. Se o spray dos outros pneus parar de repente, a água na estrada está virando gelo sob você.",
          "Потерянное сцепление — это скорость, которую не вернёшь. На мокром покрытии снижайте скорость примерно на треть; на утрамбованном снегу — наполовину; на льду безопасная скорость может быть «ползком» — или ноль. Если дорога во льду и ветер толкает, стоянка — не сдача, а профессиональное решение. Мосты и эстакады замерзают первыми, потому что холодный воздух проходит под ними, а затенённые кривые остаются во льду после того, как солнечные участки уже очистились. Если брызги из-под чужих шин вдруг прекратились, вода на дороге превращается в лёд под вами.",
          "Втрачене зчеплення — це швидкість, яку не повернеш. На мокрому покритті знижуйте швидкість приблизно на третину; на утрамбованому снігу — наполовину; на льоду безпечна швидкість може бути «повзком» — або нуль. Якщо дорога в льоду і вітер штовхає, стоянка — не здача, а професійне рішення. Мости та естаради замерзають першими, бо холодне повітря проходить під ними, а затінені криві залишаються в льоду після того, як сонячні ділянки вже очистилися. Якщо бризки з-під чужих шин раптом припинилися, вода на дорозі перетворюється на лід під вами.",
        ),
      },
      {
        title: t3("Movimentos gentis, distâncias longas", "Мягкие движения, длинные дистанции", "М'які рухи, довгі дистанції"),
        body: t3(
          "Em estradas escorregadias, cada movimento é pela metade: metade da direção, metade do acelerador, metade do freio, o dobro da distância de seguimento. Desligue o piloto automático — ele não sente um deslizamento começando e pode tocar as rodas exatamente quando elas deveriam rolar livres. Use o freio motor com cuidado: em superfícies muito escorregadias, um freio Jake forte pode soltar os pneus de tração, então muitas frotas ensinam a usá-lo baixo ou desligado no gelo. Se a carreta começar a vir para o lado, o pior movimento é um freio forte; motoristas treinados tiram o pé e dirigem gentilmente na direção do desvio da carreta para endireitar o conjunto.",
          "На скользкой дороге каждое движение — наполовину: половина руля, половина газа, половина тормоза, вдвое больше дистанция. Отключайте круиз-контроль — он не чувствует начало скольжения и может крутить колёса именно тогда, когда им надо катиться свободно. Моторный тормоз используйте осторожно: на очень скользкой поверхности сильный Jake brake может сорвать ведущие колёса, поэтому многие автопарки учат держать его на минимуме или выключенным на льду. Если прицеп начинает уходить в сторону, худшее движение — резкий тормоз; обученные водители отпускают педали и мягко рулят в сторону увода прицепа, чтобы выровнять автопоезд.",
          "На слизькій дорозі кожен рух — наполовину: половина керма, половина газу, половина гальма, вдвічі більша дистанція. Вимикайте круїз-контроль — він не відчуває початку ковзання і може крутити колеса саме тоді, коли їм треба котитися вільно. Моторне гальмо використовуйте обережно: на дуже слизькій поверхні сильний Jake brake може зірвати ведучі колеса, тому багато автопарків вчать тримати його на мінімумі або вимкненим на льоду. Якщо причіп починає йти вбік, найгірший рух — різке гальмо; навчені водії відпускають педалі і м'яко кермують у бік відведення причепа, щоб вирівняти автопоїзд.",
        ),
      },
      {
        title: t3("Correntes e o kit de inverno", "Цепи и зимний комплект", "Ланцюги та зимовий комплект"),
        body: t3(
          "As leis de correntes não são sugestões: quando a placa de correntes está ligada, você coloca as correntes ANTES do posto de controle ou da subida escorregadia, não nela. Pratique colocar suas correntes durante o dia no pátio para a primeira vez não ser à meia-noite em uma tempestade; leve uma lanterna, luvas e algo impermeável para ajoelhar. Depois de colocar as correntes, dirija uma curta distância e reaperte. Seu kit de inverno merece o espaço: tratamento extra de combustível contra gelificação, um raspador, fluido de lavador classificado para o frio, comida, água, cobertores e um carregador de telefone — uma noite estacionado em uma tempestade deve ser um inconveniente, não uma emergência.",
          "Законы о цепях — не предложения: когда знак цепей включён, вы ставите цепи ДО контрольного пункта или скользкого подъёма, а не на нём. Потренируйтесь ставить цепи днём на базе, чтобы первый раз не был в полночь в метель; берите фонарь, перчатки и что-то непромокаемое под колени. Поставив цепи, проедьте короткое расстояние и подтяните их. Зимний комплект окупает своё место: дополнительная присадка от гелеобразования топлива, скребок, незамерзайка, рассчитанная на мороз, еда, вода, одеяла и зарядка для телефона — ночь на стоянке в метель должна быть неудобством, а не чрезвычайной ситуацией.",
          "Закони про ланцюги — не пропозиції: коли знак ланцюгів увімкнено, ви ставите ланцюги ДО контрольного пункту або слизького підйому, а не на ньому. Потренуйтеся ставити ланцюги вдень на базі, щоб перший раз не був опівночі в хуртовину; беріть ліхтар, рукавички і щось непромокне під коліна. Поставивши ланцюги, проїдьте коротку відстань і підтягніть їх. Зимовий комплект окупає своє місце: додаткова присадка від гелювання пального, скребок, незамерзайка, розрахована на мороз, їжа, вода, ковдри і зарядка для телефону — ніч на стоянці в хуртовину має бути незручністю, а не надзвичайною ситуацією.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Em neve compactada, sua velocidade geralmente deve ser cortada em cerca de…",
          "На утрамбованном снегу скорость обычно следует снизить примерно на…",
          "На утрамбованому снігу швидкість зазвичай слід знизити приблизно на…",
        ),
        opts: a3(
          ["Um terço", "Metade", "Nada, se você tem pneus bons", "Exatamente 10 mph"],
          ["Треть", "Половину", "Ничего, если шины хорошие", "Ровно на 10 миль/ч"],
          ["Третину", "Половину", "Нічого, якщо шини добрі", "Рівно на 10 миль/год"],
        ),
      },
      {
        q: t3(
          "No gelo, o controle de cruzeiro deve estar…",
          "На льду круиз-контроль должен быть…",
          "На льоду круїз-контроль має бути…",
        ),
        opts: a3(
          ["Ligado — ele mantém a velocidade suavemente", "Ajustado 5 mph abaixo", "Desligado — ele não sente um deslizamento e pode tocar as rodas no momento errado", "Usado só em descidas"],
          ["Включён — он держит скорость плавно", "Установлен на 5 миль/ч ниже", "Выключен — он не чувствует скольжения и может крутить колёса в неверный момент", "Используется только на спусках"],
          ["Увімкнений — він тримає швидкість плавно", "Встановлений на 5 миль/год нижче", "Вимкнений — він не відчуває ковзання і може крутити колеса в невірний момент", "Використовується лише на спусках"],
        ),
      },
      {
        q: t3(
          "Onde o gelo geralmente se forma PRIMEIRO?",
          "Где лёд обычно образуется ПЕРВЫМ?",
          "Де лід зазвичай утворюється ПЕРШИМ?",
        ),
        opts: a3(
          ["Em trechos retos e ensolarados", "Em pontes e viadutos, e em curvas sombreadas", "Só em postos de parada", "Em acostamentos de cascalho"],
          ["На солнечных прямых участках", "На мостах и эстакадах, и в затенённых кривых", "Только на стоянках грузовиков", "На гравийных обочинах"],
          ["На сонячних прямих ділянках", "На мостах та естакадах, і в затінених кривих", "Лише на стоянках вантажівок", "На гравійних узбіччях"],
        ),
      },
      {
        q: t3(
          "Uma parada repentina no spray da estrada dos pneus de outros veículos pode significar…",
          "Внезапное прекращение брызг из-под шин других машин может означать…",
          "Раптове припинення бризок з-під шин інших машин може означати…",
        ),
        opts: a3(
          ["O tráfego está acelerando", "A água na estrada está congelando e virando gelo", "Seus espelhos estão embaçados", "A chuva acabou de vez"],
          ["Поток ускоряется", "Вода на дороге замерзает в лёд", "Ваши зеркала запотели", "Дождь закончился навсегда"],
          ["Потік прискорюється", "Вода на дорозі замерзає в лід", "Ваші дзеркала запітніли", "Дощ закінчився назавжди"],
        ),
      },
      {
        q: t3(
          "Quando a lei de correntes está em vigor, o momento certo de colocar as correntes é…",
          "Когда действует закон о цепях, правильное время поставить цепи — …",
          "Коли діє закон про ланцюги, правильний час поставити ланцюги — …",
        ),
        opts: a3(
          ["Na própria subida escorregadia", "Só se você ficar preso", "Antes do posto de controle ou da subida — em uma área segura e designada", "Na próxima parada de combustível, quando for"],
          ["На самом скользком подъёме", "Только если вы застряли", "До контрольного пункта или подъёма — в безопасном, обозначенном месте", "На следующей заправке, когда бы она ни была"],
          ["На самому слизькому підйомі", "Лише якщо ви застрягли", "До контрольного пункту або підйому — у безпечному, позначеному місці", "На наступній заправці, коли б вона не була"],
        ),
      },
    ],
  },
  "load-securement": {
    title: t3("Fixação da Carga", "Крепление груза", "Кріплення вантажу"),
    blurb: t3(
      "Limites de carga de trabalho, contagem de amarrações e as paradas de rechecagem que mantêm a carga — e você — legais.",
      "Рабочие пределы нагрузки, число креплений и остановки для повторной проверки, которые держат груз — и вас — в законе.",
      "Робочі межі навантаження, кількість кріплень і зупинки для повторної перевірки, що тримають вантаж — і вас — у законі.",
    ),
    lessons: [
      {
        title: t3("A regra dos 50 por cento", "Правило 50 процентов", "Правило 50 відсотків"),
        body: t3(
          "A matemática da fixação começa com um número: o limite de carga de trabalho agregado das suas amarrações deve ser pelo menos 50 por cento do peso da carga. Uma máquina de 40.000 libras precisa de amarrações cujos limites de carga de trabalho somem pelo menos 20.000 libras. Cada cinta e corrente tem uma classificação, e a classificação de uma cinta danificada é zero — cortes, desfiamentos e costuras rompidas a aposentam na hora. O atrito também importa: uma carga que pode deslizar precisa de mais fixação, e amarrações diretas (presas na própria carga) contam diferente das indiretas que passam por cima.",
          "Математика крепления начинается с одного числа: суммарный рабочий предел нагрузки ваших креплений должен быть не менее 50 процентов веса груза. Машине в 40 000 фунтов нужны крепления, чьи рабочие пределы в сумме дают не менее 20 000 фунтов. Каждый ремень и цепь имеют рейтинг, а рейтинг повреждённого ремня — ноль: порезы, потёртости и порванные швы выводят его из работы на месте. Трение тоже важно: груз, который может скользить, требует больше креплений, а прямые крепления (присоединённые к самому грузу) считаются иначе, чем непрямые, проходящие сверху.",
          "Математика кріплення починається з одного числа: сумарна робоча межа навантаження ваших кріплень має бути не менше 50 відсотків ваги вантажу. Машині у 40 000 фунтів потрібні кріплення, чиї робочі межі в сумі дають щонайменше 20 000 фунтів. Кожен ремінь і ланцюг мають рейтинг, а рейтинг пошкодженого ременя — нуль: порізи, потертості та порвані шви виводять його з роботи на місці. Тертя теж важливе: вантаж, який може ковзати, вимагає більше кріплень, а прямі кріплення (приєднані до самого вантажу) рахуються інакше, ніж непрямі, що проходять зверху.",
        ),
      },
      {
        title: t3("Quantas amarrações?", "Сколько креплений?", "Скільки кріплень?"),
        body: t3(
          "O comprimento define a contagem mínima: um artigo de 5 pés ou menos e 1.100 libras ou menos precisa de pelo menos uma amarração; artigos mais longos ou mais pesados precisam de duas; e depois de 10 pés, adicione mais uma para cada 10 pés adicionais ou parte deles. Veículos pesados e máquinas têm suas próprias regras — quatro amarrações no mínimo, uma em cada canto, mais correntes nos equipamentos acessórios. Protetores de borda não são decoração: um canto afiado corta uma cinta sob carga, então proteja cada cinta que cruza uma borda. Quando uma carga está bloqueada ou apoiada contra um painel dianteiro, essa estrutura também precisa ser forte o bastante para o trabalho.",
          "Длина определяет минимальное число: предмет 5 футов или короче и 1 100 фунтов или легче требует не менее одного крепления; более длинные или тяжёлые предметы требуют двух; а после 10 футов добавляйте ещё одно на каждые дополнительные 10 футов или их часть. У тяжёлых машин и оборудования свои правила — минимум четыре крепления, по одному на каждый угол, плюс цепи на навесное оборудование. Защита кромок — не украшение: острый угол режет ремень под нагрузкой, поэтому защищайте каждый ремень, который пересекает кромку. Когда груз заблокирован или упёрт в передний борт, эта конструкция сама должна быть достаточно прочной для работы.",
          "Довжина визначає мінімальну кількість: предмет 5 футів або коротший і 1 100 фунтів або легший вимагає щонайменше одного кріплення; довші або важчі предмети вимагають двох; а після 10 футів додавайте ще одне на кожні додаткові 10 футів або їх частину. У важких машин та обладнання свої правила — мінімум чотири кріплення, по одному на кожен кут, плюс ланцюги на навісне обладнання. Захист кромок — не прикраса: гострий кут ріже ремінь під навантаженням, тож захищайте кожен ремінь, який перетинає кромку. Коли вантаж заблоковано або вперто в передній борт, ця конструкція сама має бути достатньо міцною для роботи.",
        ),
      },
      {
        title: t3("Reverifique cedo, reverifique sempre", "Проверяйте рано, проверяйте часто", "Перевіряйте рано, перевіряйте часто"),
        body: t3(
          "As cargas assentam. As cintas esticam, a carga se move um quarto de polegada por vez, e a vibração solta os ganchos. A regra: inspecione a fixação dentro das primeiras 50 milhas depois do carregamento, depois de novo a cada 3 horas ou 150 milhas, e a cada mudança de status de serviço. Sempre que encontrar uma cinta solta, conserte ali — não no destino. Um policial que encontra uma violação de fixação pode colocar o caminhão fora de serviço, e uma carga que cai da carreta é um dia que muda a vida de quem estiver atrás de você.",
          "Грузы оседают. Ремни тянутся, груз сдвигается по четверти дюйма за раз, а вибрация ослабляет крюки. Правило: осмотрите крепление в первые 50 миль после погрузки, затем снова каждые 3 часа или 150 миль, и при каждой смене статуса смены. Нашли ослабший ремень — исправляйте там же, а не в пункте назначения. Инспектор, нашедший нарушение крепления, может вывести грузовик из эксплуатации, а груз, упавший с прицепа, — это день, меняющий жизнь того, кто едет позади вас.",
          "Вантажі осідають. Ремені тягнуться, вантаж зсувається по чверті дюйма за раз, а вібрація послаблює гаки. Правило: огляньте кріплення в перші 50 миль після навантаження, потім знову кожні 3 години або 150 миль, і за кожної зміни статусу зміни. Знайшли ослаблений ремінь — виправляйте там же, а не в пункті призначення. Інспектор, який знайшов порушення кріплення, може вивести вантажівку з експлуатації, а вантаж, що впав із причепа, — це день, що змінює життя того, хто їде позаду вас.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "O limite de carga de trabalho agregado das suas amarrações deve ser pelo menos…",
          "Суммарный рабочий предел нагрузки ваших креплений должен быть не менее…",
          "Сумарна робоча межа навантаження ваших кріплень має бути не менше…",
        ),
        opts: a3(
          ["10% do peso da carga", "25% do peso da carga", "50% do peso da carga", "O dobro do peso da carga"],
          ["10% веса груза", "25% веса груза", "50% веса груза", "Двойного веса груза"],
          ["10% ваги вантажу", "25% ваги вантажу", "50% ваги вантажу", "Подвійної ваги вантажу"],
        ),
      },
      {
        q: t3(
          "Uma máquina de 40.000 lb precisa, portanto, de amarrações classificadas no total para pelo menos…",
          "Машине в 40 000 фунтов поэтому нужны крепления с суммарным рейтингом не менее…",
          "Машині у 40 000 фунтів тому потрібні кріплення із сумарним рейтингом щонайменше…",
        ),
        opts: a3(
          ["4.000 lb", "10.000 lb", "20.000 lb", "40.000 lb só de corrente"],
          ["4 000 фунтов", "10 000 фунтов", "20 000 фунтов", "40 000 фунтов только цепи"],
          ["4 000 фунтів", "10 000 фунтів", "20 000 фунтів", "40 000 фунтів лише ланцюга"],
        ),
      },
      {
        q: t3(
          "A PRIMEIRA rechecagem da fixação durante a viagem deve acontecer…",
          "ПЕРВАЯ повторная проверка крепления в пути должна произойти…",
          "ПЕРША повторна перевірка кріплення в дорозі має відбутися…",
        ),
        opts: a3(
          ["Dentro das primeiras 50 milhas depois do carregamento", "No destino", "Depois de 500 milhas", "Só se a carga parecer solta"],
          ["В первые 50 миль после погрузки", "В пункте назначения", "После 500 миль", "Только если груз кажется ослабшим"],
          ["У перші 50 миль після навантаження", "У пункті призначення", "Після 500 миль", "Лише якщо вантаж здається ослабленим"],
        ),
      },
      {
        q: t3(
          "Os protetores de borda existem para…",
          "Защита кромок существует, чтобы…",
          "Захист кромок існує, щоб…",
        ),
        opts: a3(
          ["Deixar a carga arrumada", "Adicionar peso", "Marcar os cantos para outros motoristas", "Impedir que bordas afiadas da carga cortem as amarrações sob carga"],
          ["Груз выглядел аккуратно", "Добавить вес", "Отметить углы для других водителей", "Острые кромки груза не резали крепления под нагрузкой"],
          ["Вантаж виглядав охайно", "Додати вагу", "Позначити кути для інших водіїв", "Гострі кромки вантажу не різали кріплення під навантаженням"],
        ),
      },
      {
        q: t3(
          "Uma cinta com um corte ou costura rompida tem um limite de carga de trabalho de…",
          "Ремень с порезом или порванным швом имеет рабочий предел нагрузки…",
          "Ремінь із порізом або порваним швом має робочу межу навантаження…",
        ),
        opts: a3(
          ["Metade da sua classificação", "Zero — ela é aposentada na hora", "Sua classificação completa se o corte é pequeno", "O que o embarcador disser"],
          ["Половину своего рейтинга", "Ноль — он выводится из работы на месте", "Полный рейтинг, если порез маленький", "Сколько скажет грузоотправитель"],
          ["Половину свого рейтингу", "Нуль — він виводиться з роботи на місці", "Повний рейтинг, якщо поріз маленький", "Скільки скаже відправник"],
        ),
      },
    ],
  },
  "fatigue-wellness": {
    title: t3("Fadiga e Bem-Estar", "Усталость и самочувствие", "Втома та самопочуття"),
    blurb: t3(
      "Ciência do sono que realmente se aplica às 2 da manhã: sinais de alerta, a regra do cochilo e os limites reais da cafeína.",
      "Наука сна, которая реально работает в 2 часа ночи: тревожные признаки, правило короткого сна и настоящие пределы кофеина.",
      "Наука сну, яка реально працює о 2-й ночі: тривожні ознаки, правило короткого сну і справжні межі кофеїну.",
    ),
    lessons: [
      {
        title: t3("O sono é a única cura", "Сон — единственное лекарство", "Сон — єдині ліки"),
        body: t3(
          "Adultos precisam de 7 a 9 horas de sono, e um motorista que funciona com 5 está dirigindo prejudicado — estudos comparam a vigília longa ao álcool no que ela faz com o tempo de reação. Nada substitui: nem café, nem janela fria, nem música alta. Os pontos baixos do corpo vêm duas vezes ao dia, aproximadamente das 2 às 6 da manhã e de novo no meio da tarde, e é aí que os acidentes por fadiga se concentram. Um cochilo de 20 minutos em um lugar seguro é a única ferramenta de estrada que realmente funciona — curto o bastante para acordar limpo, longo o bastante para resetar o pior da pressão do sono.",
          "Взрослым нужно от 7 до 9 часов сна, и водитель, который работает на 5 часах, ведёт в состоянии ухудшения — исследования сравнивают долгое бодрствование с алкоголем по влиянию на скорость реакции. Ничто не заменит: ни кофе, ни холодное окно, ни громкая музыка. Низкие точки организма наступают дважды в день, примерно с 2 до 6 утра и снова в середине дня, и именно тогда скапливаются аварии от усталости. 20-минутный сон в безопасном месте — единственный придорожный инструмент, который реально работает: достаточно короткий, чтобы проснуться ясным, и достаточно длинный, чтобы сбросить худшее давление сна.",
          "Дорослим треба від 7 до 9 годин сну, і водій, який працює на 5 годинах, веде в погіршеному стані — дослідження порівнюють довге неспання з алкоголем за впливом на швидкість реакції. Ніщо не замінить: ні кава, ні холодне вікно, ні гучна музика. Низькі точки організму настають двічі на день, приблизно з 2 до 6 ранку і знову в середині дня, і саме тоді скупчуються аварії від втоми. 20-хвилинний сон у безпечному місці — єдиний придорожній інструмент, який реально працює: достатньо короткий, щоб прокинутися ясним, і достатньо довгий, щоб скинути найгірший тиск сну.",
        ),
      },
      {
        title: t3("Conheça seus sinais de alerta", "Знайте свои тревожные признаки", "Знайте свої тривожні ознаки"),
        body: t3(
          "A fadiga se anuncia antes de levar você: bocejos frequentes, pálpebras pesadas, desviar na faixa, perder uma placa ou uma saída que você conhece, esquecer as últimas milhas, assustar-se consigo mesmo. Qualquer um deles significa que a decisão já está tomada — a única questão é se você estaciona de propósito ou a estrada decide por você. Um microsono de quatro segundos a 60 mph cobre cerca de 350 pés às cegas. Não há carga, compromisso ou despachante que valha esses 350 pés.",
          "Усталость объявляет о себе до того, как заберёт вас: частая зевота, тяжёлые веки, уход в полосе, пропущенный знак или знакомый съезд, забытые последние мили, вздрагивание от неожиданности. Любой из них означает, что решение уже принято, — вопрос лишь в том, встанете ли вы на стоянку сами или дорога решит за вас. Четырёхсекундный микросон на 60 миль/ч — это около 350 футов вслепую. Нет груза, срока и диспетчера, стоящих этих 350 футов.",
          "Втома оголошує про себе до того, як забере вас: часте позіхання, важкі повіки, відхід у смузі, пропущений знак або знайомий з'їзд, забуті останні милі, здригання від несподіванки. Будь-яка з них означає, що рішення вже ухвалене, — питання лише в тому, чи станете ви на стоянку самі, чи дорога вирішить за вас. Чотирисекундний мікросон на 60 миль/год — це близько 350 футів наосліп. Немає вантажу, строку і диспетчера, вартих цих 350 футів.",
        ),
      },
      {
        title: t3("Cafeína, comida e o longo prazo", "Кофеин, еда и долгая игра", "Кофеїн, їжа і довга гра"),
        body: t3(
          "A cafeína leva cerca de 30 minutos para fazer efeito e fica no seu sistema por horas — um café antes de um cochilo (o 'cochilo com café') pode somar os dois benefícios, mas cafeína tarde em um turno pega emprestado do sono que você precisa depois dele. Refeições pesadas e gordurosas puxam o sangue para o seu intestino e puxam sua atenção junto; refeições mais leves, água e caminhadas curtas nas paradas mantêm você mais estável. Ao longo de uma carreira, o básico do bem-estar se acumula: mova-se diariamente, proteja seu sono como um compromisso, e mantenha seu cartão médico honesto — esconder uma condição não ajuda ninguém quando algo dá errado.",
          "Кофеину нужно около 30 минут, чтобы подействовать, и он остаётся в организме часами — кофе перед сном («кофейный сон») может сложить оба преимущества, но кофеин поздно в смене берёт взаймы у сна, который нужен вам после неё. Тяжёлая жирная еда тянет кровь к кишечнику и тянет вниз вашу внимательность вместе с ней; лёгкая еда, вода и короткие прогулки на остановках держат вас ровнее. За карьеру основы самочувствия складываются: двигайтесь каждый день, охраняйте сон как встречу, и держите медицинскую карту честной — скрывать состояние не поможет никому, когда что-то пойдёт не так.",
          "Кофеїну треба близько 30 хвилин, щоб подіяти, і він залишається в організмі годинами — кава перед сном («кавовий сон») може скласти обидві переваги, але кофеїн пізно у зміні бере в борг у сну, який потрібен вам після неї. Важка жирна їжа тягне кров до кишківника і тягне вниз вашу уважність разом із нею; легка їжа, вода і короткі прогулянки на зупинках тримають вас рівнішими. За кар'єру основи самопочуття складаються: рухайтеся щодня, охороняйте сон як зустріч, і тримайте медичну картку чесною — приховувати стан не допоможе нікому, коли щось піде не так.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "A única cura real para dirigir com sono é…",
          "Единственное настоящее лекарство от сонливого вождения — …",
          "Єдині справжні ліки від сонливого водіння — …",
        ),
        opts: a3(
          ["Café e um energético", "Abrir a janela", "Sono — incluindo um cochilo curto em um lugar seguro", "Aumentar o rádio"],
          ["Кофе и энергетик", "Открыть окно", "Сон — включая короткий сон в безопасном месте", "Сделать радио громче"],
          ["Кава та енергетик", "Відкрити вікно", "Сон — включно з коротким сном у безпечному місці", "Зробити радіо гучніше"],
        ),
      },
      {
        q: t3(
          "Um microsono de 4 segundos a 60 mph cobre cerca de…",
          "Микросон в 4 секунды на 60 миль/ч покрывает около…",
          "Мікросон у 4 секунди на 60 миль/год покриває близько…",
        ),
        opts: a3(
          ["35 pés", "100 pés", "350 pés — às cegas", "O comprimento de um caminhão"],
          ["35 футов", "100 футов", "350 футов — вслепую", "Одну длину грузовика"],
          ["35 футів", "100 футів", "350 футів — наосліп", "Одну довжину вантажівки"],
        ),
      },
      {
        q: t3(
          "Os acidentes por fadiga se concentram mais em quais horas?",
          "В какие часы аварии от усталости скапливаются сильнее всего?",
          "У які години аварії від втоми скупчуються найсильніше?",
        ),
        opts: a3(
          ["Das 9h ao meio-dia", "Aproximadamente das 2 às 6 da manhã e de novo no meio da tarde", "Só às sextas-feiras", "Sempre que chove"],
          ["С 9 утра до полудня", "Примерно с 2 до 6 утра и снова в середине дня", "Только по пятницам", "Когда идёт дождь"],
          ["З 9 ранку до полудня", "Приблизно з 2 до 6 ранку і знову в середині дня", "Лише по п'ятницях", "Коли йде дощ"],
        ),
      },
      {
        q: t3(
          "Qual destes é um sinal de alerta confiável de que você deve parar e descansar?",
          "Что из этого — надёжный тревожный признак, что нужно остановиться и отдохнуть?",
          "Що з цього — надійна тривожна ознака, що треба зупинитися і відпочити?",
        ),
        opts: a3(
          ["Você se sente alerta depois do café", "Desviar na sua faixa e esquecer as últimas milhas", "Sua música favorita toca", "O tráfego está leve"],
          ["Вы чувствуете бодрость после кофе", "Уход в полосе и забытые последние мили", "Заиграла любимая песня", "Поток лёгкий"],
          ["Ви відчуваєте бадьорість після кави", "Відхід у смузі та забуті останні милі", "Заграла улюблена пісня", "Потік легкий"],
        ),
      },
      {
        q: t3(
          "Os limites honestos da cafeína são…",
          "Честные пределы кофеина — …",
          "Чесні межі кофеїну — …",
        ),
        opts: a3(
          ["Ela substitui o sono completamente", "Ela funciona na hora e dura 10 minutos", "Ela nunca afeta o sono depois", "Ela leva ~30 minutos para fazer efeito, dura horas e não substitui o sono"],
          ["Он полностью заменяет сон", "Он действует мгновенно и держится 10 минут", "Он никогда не влияет на последующий сон", "Ему нужно ~30 минут, чтобы подействовать, он держится часами и не заменяет сон"],
          ["Він повністю замінює сон", "Він діє миттєво і тримається 10 хвилин", "Він ніколи не впливає на подальший сон", "Йому треба ~30 хвилин, щоб подіяти, він тримається годинами і не замінює сон"],
        ),
      },
    ],
  },
  "distracted-driving": {
    title: t3("Direção Distraída e Política de Telefone", "Отвлечённое вождение и политика телефона", "Відволікання за кермом і політика телефону"),
    blurb: t3(
      "A regra do aparelho na mão, por que mandar mensagem é a pior distração que existe, e preparar o caminhão antes de ele se mover.",
      "Правило «телефон не в руках», почему переписка — худшее отвлечение из всех, и подготовка грузовика до начала движения.",
      "Правило «телефон не в руках», чому листування — найгірше відволікання з усіх, і підготовка вантажівки до початку руху.",
    ),
    lessons: [
      {
        title: t3("Tire as mãos do telefone — é a regra, não uma dica", "Руки прочь от телефона — это правило, а не совет", "Руки геть від телефону — це правило, а не порада"),
        body: t3(
          "As regras federais para motoristas de CMV são diretas: nada de segurar um telefone, nada de alcançar um, nada de discar apertando mais de um único botão, nada de mensagens, nada de ler mensagens enquanto dirige. Uma violação significa multas para você e para uma transportadora que permite, mais desqualificação por reincidência — e depois de um acidente, os registros do telefone são a primeira coisa que os investigadores puxam. Viva-voz, um toque, montado: essa é a forma legal de usar o telefone em um caminhão em movimento. Todo o resto espera o freio de estacionamento.",
          "Федеральные правила для водителей CMV прямы: нельзя держать телефон, нельзя тянуться за ним, нельзя набирать номер больше чем одним нажатием, нельзя писать и читать сообщения за рулём. Нарушение означает штрафы вам и перевозчику, который это допускает, плюс дисквалификацию за повторные нарушения — а после аварии записи телефона — первое, что запрашивают следователи. Громкая связь, одно касание, телефон закреплён: это легальная форма использования телефона в движущемся грузовике. Всё остальное ждёт стояночного тормоза.",
          "Федеральні правила для водіїв CMV прямі: не можна тримати телефон, не можна тягнутися за ним, не можна набирати номер більше ніж одним натисканням, не можна писати й читати повідомлення за кермом. Порушення означає штрафи вам і перевізнику, який це допускає, плюс дискваліфікацію за повторні порушення — а після аварії записи телефону — перше, що запитують слідчі. Гучний зв'язок, одне торкання, телефон закріплений: це легальна форма використання телефону у вантажівці, що рухається. Все інше чекає на стоянкове гальмо.",
        ),
      },
      {
        title: t3("Por que mandar mensagem é a pior", "Почему переписка — худший вариант", "Чому листування — найгірший варіант"),
        body: t3(
          "A distração vem em três tipos — olhos fora da estrada, mãos fora do volante, mente fora da direção — e mandar mensagem é os três ao mesmo tempo. Pesquisas federais descobriram que mandar mensagem dirigindo um veículo comercial multiplica o risco de acidente muitas vezes (o número da FMCSA citado comumente é 23 vezes). Ler ou enviar uma mensagem tira seus olhos por cerca de cinco segundos: a 55 mph isso é mais que o comprimento de um campo de futebol, cruzado às cegas. Uma mensagem do despacho, uma mensagem da família, um preço de combustível — nenhum deles foi escrito para um caminhão em movimento, e todos eles ainda estarão lá na próxima parada.",
          "Отвлечение бывает трёх видов — глаза не на дороге, руки не на руле, разум не на вождении — и переписка соединяет все три сразу. Федеральные исследования показали, что переписка за рулём коммерческого транспорта умножает риск аварии многократно (часто цитируемая цифра FMCSA — 23 раза). Чтение или отправка сообщения уводит ваши глаза примерно на пять секунд: на 55 миль/ч это больше длины футбольного поля, пройденной вслепую. Сообщение диспетчера, сообщение семьи, цена топлива — ни одно из них не написано для движущегося грузовика, и все они будут на месте на следующей остановке.",
          "Відволікання буває трьох видів — очі не на дорозі, руки не на кермі, розум не на водінні — і листування поєднує всі три одразу. Федеральні дослідження показали, що листування за кермом комерційного транспорту множить ризик аварії багаторазово (часто цитована цифра FMCSA — 23 рази). Читання або надсилання повідомлення відводить ваші очі приблизно на п'ять секунд: на 55 миль/год це більше довжини футбольного поля, пройденої наосліп. Повідомлення диспетчера, повідомлення родини, ціна пального — жодне з них не написане для вантажівки, що рухається, і всі вони будуть на місці на наступній зупинці.",
        ),
      },
      {
        title: t3("Prepare o caminhão antes de ele se mover", "Подготовьте грузовик до начала движения", "Підготуйте вантажівку до початку руху"),
        body: t3(
          "A maior parte da distração na cabine é um problema de preparação. Antes de rodar: rota inserida, telefone montado e em não perturbe para alertas não essenciais, playlist ou rádio escolhido, comida e bebida ao alcance e abertas, papelada do despacho onde você pode olhar legalmente em uma parada. Diga à família e ao despacho o seu padrão — 'Eu respondo nas paradas de combustível' — para ninguém esperar uma resposta em movimento. Se uma ligação ou mensagem realmente não pode esperar, o movimento profissional é o mesmo que para a fadiga: encontre um lugar seguro, estacione, acione o freio, então dê sua atenção total.",
          "Большая часть отвлечений в кабине — проблема подготовки. Перед выездом: маршрут введён, телефон закреплён и в режиме «не беспокоить» для несущественных уведомлений, плейлист или радио выбраны, еда и питьё в пределах досягаемости и открыты, документы диспетчера там, где можно легально взглянуть на остановке. Скажите семье и диспетчеру ваш порядок — «Я отвечаю на заправках» — чтобы никто не ждал ответа в движении. Если звонок или сообщение действительно не могут ждать, профессиональный ход тот же, что при усталости: найдите безопасное место, встаньте на стоянку, поставьте тормоз, затем уделите полное внимание.",
          "Більшість відволікань у кабіні — проблема підготовки. Перед виїздом: маршрут введено, телефон закріплено і в режимі «не турбувати» для несуттєвих сповіщень, плейлист або радіо вибрано, їжа і питво в межах досяжності і відкриті, документи диспетчера там, де можна легально глянути на зупинці. Скажіть родині та диспетчеру ваш порядок — «Я відповідаю на заправках» — щоб ніхто не чекав відповіді в русі. Якщо дзвінок або повідомлення справді не можуть чекати, професійний хід той самий, що при втомі: знайдіть безпечне місце, станьте на стоянку, поставте гальмо, потім приділіть повну увагу.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Enquanto dirige um CMV, usar um telefone de mão para discar é…",
          "За рулём CMV набор номера с телефона в руках — …",
          "За кермом CMV набір номера з телефону в руках — …",
        ),
        opts: a3(
          ["Ok se o tráfego está leve", "Ok abaixo de 35 mph", "Proibido — junto com segurar, alcançar ou mandar mensagem no telefone", "Permitido só para ligações do despacho"],
          ["Нормально, если поток лёгкий", "Нормально ниже 35 миль/ч", "Запрещён — вместе с держанием телефона, тягой за ним и перепиской", "Разрешён только для звонков диспетчера"],
          ["Нормально, якщо потік легкий", "Нормально нижче 35 миль/год", "Заборонений — разом із триманням телефону, тягою за ним і листуванням", "Дозволений лише для дзвінків диспетчера"],
        ),
      },
      {
        q: t3(
          "Mandar mensagem é unicamente perigoso porque combina…",
          "Переписка уникально опасна, потому что соединяет…",
          "Листування унікально небезпечне, бо поєднує…",
        ),
        opts: a3(
          ["Velocidade e barulho", "Olhos fora da estrada, mãos fora do volante e mente fora da direção — tudo ao mesmo tempo", "Só tédio", "Interferência de rádio"],
          ["Скорость и шум", "Глаза не на дороге, руки не на руле и разум не на вождении — всё сразу", "Только скуку", "Радиопомехи"],
          ["Швидкість і шум", "Очі не на дорозі, руки не на кермі і розум не на водінні — все одразу", "Лише нудьгу", "Радіоперешкоди"],
        ),
      },
      {
        q: t3(
          "A 55 mph, os ~5 segundos que uma mensagem tira dos seus olhos cobrem…",
          "На 55 миль/ч ~5 секунд, на которые сообщение уводит глаза, покрывают…",
          "На 55 миль/год ~5 секунд, на які повідомлення відводить очі, покривають…",
        ),
        opts: a3(
          ["Cerca de 50 pés", "O comprimento de um caminhão", "Mais que o comprimento de um campo de futebol", "Meia milha"],
          ["Около 50 футов", "Одну длину грузовика", "Больше длины футбольного поля", "Полмили"],
          ["Близько 50 футів", "Одну довжину вантажівки", "Більше довжини футбольного поля", "Пів милі"],
        ),
      },
      {
        q: t3(
          "A forma legal de usar o telefone em um caminhão em movimento é…",
          "Легальная форма использования телефона в движущемся грузовике — …",
          "Легальна форма використання телефону у вантажівці, що рухається, — …",
        ),
        opts: a3(
          ["No seu colo, no viva-voz", "Montado, viva-voz, operação com um único botão", "De qualquer jeito, se você usa mensagem de voz", "Segurado baixo, fora da vista da câmera"],
          ["На коленях, на громкой связи", "Закреплён, громкая связь, управление одной кнопкой", "Как угодно, если используете голосовой ввод", "Держать низко, вне поля зрения камеры"],
          ["На колінах, на гучному зв'язку", "Закріплений, гучний зв'язок, керування однією кнопкою", "Як завгодно, якщо використовуєте голосове введення", "Тримати низько, поза полем зору камери"],
        ),
      },
      {
        q: t3(
          "Uma mensagem que realmente não pode esperar deve ser tratada…",
          "Сообщение, которое действительно не может ждать, следует обработать…",
          "Повідомлення, яке справді не може чекати, слід обробити…",
        ),
        opts: a3(
          ["No próximo semáforo", "Lendo rápido em velocidade de rodovia", "Reduzindo para 45 na faixa da direita", "Estacionado com segurança, com o freio acionado"],
          ["На следующем светофоре", "Быстро прочитав на скорости трассы", "Снизившись до 45 в правой полосе", "На безопасной стоянке, с поставленным тормозом"],
          ["На наступному світлофорі", "Швидко прочитавши на швидкості траси", "Знизившись до 45 у правій смузі", "На безпечній стоянці, з поставленим гальмом"],
        ),
      },
    ],
  },
  "backing-parking": {
    title: t3("Manobras de Ré, Estacionamento e Espaços Apertados", "Движение задним ходом, стоянка и тесные места", "Рух заднім ходом, стоянка і тісні місця"),
    blurb: t3(
      "GOAL, ajudantes, ré pelo lado da vista e planejar seu estacionamento antes que seu relógio planeje por você.",
      "GOAL, помощники, сдача назад со стороны обзора и планирование стоянки до того, как ваш счётчик спланирует её за вас.",
      "GOAL, помічники, здача назад з боку огляду і планування стоянки до того, як ваш лічильник спланує її за вас.",
    ),
    lessons: [
      {
        title: t3("GOAL — Saia e Olhe", "GOAL — выйди и посмотри", "GOAL — вийди і подивись"),
        body: t3(
          "A ré é onde caminhões lentos ainda causam danos rápidos, e a ferramenta mais barata do transporte é seus próprios dois pés: GOAL — Saia E Olhe (Get Out And Look). Antes de o caminhão se mover para trás, ande o caminho: verifique postes, fios baixos, placas de doca, carros estacionados, chão mole e o ângulo exato que você precisa. Depois dê ré prontamente — a imagem que você andou está mais fresca logo depois de andá-la, e se algo mudar ou a dúvida aparecer, GOAL de novo. Ninguém que conhece este negócio pensa menos de um motorista por sair duas vezes.",
          "Движение задним ходом — место, где медленные грузовики всё равно наносят быстрый ущерб, и самый дешёвый инструмент в грузоперевозках — ваши собственные ноги: GOAL — выйди и посмотри (Get Out And Look). До того как грузовик двинется назад, пройдите путь: проверьте столбы, низкие провода, пластины рампы, припаркованные машины, мягкий грунт и точный угол, который вам нужен. Затем сдавайте назад без промедления — картина, которую вы прошли, свежа сразу после прохода, и если что-то изменилось или подкралось сомнение, GOAL снова. Никто, кто знает это дело, не подумает хуже о водителе за то, что тот вышел дважды.",
          "Рух заднім ходом — місце, де повільні вантажівки все одно завдають швидкої шкоди, і найдешевший інструмент у вантажоперевезеннях — ваші власні ноги: GOAL — вийди і подивись (Get Out And Look). До того як вантажівка рушить назад, пройдіть шлях: перевірте стовпи, низькі дроти, пластини рампи, припарковані машини, м'який ґрунт і точний кут, який вам потрібен. Потім здавайте назад без зволікань — картина, яку ви пройшли, найсвіжіша одразу після проходу, і якщо щось змінилося або підкрався сумнів, GOAL знову. Ніхто, хто знає цю справу, не подумає гірше про водія за те, що той вийшов двічі.",
        ),
      },
      {
        title: t3("Ajudantes e ré pelo lado da vista", "Помощники и сдача назад со стороны обзора", "Помічники і здача назад з боку огляду"),
        body: t3(
          "Dê ré em direção ao seu lado do motorista sempre que puder montar assim — sua vista direta vence qualquer espelho para julgar o balanço da carreta. Se usar um ajudante, combine os sinais antes de se mover, mantenha-o no seu espelho o tempo todo, e siga a regra de ouro: se você perder o ajudante de vista, PARE. O ajudante observa as áreas cegas; você continua sendo quem dirige. Use as luzes de alerta, abaixe um vidro para ouvir, e dê uma buzinada curta antes de começar a ré em um pátio movimentado para anunciar o movimento.",
          "Сдавайте назад в сторону водителя всякий раз, когда можете так выстроиться, — ваш прямой обзор лучше любого зеркала для оценки заноса прицепа. Если используете помощника, договоритесь о сигналах до движения, держите его в зеркале всё время и следуйте золотому правилу: потеряли помощника из виду — СТОП. Помощник смотрит за слепыми зонами; за рулём по-прежнему вы. Включайте аварийку, опускайте окно, чтобы слышать, и коротко сигнальте перед началом сдачи назад на оживлённой площадке, чтобы объявить манёвр.",
          "Здавайте назад у бік водія щоразу, коли можете так вишикуватися, — ваш прямий огляд кращий за будь-яке дзеркало для оцінки заносу причепа. Якщо використовуєте помічника, домовтеся про сигнали до руху, тримайте його в дзеркалі весь час і дотримуйтесь золотого правила: втратили помічника з виду — СТОП. Помічник дивиться за сліпими зонами; за кермом, як і раніше, ви. Вмикайте аварійку, опускайте вікно, щоб чути, і коротко сигнальте перед початком здачі назад на жвавому майданчику, щоб оголосити маневр.",
        ),
      },
      {
        title: t3("Estacionamento é planejado, não encontrado", "Стоянка планируется, а не находится", "Стоянка планується, а не знаходиться"),
        body: t3(
          "O aperto de estacionamento depois do escuro é previsível, então planeje sua parada enquanto seu relógio ainda tem opções: escolha a parada principal e uma reserva, prefira vagas de passagem que permitem sair de frente, e evite estacionar em rampas e acostamentos, o que é ilegal em muitos estados e perigoso em todos os lugares. Em pátios apertados, GOAL também vale para estacionar — ande, anote o caminho de saída e monte de modo que uma saída pela manhã não precise de uma manobra de ré em uma multidão. Estacionar o caminhão arrumado, rodas retas e dentro das linhas, é a marca pela qual outros motoristas julgam você.",
          "Нехватка стоянок после темноты предсказуема, поэтому планируйте остановку, пока у счётчика ещё есть варианты: выберите основную остановку и запасную, предпочитайте проездные места, позволяющие выехать носом вперёд, и избегайте стоянки на съездах и обочинах — это незаконно во многих штатах и опасно везде. На тесных площадках GOAL работает и для стоянки — пройдите её, отметьте путь выезда и выстройтесь так, чтобы утренний выезд не требовал манёвра задним ходом в толпе. Аккуратно припаркованный грузовик, колёса прямо и внутри линий, — это знак, по которому вас судят другие водители.",
          "Брак стоянок після темряви передбачуваний, тож плануйте зупинку, доки у лічильника ще є варіанти: виберіть основну зупинку і запасну, віддавайте перевагу проїзним місцям, що дозволяють виїхати носом уперед, і уникайте стоянки на з'їздах та узбіччях — це незаконно в багатьох штатах і небезпечно скрізь. На тісних майданчиках GOAL працює і для стоянки — пройдіть її, відмітьте шлях виїзду і вишикуйтеся так, щоб ранковий виїзд не вимагав маневру заднім ходом у натовпі. Акуратно припаркована вантажівка, колеса прямо і всередині ліній, — це знак, за яким вас судять інші водії.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "GOAL significa…",
          "GOAL означает…",
          "GOAL означає…",
        ),
        opts: a3(
          ["Saia e Olhe (Get Out And Look)", "Vá e Carregue", "Óleo de Câmbio e Lubrificação", "Entre em uma Faixa"],
          ["Выйди и посмотри (Get Out And Look)", "Иди и грузись", "Масло для коробки и смазка", "Выйди на полосу"],
          ["Вийди і подивись (Get Out And Look)", "Іди і вантажся", "Олива для коробки і мастило", "Вийди на смугу"],
        ),
      },
      {
        q: t3(
          "Você perde seu ajudante de vista no meio da ré. Você deve…",
          "Вы потеряли помощника из виду в середине манёвра задним ходом. Вам следует…",
          "Ви втратили помічника з виду посеред маневру заднім ходом. Вам слід…",
        ),
        opts: a3(
          ["Continuar a ré devagar — ele vai sair do caminho", "Parar imediatamente até poder vê-lo de novo", "Acelerar para terminar antes que algo mude", "Buzinar até ele reaparecer, enquanto anda"],
          ["Продолжать медленно сдавать назад — он отойдёт", "Немедленно остановиться, пока не увидите его снова", "Ускориться, чтобы закончить, пока ничего не изменилось", "Сигналить, пока он не появится, продолжая движение"],
          ["Продовжувати повільно здавати назад — він відійде", "Негайно зупинитися, доки не побачите його знову", "Прискоритися, щоб закінчити, доки нічого не змінилося", "Сигналити, доки він не з'явиться, продовжуючи рух"],
        ),
      },
      {
        q: t3(
          "Quando você pode montar assim, deve dar ré em direção a…",
          "Когда можете так выстроиться, сдавать назад следует в сторону…",
          "Коли можете так вишикуватися, здавати назад слід у бік…",
        ),
        opts: a3(
          ["O lado cego (do passageiro)", "O lado que estiver mais perto", "Seu lado do motorista (da vista), onde sua vista direta é melhor", "Nunca importa"],
          ["Слепой (пассажирской) стороны", "Какой стороны ближе", "Вашей водительской стороны (стороны обзора), где прямой обзор лучше", "Это никогда не важно"],
          ["Сліпого (пасажирського) боку", "Який бік ближчий", "Вашого водійського боку (боку огляду), де прямий огляд найкращий", "Це ніколи не важливо"],
        ),
      },
      {
        q: t3(
          "No meio de uma manobra de ré, a dúvida aparece sobre o que está atrás da carreta. O movimento certo é…",
          "Посреди манёвра задним ходом подкралось сомнение о том, что за прицепом. Правильный ход — …",
          "Посеред маневру заднім ходом підкрався сумнів про те, що за причепом. Правильний хід — …",
        ),
        opts: a3(
          ["Terminar rápido de memória", "Pedir a um passante para adivinhar", "Confiar só nos espelhos", "Parar, acionar o freio e fazer GOAL de novo"],
          ["Быстро закончить по памяти", "Попросить прохожего угадать", "Доверять только зеркалам", "Остановиться, поставить тормоз и снова GOAL"],
          ["Швидко закінчити з пам'яті", "Попросити перехожого вгадати", "Довіряти лише дзеркалам", "Зупинитися, поставити гальмо і знову GOAL"],
        ),
      },
      {
        q: t3(
          "A abordagem inteligente para o estacionamento noturno é…",
          "Умный подход к ночной стоянке — …",
          "Розумний підхід до нічної стоянки — …",
        ),
        opts: a3(
          ["Começar a procurar quando restam 15 minutos no seu relógio", "Planejar a parada — com uma reserva — enquanto seu relógio ainda tem opções, preferindo vagas de passagem", "Rampas e acostamentos servem em qualquer lugar", "Estacionar onde a carreta couber, com linhas ou não"],
          ["Начать искать, когда на счётчике осталось 15 минут", "Планировать остановку — с запасной — пока у счётчика ещё есть варианты, предпочитая проездные места", "Съезды и обочины подходят везде", "Парковаться везде, где влезет прицеп, с линиями или без"],
          ["Почати шукати, коли на лічильнику лишилося 15 хвилин", "Планувати зупинку — із запасною — доки у лічильника ще є варіанти, віддаючи перевагу проїзним місцям", "З'їзди та узбіччя підходять скрізь", "Паркуватися скрізь, де влізе причіп, з лініями чи без"],
        ),
      },
    ],
  },
  "roadside-inspection": {
    title: t3("Prontidão para Inspeção na Estrada", "Готовность к дорожной инспекции", "Готовність до дорожньої інспекції"),
    blurb: t3(
      "O que os policiais realmente verificam, como o Modo de Inspeção DOT do STONEMILES se encaixa, e como as inspeções terminam bem.",
      "Что инспекторы проверяют на самом деле, как в это вписывается режим DOT-инспекции STONEMILES и как инспекции заканчиваются хорошо.",
      "Що інспектори перевіряють насправді, як у це вписується режим DOT-інспекції STONEMILES і як інспекції закінчуються добре.",
    ),
    lessons: [
      {
        title: t3("O que o policial está verificando", "Что проверяет инспектор", "Що перевіряє інспектор"),
        body: t3(
          "Uma inspeção na estrada verifica três coisas: você (CDL, cartão médico, registro de status de serviço), a papelada (registro, licença IFTA, documentos de embarque, permissões) e o caminhão (uma volta que espelha sua inspeção pré-viagem, até uma inspeção completa de Nível I com o policial embaixo verificando freios e direção). Seus registros diários de hoje mais os 7 dias anteriores devem estar disponíveis. Tudo nessa lista é algo que você tocou esta manhã — prontidão não é uma performance, são seus hábitos de pré-viagem e papelada, vistos do outro lado.",
          "Дорожная инспекция проверяет три вещи: вас (CDL, медицинскую карту, журнал статуса смены), документы (регистрацию, лицензию IFTA, транспортные документы, разрешения) и грузовик (обход, повторяющий ваш предрейсовый осмотр, вплоть до полной инспекции Уровня I, когда инспектор снизу проверяет тормоза и рулевое управление). Ваши дневные журналы за сегодня плюс предыдущие 7 дней должны быть доступны. Всё в этом списке — то, чего вы касались этим утром: готовность — не представление, а ваши привычки предрейсового осмотра и документов, увиденные с другой стороны.",
          "Дорожня інспекція перевіряє три речі: вас (CDL, медичну картку, журнал статусу зміни), документи (реєстрацію, ліцензію IFTA, транспортні документи, дозволи) і вантажівку (обхід, що повторює ваш передрейсовий огляд, аж до повної інспекції Рівня I, коли інспектор знизу перевіряє гальма і кермове керування). Ваші денні журнали за сьогодні плюс попередні 7 днів мають бути доступні. Все в цьому списку — те, чого ви торкалися цього ранку: готовність — не вистава, а ваші звички передрейсового огляду і документів, побачені з іншого боку.",
        ),
      },
      {
        title: t3("Modo de Inspeção DOT no STONEMILES", "Режим DOT-инспекции в STONEMILES", "Режим DOT-інспекції в STONEMILES"),
        body: t3(
          "O Modo de Inspeção DOT do STONEMILES — o botão grande na aba do Motorista e no Menu — abre uma vista bloqueada para o policial: seu status de serviço atual, seus relógios de HOS, os últimos 8 dias de registros de serviço, os DVIRs assinados de hoje e de ontem, e um código de verificação que um policial pode checar sem conta para confirmar que o pacote é genuíno. Ele existe para que um toque, com luvas, entregue ao policial uma tela limpa. Mantenha a linha honesta impressa no topo dele: o STONEMILES é uma ajuda de planejamento e registro, NÃO um ELD registrado na FMCSA — se sua transportadora usa um ELD certificado, esse sistema guarda o registro oficial, e o STONEMILES o espelha.",
          "Режим DOT-инспекции STONEMILES — большая кнопка на вкладке водителя и в меню — открывает закрытый экран для инспектора: ваш текущий статус смены, ваши счётчики HOS, последние 8 дней журналов смен, подписанные DVIR за сегодня и вчера и код проверки, который инспектор может проверить без аккаунта, чтобы подтвердить подлинность пакета. Он существует, чтобы одно касание в перчатках передало инспектору чистый экран. Держите честную строку, напечатанную наверху: STONEMILES — это помощник планирования и учёта, а НЕ зарегистрированный в FMCSA ELD — если ваш перевозчик использует сертифицированный ELD, официальный журнал хранится в той системе, а STONEMILES его зеркалит.",
          "Режим DOT-інспекції STONEMILES — велика кнопка на вкладці водія і в меню — відкриває закритий екран для інспектора: ваш поточний статус зміни, ваші лічильники HOS, останні 8 днів журналів змін, підписані DVIR за сьогодні і вчора та код перевірки, який інспектор може перевірити без акаунта, щоб підтвердити справжність пакета. Він існує, щоб одне торкання в рукавицях передало інспектору чистий екран. Тримайте чесний рядок, надрукований угорі: STONEMILES — це помічник планування й обліку, а НЕ зареєстрований у FMCSA ELD — якщо ваш перевізник використовує сертифікований ELD, офіційний журнал зберігається в тій системі, а STONEMILES його дзеркалить.",
        ),
      },
      {
        title: t3("Como as inspeções terminam bem", "Как инспекции заканчиваются хорошо", "Як інспекції закінчуються добре"),
        body: t3(
          "Entre prontamente e com segurança quando sinalizado, mantenha-se profissional, e tenha os documentos ao alcance em vez de enterrados — cortesia não é fraqueza, é gestão de tempo. Responda às perguntas com verdade e brevidade; nunca discuta uma violação na estrada, porque o lugar para disputá-la é o processo da multa depois. Conheça as apostas com precisão: violações de fora de serviço (freios, pneus, horas) estacionam o caminhão ou você até serem consertadas, e os resultados das inspeções alimentam as pontuações de segurança que frotas e seguradoras leem. Quando terminar, registre o tempo como aconteceu e reporte o resultado à sua empresa no mesmo dia.",
          "Заезжайте быстро и безопасно по сигналу, оставайтесь профессиональны и держите документы в пределах досягаемости, а не закопанными, — вежливость не слабость, а управление временем. Отвечайте на вопросы правдиво и кратко; никогда не спорьте о нарушении на дороге, потому что место для спора — процесс по штрафу после. Знайте ставки точно: нарушения с выводом из эксплуатации (тормоза, шины, часы) паркуют грузовик или вас до исправления, а результаты инспекций питают оценки безопасности, которые читают автопарки и страховщики. Когда всё закончится, запишите время как оно было и сообщите результат своей компании в тот же день.",
          "Заїжджайте швидко і безпечно за сигналом, залишайтеся професійними і тримайте документи в межах досяжності, а не закопаними, — ввічливість не слабкість, а керування часом. Відповідайте на питання правдиво і коротко; ніколи не сперечайтеся про порушення на дорозі, бо місце для спору — процес за штрафом після. Знайте ставки точно: порушення з виведенням з експлуатації (гальма, шини, години) паркують вантажівку або вас до виправлення, а результати інспекцій живлять оцінки безпеки, які читають автопарки і страховики. Коли все закінчиться, запишіть час як він був і повідомте результат своїй компанії того ж дня.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Quantos dias de registros de serviço devem estar disponíveis em uma inspeção na estrada?",
          "Сколько дней журналов смен должно быть доступно на дорожной инспекции?",
          "Скільки днів журналів змін має бути доступно на дорожній інспекції?",
        ),
        opts: a3(
          ["Só hoje", "Hoje mais os 7 dias anteriores", "Os últimos 30 dias", "Registros nunca são verificados na estrada"],
          ["Только сегодня", "Сегодня плюс предыдущие 7 дней", "Последние 30 дней", "Журналы никогда не проверяют на дороге"],
          ["Лише сьогодні", "Сьогодні плюс попередні 7 днів", "Останні 30 днів", "Журнали ніколи не перевіряють на дорозі"],
        ),
      },
      {
        q: t3(
          "Se sua transportadora usa um ELD certificado, o registro oficial é guardado por…",
          "Если ваш перевозчик использует сертифицированный ELD, официальный журнал хранится…",
          "Якщо ваш перевізник використовує сертифікований ELD, офіційний журнал зберігається…",
        ),
        opts: a3(
          ["STONEMILES", "Seu caderno de papel", "O ELD certificado — o STONEMILES o espelha como ajuda de planejamento", "O último posto de pesagem"],
          ["В STONEMILES", "В вашей бумажной тетради", "В сертифицированном ELD — STONEMILES зеркалит его как помощник планирования", "На последнем весовом посту"],
          ["У STONEMILES", "У вашому паперовому зошиті", "У сертифікованому ELD — STONEMILES дзеркалить його як помічник планування", "На останньому ваговому пості"],
        ),
      },
      {
        q: t3(
          "Uma inspeção de Nível I é…",
          "Инспекция Уровня I — это…",
          "Інспекція Рівня I — це…",
        ),
        opts: a3(
          ["Uma verificação só de papelada", "Só uma entrevista com o motorista", "A inspeção completa do Padrão Norte-Americano, incluindo embaixo do veículo — freios, direção, acoplamento", "Só uma passagem de pesagem"],
          ["Проверка только документов", "Только интервью с водителем", "Полная инспекция по Североамериканскому стандарту, включая осмотр снизу — тормоза, рулевое, сцепка", "Только проезд взвешивания"],
          ["Перевірка лише документів", "Лише інтерв'ю з водієм", "Повна інспекція за Північноамериканським стандартом, включно з оглядом знизу — гальма, кермове, зчеплення", "Лише проїзд зважування"],
        ),
      },
      {
        q: t3(
          "Uma violação de fora de serviço significa…",
          "Нарушение с выводом из эксплуатации означает…",
          "Порушення з виведенням з експлуатації означає…",
        ),
        opts: a3(
          ["Uma multa pequena, continue rodando", "O caminhão (ou o motorista) não pode se mover até a violação ser corrigida", "Um aviso que você pode ignorar", "Papelada extra só na próxima parada"],
          ["Маленький штраф, езжайте дальше", "Грузовик (или водитель) не может двигаться, пока нарушение не исправлено", "Предупреждение, которое можно игнорировать", "Только лишние бумаги на следующей остановке"],
          ["Маленький штраф, їдьте далі", "Вантажівка (або водій) не може рухатися, доки порушення не виправлено", "Попередження, яке можна ігнорувати", "Лише зайві папери на наступній зупинці"],
        ),
      },
      {
        q: t3(
          "A melhor maneira de disputar uma violação que você acredita estar errada é…",
          "Лучший способ оспорить нарушение, которое вы считаете неверным, — …",
          "Найкращий спосіб оскаржити порушення, яке ви вважаєте невірним, — …",
        ),
        opts: a3(
          ["Discuti-la na estrada até o policial concordar", "Recusar-se a assinar qualquer coisa e ir embora", "Manter-se profissional na estrada e disputá-la depois pelo processo da multa", "Ligar para o despacho e deixar eles discutirem por você"],
          ["Спорить на дороге, пока инспектор не согласится", "Отказаться что-либо подписывать и уехать", "Оставаться профессиональным на дороге и оспорить после через процесс по штрафу", "Позвонить диспетчеру и дать ему спорить за вас"],
          ["Сперечатися на дорозі, доки інспектор не погодиться", "Відмовитися будь-що підписувати і поїхати", "Залишатися професійним на дорозі й оскаржити після через процес за штрафом", "Подзвонити диспетчеру і дати йому сперечатися за вас"],
        ),
      },
    ],
  },
  "hazmat-awareness": {
    title: t3("Conscientização sobre Materiais Perigosos", "Осведомлённость об опасных грузах", "Обізнаність про небезпечні вантажі"),
    blurb: t3(
      "Placas, papéis ao alcance, e os primeiros movimentos quando algo vaza — nível de conscientização, rotulado honestamente.",
      "Знаки, документы в пределах досягаемости и первые действия при утечке — уровень осведомлённости, честно обозначенный.",
      "Знаки, документи в межах досяжності і перші дії в разі витоку — рівень обізнаності, чесно позначений.",
    ),
    lessons: [
      {
        title: t3("Papéis e placas contam a história", "Документы и знаки рассказывают историю", "Документи і знаки розповідають історію"),
        body: t3(
          "Para materiais perigosos, o documento de embarque é a identidade da carga: nome de embarque correto, classe de perigo, número de identificação e um contato de emergência, e ele deve rodar ao seu alcance imediato — em um bolso da porta ou no banco — e ser entregue limpo em uma inspeção ou em uma cena de acidente. As placas devem ser legíveis dos quatro lados do caminhão e corresponder ao que está realmente carregado; uma placa errada é pior que uma faltando porque ela mente para os bombeiros que chegam primeiro. Se sua carga precisa de placas, ela também precisa de um motorista com o endosso de materiais perigosos — conscientização não substitui o endosso nem o treinamento da sua transportadora.",
          "Для опасных материалов транспортный документ — это удостоверение груза: правильное транспортное название, класс опасности, идентификационный номер и контакт на чрезвычайный случай, и он должен находиться в вашей немедленной досягаемости — в кармане двери или на сиденье — и чисто передаваться на инспекции или на месте аварии. Знаки должны читаться со всех четырёх сторон грузовика и соответствовать тому, что реально загружено; неправильный знак хуже отсутствующего, потому что он лжёт пожарным, прибывшим первыми. Если вашему грузу нужны знаки, ему также нужен водитель с допуском на опасные грузы — осведомлённость не заменяет ни допуск, ни обучение вашего перевозчика.",
          "Для небезпечних матеріалів транспортний документ — це посвідчення вантажу: правильна транспортна назва, клас небезпеки, ідентифікаційний номер і контакт на надзвичайний випадок, і він має перебувати у вашій негайній досяжності — у кишені дверей або на сидінні — і чисто передаватися на інспекції або на місці аварії. Знаки мають читатися з усіх чотирьох боків вантажівки і відповідати тому, що реально завантажено; неправильний знак гірший за відсутній, бо він бреше пожежникам, які прибули першими. Якщо вашому вантажу потрібні знаки, йому також потрібен водій із допуском на небезпечні вантажі — обізнаність не замінює ні допуск, ні навчання вашого перевізника.",
        ),
      },
      {
        title: t3("Estacionamento, vigilância e fumo", "Стоянка, наблюдение и курение", "Стоянка, нагляд і куріння"),
        body: t3(
          "Cargas com placas viajam sob regras extras: o caminhão deve ser vigiado ou estacionado onde as regras permitem (nunca sobre ou sob uma ponte, nunca em um túnel, longe de lugares lotados quando estacionado), pneus verificados em cada parada porque um incêndio começa pequeno, e nada de fumo ou chama aberta a menos de 25 pés de certas classes de materiais perigosos — explosivos, inflamáveis e oxidantes entre eles. Túneis e algumas pontes restringem ou proíbem cargas com placas de uma vez; as placas afixadas mandam, e as marcações de materiais perigosos no STONEMILES são ajudas de planejamento para avisar você cedo, não permissão para rodar.",
          "Грузы со знаками едут по дополнительным правилам: грузовик должен быть под наблюдением или стоять там, где правила разрешают (никогда на мосту или под ним, никогда в туннеле, вдали от людных мест при стоянке), шины проверять на каждой остановке, потому что пожар начинается маленьким, и никакого курения или открытого огня в пределах 25 футов от некоторых классов опасных грузов — взрывчатки, легковоспламеняющихся и окислителей среди них. Туннели и некоторые мосты ограничивают или запрещают грузы со знаками полностью; дорожные знаки решают, а отметки опасных грузов в STONEMILES — помощники планирования, чтобы предупредить вас рано, а не разрешение ехать.",
          "Вантажі зі знаками їдуть за додатковими правилами: вантажівка має бути під наглядом або стояти там, де правила дозволяють (ніколи на мосту або під ним, ніколи в тунелі, подалі від людних місць під час стоянки), шини перевіряти на кожній зупинці, бо пожежа починається маленькою, і жодного куріння або відкритого вогню в межах 25 футів від деяких класів небезпечних вантажів — вибухівки, легкозаймистих і окисників серед них. Тунелі і деякі мости обмежують або забороняють вантажі зі знаками повністю; дорожні знаки вирішують, а позначки небезпечних вантажів у STONEMILES — помічники планування, щоб попередити вас рано, а не дозвіл їхати.",
        ),
      },
      {
        title: t3("Quando algo vaza", "Когда что-то течёт", "Коли щось тече"),
        body: t3(
          "Se você encontrar um vazamento ou um incêndio começar: pare o caminhão no lugar seguro mais alcançável, acione os freios, desligue o motor e mantenha as pessoas longe — fique contra o vento e acima do material. NÃO tente identificar uma substância desconhecida chegando perto; a placa, o documento de embarque e o Guia de Resposta a Emergências (ERG) dizem aos socorristas o que é, à distância. Ligue 911 e para o número de emergência da sua empresa, dê o número de identificação e a classe da papelada, e deixe os socorristas treinados trabalharem. Seu trabalho nos primeiros minutos é distância, informação e impedir a cena de crescer.",
          "Если вы нашли утечку или начался пожар: остановите грузовик в самом безопасном достижимом месте, поставьте тормоза, заглушите двигатель и держите людей подальше — оставайтесь с наветренной стороны и выше материала. НЕ пытайтесь опознать неизвестное вещество, подходя близко; знак, транспортный документ и Руководство по реагированию на чрезвычайные ситуации (ERG) скажут спасателям, что это, с расстояния. Звоните 911 и на чрезвычайный номер своей компании, назовите идентификационный номер и класс из документов и дайте обученным спасателям работать. Ваша работа в первые минуты — дистанция, информация и не дать сцене разрастись.",
          "Якщо ви знайшли витік або почалася пожежа: зупиніть вантажівку в найбезпечнішому досяжному місці, поставте гальма, заглушіть двигун і тримайте людей подалі — залишайтеся з навітряного боку і вище матеріалу. НЕ намагайтеся впізнати невідому речовину, підходячи близько; знак, транспортний документ і Посібник з реагування на надзвичайні ситуації (ERG) скажуть рятувальникам, що це, з відстані. Телефонуйте 911 і на надзвичайний номер своєї компанії, назвіть ідентифікаційний номер і клас із документів і дайте навченим рятувальникам працювати. Ваша робота в перші хвилини — дистанція, інформація і не дати сцені розростися.",
        ),
      },
    ],
    quiz: [
      {
        q: t3(
          "Os documentos de embarque de materiais perigosos devem rodar…",
          "Транспортные документы на опасные грузы должны находиться…",
          "Транспортні документи на небезпечні вантажі мають перебувати…",
        ),
        opts: a3(
          ["Na carreta com a carga", "No escritório central", "Ao alcance imediato do motorista — bolso da porta ou banco — enquanto está nos controles", "Onde couberem"],
          ["В прицепе с грузом", "В главном офисе", "В немедленной досягаемости водителя — карман двери или сиденье — пока он за управлением", "Где поместятся"],
          ["У причепі з вантажем", "У головному офісі", "У негайній досяжності водія — кишеня дверей або сидіння — поки він за керуванням", "Де помістяться"],
        ),
      },
      {
        q: t3(
          "As placas devem ser…",
          "Знаки должны быть…",
          "Знаки мають бути…",
        ),
        opts: a3(
          ["Só na porta traseira", "Legíveis dos quatro lados e corresponder à carga realmente transportada", "Opcionais quando a carga é pequena", "O que o embarcador tinha em estoque"],
          ["Только на задней двери", "Читаться со всех четырёх сторон и соответствовать реально перевозимому грузу", "Необязательны, когда груз маленький", "Какие были у грузоотправителя на складе"],
          ["Лише на задніх дверях", "Читатися з усіх чотирьох боків і відповідати реально перевезеному вантажу", "Необов'язкові, коли вантаж маленький", "Які були у відправника на складі"],
        ),
      },
      {
        q: t3(
          "Fumo e chamas abertas são proibidos a menos de ___ de explosivos, inflamáveis e oxidantes com placas.",
          "Курение и открытый огонь запрещены в пределах ___ от взрывчатки, легковоспламеняющихся и окислителей со знаками.",
          "Куріння і відкритий вогонь заборонені в межах ___ від вибухівки, легкозаймистих і окисників зі знаками.",
        ),
        opts: a3(
          ["5 pés", "10 pés", "25 pés", "100 jardas"],
          ["5 футов", "10 футов", "25 футов", "100 ярдов"],
          ["5 футів", "10 футів", "25 футів", "100 ярдів"],
        ),
      },
      {
        q: t3(
          "Você descobre um vazamento de material perigoso em uma parada. Seus PRIMEIROS movimentos são…",
          "Вы обнаружили утечку опасного груза на остановке. Ваши ПЕРВЫЕ действия — …",
          "Ви виявили витік небезпечного вантажу на зупинці. Ваші ПЕРШІ дії — …",
        ),
        opts: a3(
          ["Chegar perto e cheirar para identificar", "Parar com segurança, manter as pessoas longe, ficar contra o vento e ligar 911 e para sua empresa com o número de identificação dos papéis", "Dirigi-lo até a oficina mais próxima", "Cobri-lo com uma lona e terminar a viagem"],
          ["Подойти близко и понюхать, чтобы опознать", "Безопасно остановиться, держать людей подальше, оставаться с наветренной стороны и позвонить 911 и в свою компанию, назвав идентификационный номер из документов", "Отвезти в ближайшую мастерскую", "Накрыть брезентом и закончить рейс"],
          ["Підійти близько і понюхати, щоб впізнати", "Безпечно зупинитися, тримати людей подалі, залишатися з навітряного боку і зателефонувати 911 і в свою компанію, назвавши ідентифікаційний номер із документів", "Відвезти до найближчої майстерні", "Накрити брезентом і закінчити рейс"],
        ),
      },
      {
        q: t3(
          "As marcações e notas de materiais perigosos no STONEMILES são…",
          "Отметки и заметки об опасных грузах в STONEMILES — это…",
          "Позначки і нотатки про небезпечні вантажі у STONEMILES — це…",
        ),
        opts: a3(
          ["Permissão legal para usar rotas restritas", "Um substituto para o endosso de materiais perigosos", "Ajudas de planejamento que avisam você cedo — placas afixadas e as regras oficiais sempre mandam", "Só decoração"],
          ["Легальное разрешение использовать ограниченные маршруты", "Замена допуска на опасные грузы", "Помощники планирования, которые предупреждают рано, — дорожные знаки и официальные правила всегда решают", "Только украшение"],
          ["Легальний дозвіл використовувати обмежені маршрути", "Заміна допуску на небезпечні вантажі", "Помічники планування, які попереджають рано, — дорожні знаки і офіційні правила завжди вирішують", "Лише прикраса"],
        ),
      },
    ],
  },
};

// The language a course view is being read in, narrowed to the three
// overlay languages (null for en/es, which use the built-in fields).
export function academyOverlayLang(lang: Lang): AcademyLang3 | null {
  return lang === "pt" || lang === "ru" || lang === "uk" ? lang : null;
}
