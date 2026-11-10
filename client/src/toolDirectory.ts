// toolDirectory.ts — the grouped tool directory (dashboard cleanup,
// x's order 2026-11-06: "Make sure the users dashboard is neat and
// user friendly — easy to navigate through to find what they need").
//
// ONE structure, three surfaces: the More tab renders these groups,
// the Today dashboard's "Find a tool" panel jumps to them, and every
// item lands through the SAME jump Ask Meca's "Take me there" uses
// (App's goMecaDest) — so a tool has one name and one landing
// everywhere: dashboard, menus, and Meca answers.
//
// Five groups in plain driver language: Drive · Loads & Money ·
// Truck & Trailer · Records & Taxes · More & Settings. Every tool in
// the app is at most two taps from Today: dock tap (or a Find-a-tool
// row) → the tool's row. Nothing here changes what a tool DOES —
// this file only arranges, groups, and labels.
//
// Labels are English source strings + the Spanish pair, routed
// through the app's tr()/pairText engine; Portuguese / Russian /
// Ukrainian live in the PAIRS catalogue in i18n.ts keyed by the
// exact English string (toolDirectory.test.ts pins that).

/**
 * A jump Ask Meca already knows how to perform. The literal union is
 * a subset of App's MecaDestId — App passes `dest` straight to
 * goMecaDest, so a typo'd id here is a compile error there.
 */
export type ToolDestId =
  | "drive"
  | "routes"
  | "stops"
  | "stop_planner"
  | "route_weather"
  | "satellite_view"
  | "sign_check"
  | "hill_grade_alerts"
  | "weigh_station_status"
  | "scale_finder"
  | "night_parking"
  | "parking"
  | "atlas"
  | "loads"
  | "loads_tracker"
  | "detention"
  | "facility_memory"
  | "owed_board"
  | "true_rate"
  | "claims_log"
  | "pay_book"
  | "wallet"
  | "settlements"
  | "fleet_board"
  | "open_board"
  | "shipper_portal"
  | "broker_portal"
  | "broker_inbox"
  | "trailer_tools"
  | "maintenance"
  | "breakdown_log"
  | "scale_tickets"
  | "trips"
  | "ifta"
  | "library"
  | "tax_records"
  | "doc_expiry"
  | "documents"
  | "hours"
  | "safety_academy"
  | "chat"
  | "si_layer"
  | "live_updates"
  | "road_learning"
  | "plans"
  | "language"
  | "settings";

/**
 * Landings that live outside the Meca destination table — sheets and
 * Driver-tab anchors the More menu has always opened directly.
 * App wires each id to the exact setter/scroll the old flat More
 * list used; behaviour is unchanged.
 */
export type ToolDirectId =
  | "permits"
  | "dvir"
  | "inspection"
  | "verify"
  | "onboarding"
  | "menu";

export interface ToolItem {
  /** Stable id — the brief's tool checklist keys off these. */
  id: string;
  icon: string;
  /** English source label (the i18n catalogue key) + Spanish pair. */
  en: string;
  es: string;
  /** One plain line: what the tool is, in driver words. */
  subEn: string;
  subEs: string;
  dest?: ToolDestId;
  direct?: ToolDirectId;
}

export interface ToolGroup {
  id: "drive" | "loads-money" | "truck-trailer" | "records-taxes" | "more-settings";
  icon: string;
  en: string;
  es: string;
  /** Contents line — shown on Today's Find-a-tool rows. */
  subEn: string;
  subEs: string;
  items: ToolItem[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "drive",
    icon: "🚚",
    en: "Drive",
    es: "Conducir",
    subEn: "Map, routes, fuel, weather, scales, parking, Atlas",
    subEs: "Mapa, rutas, diésel, clima, básculas, estacionamiento, Atlas",
    items: [
      {
        id: "drive-map", icon: "🧭", en: "Drive map", es: "Mapa de conducción",
        subEn: "The live map — your speed, the route, and the road while you roll",
        subEs: "El mapa en vivo — tu velocidad, la ruta y la carretera en marcha",
        dest: "drive",
      },
      {
        id: "routes", icon: "🛣️", en: "Routes", es: "Rutas",
        subEn: "Truck-legal routes, compared on miles, fuel, tolls, safety, pay",
        subEs: "Rutas legales para camiones, comparadas por millas, diésel, peajes, seguridad y pago",
        dest: "routes",
      },
      {
        id: "fuel-stops", icon: "⛽", en: "Fuel stops", es: "Paradas de diésel",
        subEn: "Stops on your corridor, Love's & Pilot/Flying J — full Net-Price Planner on Diamond",
        subEs: "Paradas en tu corredor, Love's y Pilot/Flying J — planificador de precio neto completo en Diamond",
        dest: "stops",
      },
      {
        id: "plan-stops", icon: "🗓️", en: "Plan my stops", es: "Planificar mis paradas",
        subEn: "Fuel + break + shutdown on one timeline — tank, cheapest refuels, your added stops",
        subEs: "Diésel + descanso + parada del día en una línea — tanque, recargas baratas, tus paradas",
        dest: "stop_planner",
      },
      {
        id: "route-weather", icon: "🌦️", en: "Route weather", es: "Clima en la ruta",
        subEn: "Weather on your route — corridor ahead, gusts, tonight at your stop, radar",
        subEs: "Clima en tu ruta — corredor adelante, ráfagas, esta noche en tu parada, radar",
        dest: "route_weather",
      },
      {
        id: "satellite-tilt", icon: "🛰️", en: "Satellite view & tilt", es: "Vista satelital e inclinación",
        subEn: "Real aerial photos + the tilted driving view — set in Layers & display on the Drive map",
        subEs: "Fotos aéreas reales + la vista de conducción inclinada — se ajusta en Capas y visualización en el mapa",
        dest: "satellite_view",
      },
      {
        id: "sign-check", icon: "🪧", en: "Sign check", es: "Revisión de señales",
        subEn: "Which sign, which lane at a split — checked against the real road signs",
        subEs: "Qué señal y qué carril en una división — verificado contra las señales reales de la carretera",
        dest: "sign_check",
      },
      {
        id: "hill-grades", icon: "⛰️", en: "Hill grade alerts", es: "Alertas de pendientes",
        subEn: "Downgrade and climb warnings with your speed — from your route's elevation",
        subEs: "Avisos de bajadas y subidas con tu velocidad — desde la elevación de tu ruta",
        dest: "hill_grade_alerts",
      },
      {
        id: "weigh-stations", icon: "⚖️", en: "Weigh stations", es: "Estaciones de pesaje",
        subEn: "Open or closed ahead — the weigh stations on your road",
        subEs: "Abiertas o cerradas adelante — las estaciones de pesaje en tu ruta",
        dest: "weigh_station_status",
      },
      {
        id: "scale-finder", icon: "🔎", en: "Scales finder", es: "Buscar básculas",
        subEn: "CAT Scales and truck scales, on the map",
        subEs: "Básculas CAT y de camiones, en el mapa",
        dest: "scale_finder",
      },
      {
        id: "night-parking", icon: "🌙", en: "Night parking", es: "Estacionamiento nocturno",
        subEn: "Truck parking and rest areas for tonight — on the map",
        subEs: "Estacionamiento para camiones y áreas de descanso para esta noche — en el mapa",
        dest: "night_parking",
      },
      {
        id: "parking", icon: "🅿️", en: "Parking", es: "Estacionamiento",
        subEn: "Plan where you'll stop — parking that fits your HOS clocks",
        subEs: "Planifica dónde pararás — estacionamiento según tus relojes HOS",
        dest: "parking",
      },
      {
        id: "atlas", icon: "🗺️", en: "Atlas", es: "Atlas",
        subEn: "Every state's road rules — weight limits, length & width, low clearances, weigh stations, DOT & patrol contacts. Works offline",
        subEs: "Las reglas de cada estado — límites de peso, largo y ancho, alturas libres, básculas, contactos DOT y patrulla. Funciona sin señal",
        dest: "atlas",
      },
    ],
  },
  {
    id: "loads-money",
    icon: "📦",
    en: "Loads & Money",
    es: "Cargas y dinero",
    subEn: "Loads, pay owed to you, true rate, claims, pay book",
    subEs: "Cargas, lo que te deben, tarifa real, reclamos, libro de pagos",
    items: [
      {
        id: "loads", icon: "📦", en: "Loads", es: "Cargas",
        subEn: "All your loads — add one from a photo of the BOL or rate con",
        subEs: "Todas tus cargas — agrega una con una foto del BOL o la confirmación de tarifa",
        dest: "loads",
      },
      {
        id: "load-tracker", icon: "📍", en: "Load tracker", es: "Rastreador de cargas",
        subEn: "Booked → picked up → delivered → sealed, one load at a time",
        subEs: "Reservada → recogida → entregada → sellada, una carga a la vez",
        dest: "loads_tracker",
      },
      {
        id: "detention", icon: "⏱️", en: "Detention pay", es: "Pago por detención",
        subEn: "Detention time and pay, sealed per load",
        subEs: "Tiempo y pago por detención, sellado por carga",
        dest: "detention",
      },
      {
        id: "facility-memory", icon: "🏭", en: "Facility memory", es: "Memoria de instalaciones",
        subEn: "What to expect at a receiver or shipper — from your own past visits",
        subEs: "Qué esperar en un receptor o cargador — de tus propias visitas anteriores",
        dest: "facility_memory",
      },
      {
        id: "owed-board", icon: "💰", en: "Who owes me", es: "Quién me debe",
        subEn: "Delivered loads not yet paid — oldest first, total owed up top",
        subEs: "Cargas entregadas aún no pagadas — la más antigua primero, el total arriba",
        dest: "owed_board",
      },
      {
        id: "true-rate", icon: "🧮", en: "True rate", es: "Tarifa real",
        subEn: "Pay ÷ ALL miles (deadhead too), net after fuel",
        subEs: "Pago ÷ TODAS las millas (también en vacío), neto tras el diésel",
        dest: "true_rate",
      },
      {
        id: "claims-log", icon: "🧾", en: "TONU & layover logger", es: "Registro TONU y layover",
        subEn: "TONU, layover, and driver-assist claim events — sealed for the paperwork",
        subEs: "Eventos de reclamo TONU, layover y asistencia — sellados para el papeleo",
        dest: "claims_log",
      },
      {
        id: "pay-book", icon: "📒", en: "Pay Book", es: "Libro de Pagos",
        subEn: "Your pay — log pay & per diem, W-2 & 1099 totals, Year-to-Date lane pies, tax packets",
        subEs: "Tu pago — registra pago y viáticos, totales W-2 y 1099, gráficos del año por carril, paquetes de impuestos",
        dest: "pay_book",
      },
      {
        id: "wallet", icon: "🪙", en: "Wallet & points", es: "Cartera y puntos",
        subEn: "Your points balance and the $STONER wallet",
        subEs: "Tu saldo de puntos y la cartera $STONER",
        dest: "wallet",
      },
      {
        id: "settlements", icon: "📋", en: "Settlement Checker", es: "Verificador de liquidaciones",
        subEn: "Check a settlement against what the load should have paid",
        subEs: "Revisa una liquidación contra lo que la carga debía pagar",
        dest: "settlements",
      },
      {
        id: "fleet-board", icon: "🗂️", en: "Fleet board", es: "Tablero de la flota",
        subEn: "Your company's load board — post and claim loads",
        subEs: "El tablero de cargas de tu empresa — publica y reclama cargas",
        dest: "fleet_board",
      },
      {
        id: "open-board", icon: "🌐", en: "Open Board", es: "Tablero Abierto",
        subEn: "Broker loads & fleet overflow for vetted owner operators — pay runs direct, dispatch fee applies once",
        subEs: "Cargas de corredores y excedente de flotas para propietarios verificados — pago directo, tarifa de despacho una vez",
        dest: "open_board",
      },
      {
        id: "shipper-portal", icon: "🚚", en: "Shipper Portal", es: "Portal del cargador",
        subEn: "Shippers post loads to RUGGS LOGISTICS — desk reviews, then the board",
        subEs: "Los cargadores publican cargas a RUGGS LOGISTICS — el escritorio revisa, luego el tablero",
        dest: "shipper_portal",
      },
      {
        id: "broker-portal", icon: "🏢", en: "Broker Portal", es: "Portal del corredor",
        subEn: "Desk-invited brokers post loads to the Open Board under their own name — desk reviews first",
        subEs: "Corredores invitados publican cargas al Tablero Abierto con su nombre — el escritorio revisa primero",
        dest: "broker_portal",
      },
      {
        id: "broker-inbox", icon: "📥", en: "Broker Inbox", es: "Bandeja del corredor",
        subEn: "Broker load submissions waiting on your approval",
        subEs: "Cargas de corredores esperando tu aprobación",
        dest: "broker_inbox",
      },
    ],
  },
  {
    id: "truck-trailer",
    icon: "🚛",
    en: "Truck & Trailer",
    es: "Camión y remolque",
    subEn: "Trailer tools, maintenance, breakdown, scale tickets",
    subEs: "Herramientas del remolque, mantenimiento, averías, tickets de báscula",
    items: [
      {
        id: "trailer-tools", icon: "🚛", en: "Trailer tools", es: "Herramientas del remolque",
        subEn: "Your trailer profile + cold-chain log, securement calculator, loaded height, axle calculator, dock helper, wind advisory, pre-trip checklist",
        subEs: "Tu perfil de remolque + registro de cadena de frío, calculadora de sujeción, altura cargada, calculadora de ejes, ayudante de muelle, aviso de viento, lista pre-viaje",
        dest: "trailer_tools",
      },
      {
        id: "maintenance", icon: "🔧", en: "Maintenance countdown", es: "Cuenta atrás de mantenimiento",
        subEn: "Oil, tires, brakes, DOT inspection — counted down off your odometer",
        subEs: "Aceite, llantas, frenos, inspección DOT — la cuenta atrás sale de tu odómetro",
        dest: "maintenance",
      },
      {
        id: "breakdown", icon: "🛠️", en: "Breakdown mode", es: "Modo avería",
        subEn: "Downtime + cost log, sealed for the claim — the panel also opens one-tap breakdown help",
        subEs: "Registro de parada y costos, sellado para el reclamo — el panel también abre la ayuda de avería en un toque",
        dest: "breakdown_log",
      },
      {
        id: "scale-tickets", icon: "🎫", en: "Scale tickets", es: "Tickets de báscula",
        subEn: "Log your axle weights or snap the ticket — sealed into the load",
        subEs: "Registra tus pesos por eje o fotografía el ticket — sellado en la carga",
        dest: "scale_tickets",
      },
      {
        id: "dvir", icon: "📝", en: "Inspection checklists", es: "Listas de inspección",
        subEn: "Pre-trip and post-trip DVIR — signed checklists seal into your HOS day",
        subEs: "DVIR pre y post viaje — las listas firmadas se sellan en tu día HOS",
        direct: "dvir",
      },
      {
        id: "permits", icon: "📜", en: "OS/OW Permits", es: "Permisos OS/OW",
        subEn: "Scan a permit, file the docket, drive the approved route",
        subEs: "Escanea un permiso, archiva el expediente, conduce la ruta aprobada",
        direct: "permits",
      },
    ],
  },
  {
    id: "records-taxes",
    icon: "📁",
    en: "Records & Taxes",
    es: "Registros e impuestos",
    subEn: "Trip sheets, IFTA, taxes, documents, hours",
    subEs: "Hojas de viaje, IFTA, impuestos, documentos, horas",
    items: [
      {
        id: "library", icon: "📚", en: "Library", es: "Biblioteca",
        subEn: "Every record in one home — delivered loads, statements, fuel tax by state, filings, documents, sealed files",
        subEs: "Todos tus registros en un solo lugar — cargas entregadas, estados, impuesto al diésel por estado, declaraciones, documentos, archivos sellados",
        dest: "library",
      },
      {
        id: "trips", icon: "🧾", en: "Trips", es: "Viajes",
        subEn: "Trip sheets — miles by state, pay, sealed proof & export",
        subEs: "Hojas de viaje — millas por estado, pago, prueba sellada y exportación",
        dest: "trips",
      },
      {
        id: "ifta", icon: "⛽", en: "IFTA estimator", es: "Estimador IFTA",
        subEn: "Quarterly fuel-tax estimate from your sealed miles and fuel — planning only, not a filing",
        subEs: "Estimación trimestral del impuesto al diésel desde tus millas y diésel sellados — solo planificación, no es una declaración",
        dest: "ifta",
      },
      {
        id: "tax-records", icon: "📊", en: "Tax records", es: "Registros de impuestos",
        subEn: "Expenses sorted into tax categories, the year summary, and your per-diem day counter",
        subEs: "Gastos ordenados por categoría de impuestos, el resumen del año y tu contador de días de viáticos",
        dest: "tax_records",
      },
      {
        id: "doc-expiry", icon: "🗓️", en: "Document expiry wallet", es: "Cartera de vencimientos",
        subEn: "CDL, med card, registration, insurance, annual inspection — alerts at 30, 14, and 7 days",
        subEs: "CDL, tarjeta médica, registro, seguro, inspección anual — alertas a los 30, 14 y 7 días",
        dest: "doc_expiry",
      },
      {
        id: "doc-vault", icon: "🗄️", en: "Document vault", es: "Bóveda de documentos",
        subEn: "CDL, medical card, insurance — renewal reminders",
        subEs: "CDL, tarjeta médica, seguro — recordatorios de renovación",
        dest: "documents",
      },
      {
        id: "hours", icon: "🕐", en: "Hours & HOS", es: "Horas y HOS",
        subEn: "Your duty status, HOS clocks, and daily logs",
        subEs: "Tu estado de servicio, relojes HOS y registros diarios",
        dest: "hours",
      },
      {
        id: "dot-inspection", icon: "🛡️", en: "DOT Inspection", es: "Inspección DOT",
        subEn: "Officer view — 8-day HOS logs, DVIR, verify code",
        subEs: "Vista del oficial — registros HOS de 8 días, DVIR, código de verificación",
        direct: "inspection",
      },
      {
        id: "verify", icon: "🔎", en: "Verify & Audit", es: "Verificar y auditar",
        subEn: "Chain verification, proof lookup, ELD & settlement audits, audit trail",
        subEs: "Verificación de cadena, búsqueda de pruebas, auditorías ELD y de liquidaciones, registro de auditoría",
        direct: "verify",
      },
      {
        id: "academy", icon: "🎓", en: "Safety Academy", es: "Academia de Seguridad",
        subEn: "10 courses, quizzes, sealed completion records",
        subEs: "10 cursos, exámenes, registros de finalización sellados",
        dest: "safety_academy",
      },
    ],
  },
  {
    id: "more-settings",
    icon: "⋯",
    en: "More & Settings",
    es: "Más y ajustes",
    subEn: "Chat, driver profile, plans, settings, language",
    subEs: "Chat, perfil del chofer, planes, ajustes, idioma",
    items: [
      {
        id: "chat", icon: "💬", en: "Chat", es: "Chat",
        subEn: "Company chat, groups, DMs, other drivers",
        subEs: "Chat de la empresa, grupos, mensajes directos, otros choferes",
        dest: "chat",
      },
      {
        id: "driver", icon: "🪪", en: "Driver", es: "Chofer",
        subEn: "Duty status, HOS detail, scores, passport, proof & verify",
        subEs: "Estado de servicio, detalle HOS, puntajes, pasaporte, prueba y verificación",
        dest: "hours",
      },
      {
        id: "si", icon: "🧠", en: "STONEMILES SI", es: "STONEMILES SI",
        subEn: "Super Intelligent layer — preps, heals, vets; decisions only, public records only",
        subEs: "Capa Super Inteligente — prepara, corrige, verifica; solo decisiones, solo registros públicos",
        dest: "si_layer",
      },
      {
        id: "live-updates", icon: "📡", en: "Live updates", es: "Actualizaciones en vivo",
        subEn: "App health — the app reports its own crashes and failures here",
        subEs: "Salud de la app — la app reporta aquí sus propios fallos",
        dest: "live_updates",
      },
      {
        id: "road-learning", icon: "✏️", en: "Road learning", es: "Aprendizaje de rutas",
        subEn: "Where the app learned a road fix from real drives — the corrections log",
        subEs: "Dónde la app aprendió una corrección de ruta de viajes reales — el registro de correcciones",
        dest: "road_learning",
      },
      {
        id: "onboarding", icon: "🧭", en: "Getting started", es: "Primeros pasos",
        subEn: "The guided onboarding checklist — progress saved",
        subEs: "La lista guiada de inicio — progreso guardado",
        direct: "onboarding",
      },
      {
        id: "plans", icon: "💳", en: "Plans", es: "Planes",
        subEn: "Basic, Gold, Diamond, Owner — and the coin flow",
        subEs: "Basic, Gold, Diamond, Owner — y el flujo de la moneda",
        dest: "plans",
      },
      {
        id: "language", icon: "🌐", en: "App language", es: "Idioma de la app",
        subEn: "Settings → Appearance — English · Español · Português · Русский · Українська; the whole app follows",
        subEs: "Ajustes → Apariencia — English · Español · Português · Русский · Українська; toda la app sigue tu idioma",
        dest: "language",
      },
      {
        id: "settings", icon: "⚙️", en: "Settings", es: "Ajustes",
        subEn: "Appearance, driving, truck, alerts, security, privacy",
        subEs: "Apariencia, conducción, camión, alertas, seguridad, privacidad",
        dest: "settings",
      },
      {
        id: "full-menu", icon: "☰", en: "Full menu", es: "Menú completo",
        subEn: "Dictionary, FAQ, About, support, disclaimer",
        subEs: "Diccionario, preguntas frecuentes, Acerca de, soporte, aviso legal",
        direct: "menu",
      },
    ],
  },
];

/** Every directory item, flattened in group order. */
export const ALL_TOOL_ITEMS: ToolItem[] = TOOL_GROUPS.flatMap((g) => g.items);
