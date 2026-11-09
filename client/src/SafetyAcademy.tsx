// SafetyAcademy.tsx — the Safety Training Academy (premium: Diamond Driver /
// Owner). Ten real courses: short plain-language lessons (English +
// Spanish, following the app's language setting) ending in a 5-question
// quiz. The SERVER grades every quiz (the answer keys live only in
// actions.ts), records every attempt, and seals each passed completion
// into the hash chain. Production starts empty: no progress exists until
// a driver earns it. These are STONEMILES training-completion records —
// real documentation a fleet can file, NOT an accredited third-party
// certification; the landing says so in plain words.

import { useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { Section, XBar } from "./NextLevel";
import { ACADEMY_I18N, academyOverlayLang } from "./academyI18n";
import { t as tt, type Lang } from "./i18n";

type Banner = (s: string | null) => void;

export const PASSING_PCT = 80;

type Lesson = { titleEn: string; titleEs: string; bodyEn: string; bodyEs: string };
type QuizQ = { qEn: string; qEs: string; optsEn: string[]; optsEs: string[] };
type Course = {
  id: string;
  icon: string;
  core: boolean;
  titleEn: string;
  titleEs: string;
  blurbEn: string;
  blurbEs: string;
  lessons: Lesson[];
  quiz: QuizQ[];
};

export const COURSES: Course[] = [
  {
    id: "defensive-driving",
    icon: "🛡️",
    core: true,
    titleEn: "Defensive Driving",
    titleEs: "Manejo defensivo",
    blurbEn: "Space, scanning, and smooth inputs — the habits that keep a big rig out of other people's crashes.",
    blurbEs: "Espacio, observación y movimientos suaves: los hábitos que mantienen un camión grande fuera de los accidentes de otros.",
    lessons: [
      {
        titleEn: "Space is your safety system",
        titleEs: "El espacio es tu sistema de seguridad",
        bodyEn: "A loaded tractor-trailer at highway speed needs a long way to stop, so your following gap is the one safety system that is always on. A good rule: at least one second of gap for every 10 feet of vehicle length at speeds under 40 mph, and double that above 40 mph or in bad weather — for a 70-foot combination at highway speed, that means roughly 7 seconds or more. Count it off a fixed point: when the vehicle ahead passes it, you should finish counting before you reach it. If traffic takes your gap, ease off the throttle and rebuild it. Space you keep is a crash that never happens.",
        bodyEs: "Un tractocamión cargado a velocidad de carretera necesita mucha distancia para detenerse, así que tu distancia de seguimiento es el sistema de seguridad que siempre está activo. Una buena regla: al menos un segundo por cada 10 pies de longitud del vehículo a menos de 40 mph, y el doble por encima de 40 mph o con mal clima. Para una combinación de 70 pies en carretera, eso significa unos 7 segundos o más. Cuéntalo con un punto fijo: cuando el vehículo de adelante lo pase, debes terminar de contar antes de llegar tú. Si el tráfico te quita el espacio, suelta el acelerador y recupéralo. El espacio que mantienes es un accidente que nunca sucede.",
      },
      {
        titleEn: "See it early, steer smooth",
        titleEs: "Míralo temprano, gira suave",
        bodyEn: "Aim your eyes 12 to 15 seconds ahead — that is where your decisions come from. Check your mirrors every 5 to 8 seconds so you always know what is beside and behind you, and glance at brake lights two or three vehicles ahead, not just the one in front. Sudden steering is what rolls trucks over: a hard swerve at highway speed can tip a loaded trailer even when the road is clear. Smooth, early inputs — a gentle lane change, an early lift off the throttle — keep the load settled and give everyone around you time to react.",
        bodyEs: "Apunta tu mirada de 12 a 15 segundos adelante: de ahí vienen tus decisiones. Revisa los espejos cada 5 a 8 segundos para saber siempre qué hay a tu lado y detrás, y observa las luces de freno dos o tres vehículos adelante, no solo el de enfrente. Los giros bruscos son lo que vuelca los camiones: un volantazo a velocidad de carretera puede volcar un remolque cargado aunque la vía esté libre. Los movimientos suaves y tempranos mantienen la carga estable y dan tiempo de reaccionar a todos.",
      },
      {
        titleEn: "Speed fits the road, not the schedule",
        titleEs: "La velocidad se ajusta al camino, no al horario",
        bodyEn: "The posted limit is a maximum for perfect conditions, not a promise. On curves and exit ramps, the yellow advisory speeds are set for cars in good weather — a loaded truck should run 5 to 10 mph under them. On a long downgrade, pick your gear BEFORE the descent and let the engine brake hold you; riding the service brakes overheats them until they fade. Being ten minutes late is a phone call. Being too fast for one curve is the whole story.",
        bodyEs: "El límite publicado es un máximo para condiciones perfectas, no una promesa. En curvas y rampas de salida, las velocidades recomendadas en amarillo están pensadas para autos con buen clima: un camión cargado debe ir de 5 a 10 mph por debajo. En una bajada larga, elige tu cambio ANTES de descender y deja que el freno de motor te sostenga; usar sin parar los frenos de servicio los sobrecalienta hasta que pierden fuerza. Llegar diez minutos tarde es una llamada telefónica. Ir demasiado rápido en una curva es otra historia.",
      },
    ],
    quiz: [
      {
        qEn: "At highway speed on a dry road, a safe following gap for a 70-foot combination is about…",
        qEs: "A velocidad de carretera con el pavimento seco, una distancia de seguimiento segura para una combinación de 70 pies es de aproximadamente…",
        optsEn: ["2 seconds", "One truck length", "7 seconds or more", "It doesn't matter if your brakes are good"],
        optsEs: ["2 segundos", "El largo de un camión", "7 segundos o más", "No importa si tus frenos están buenos"],
      },
      {
        qEn: "How far ahead should your eyes be scanning as you drive?",
        qEs: "¿Qué tan adelante debe estar tu mirada mientras conduces?",
        optsEn: ["Just the vehicle in front of you", "About 5 seconds ahead", "12 to 15 seconds ahead", "At your hood ornament"],
        optsEs: ["Solo el vehículo de enfrente", "Unos 5 segundos adelante", "De 12 a 15 segundos adelante", "En el frente de tu cofre"],
      },
      {
        qEn: "A car cuts in and takes your following gap. The best response is to…",
        qEs: "Un auto se mete y te quita tu distancia de seguimiento. La mejor respuesta es…",
        optsEn: ["Brake hard so they learn a lesson", "Ease off the throttle and rebuild your space", "Change lanes immediately, no signal needed", "Flash your lights and honk until they move"],
        optsEs: ["Frenar fuerte para que aprendan la lección", "Soltar el acelerador y recuperar tu espacio", "Cambiar de carril de inmediato, sin señal", "Prender las luces y tocar la bocina hasta que se muevan"],
      },
      {
        qEn: "Yellow advisory speeds on ramps and curves are set for…",
        qEs: "Las velocidades recomendadas en amarillo en rampas y curvas están pensadas para…",
        optsEn: ["Fully loaded trucks", "The minimum legal speed", "Trucks at night only", "Cars in good weather — trucks should run slower"],
        optsEs: ["Camiones totalmente cargados", "La velocidad mínima legal", "Camiones solo de noche", "Autos con buen clima: los camiones deben ir más lento"],
      },
      {
        qEn: "Before a long downgrade, you should…",
        qEs: "Antes de una bajada larga, debes…",
        optsEn: ["Ride the service brakes to stay at the limit", "Coast in neutral to save fuel", "Select a lower gear before descending and let the engine brake work", "Speed up so you spend less time on the hill"],
        optsEs: ["Usar los frenos de servicio sin parar para mantener el límite", "Bajar en neutral para ahorrar combustible", "Elegir un cambio más bajo antes de descender y dejar trabajar el freno de motor", "Acelerar para pasar menos tiempo en la bajada"],
      },
    ],
  },
  {
    id: "hos-rules",
    icon: "⏱️",
    core: true,
    titleEn: "Hours of Service Rules & Logs",
    titleEs: "Reglas de horas de servicio y registros",
    blurbEn: "The four clocks, the break rule, split sleeper, and why the log has to be the truth.",
    blurbEs: "Los cuatro relojes, la regla del descanso, el camarote dividido y por qué el registro debe ser la verdad.",
    lessons: [
      {
        titleEn: "The four clocks",
        titleEs: "Los cuatro relojes",
        bodyEn: "Property-carrying drivers live by four limits. The 11-hour driving limit: after 10 consecutive hours off, you may drive up to 11 hours. The 14-hour window: once you come on duty, driving must stop 14 hours later, no matter how many breaks you took inside the window. The 70-hour/8-day limit: your on-duty time over the last 8 days cannot pass 70 hours (a 34-hour restart resets it). And the clocks only reset the way the rules say — a nap inside the 14-hour window does not stop that window. Know which clock runs out first; that one is your real deadline.",
        bodyEs: "Los conductores de carga viven con cuatro límites. El límite de 11 horas de manejo: después de 10 horas consecutivas de descanso, puedes manejar hasta 11 horas. La ventana de 14 horas: una vez que entras en servicio, debes dejar de manejar 14 horas después, sin importar cuántos descansos tomes dentro de la ventana. El límite de 70 horas en 8 días: tu tiempo en servicio de los últimos 8 días no puede pasar de 70 horas (un reinicio de 34 horas lo restablece). Y los relojes solo se reinician como dicen las reglas: una siesta dentro de la ventana de 14 horas no detiene esa ventana. Conoce qué reloj se acaba primero; ese es tu verdadero límite.",
      },
      {
        titleEn: "The 30-minute break and split sleeper",
        titleEs: "El descanso de 30 minutos y el camarote dividido",
        bodyEn: "After 8 cumulative hours of driving time, you cannot drive again until you take a 30-minute interruption — off duty, sleeper berth, or on duty not driving all count. The split-sleeper rule lets you divide your 10-hour reset into two qualifying periods (at least 7 hours in the berth plus at least 2 hours off or in the berth, or 8/2 either way) as long as the pair adds to 10 — and a qualifying pair pauses the 14-hour clock. Used right, split sleeper is how a driver legally works around a shipper delay instead of running out of hours at a dock.",
        bodyEs: "Después de 8 horas acumuladas de manejo, no puedes volver a manejar hasta tomar una interrupción de 30 minutos: fuera de servicio, camarote o en servicio sin manejar, todo cuenta. La regla del camarote dividido permite partir tu descanso de 10 horas en dos periodos válidos (al menos 7 horas en el camarote más al menos 2 horas fuera o en el camarote, u 8/2 en cualquier orden) siempre que la pareja sume 10, y una pareja válida pausa el reloj de 14 horas. Bien usado, el camarote dividido es cómo un conductor trabaja legalmente alrededor de una demora en la bodega en vez de quedarse sin horas en el muelle.",
      },
      {
        titleEn: "Log it true",
        titleEs: "Regístralo con la verdad",
        bodyEn: "Your ELD is the official record, and the log has to match reality: a falsified log is one of the fastest ways to lose your CDL and, after a crash, your freedom. Two narrow exceptions exist. Adverse driving conditions — weather or road trouble you did not know about before dispatch — can extend the driving limit and the window by up to 2 hours (never the break or the weekly limit). Personal conveyance is off-duty movement of the truck for personal reasons, like driving to dinner after your shift; it is not advancing a load, and using it to get closer to a delivery is a violation. When in doubt, log what you actually did.",
        bodyEs: "Tu ELD es el registro oficial, y el registro debe coincidir con la realidad: un registro falsificado es una de las formas más rápidas de perder tu CDL y, después de un accidente, tu libertad. Existen dos excepciones estrechas. Las condiciones adversas de manejo —clima o problemas en la vía que no conocías antes del despacho— pueden extender el límite de manejo y la ventana hasta 2 horas (nunca el descanso ni el límite semanal). El transporte personal es el movimiento fuera de servicio del camión por razones personales, como ir a cenar después de tu turno; no es avanzar una carga, y usarlo para acercarte a una entrega es una infracción. Ante la duda, registra lo que realmente hiciste.",
      },
    ],
    quiz: [
      {
        qEn: "After 10 consecutive hours off duty, what is the maximum driving time before another 10-hour break?",
        qEs: "Después de 10 horas consecutivas fuera de servicio, ¿cuál es el tiempo máximo de manejo antes de otro descanso de 10 horas?",
        optsEn: ["10 hours", "11 hours", "12 hours", "14 hours"],
        optsEs: ["10 horas", "11 horas", "12 horas", "14 horas"],
      },
      {
        qEn: "The 14-hour rule means…",
        qEs: "La regla de las 14 horas significa…",
        optsEn: ["You may be on duty 14 hours but drive 16", "Once you come on duty, all driving must stop 14 hours later, breaks included in the count", "You must sleep 14 hours after a shift", "Your weekly total is capped at 14 hours a day averaged"],
        optsEs: ["Puedes estar en servicio 14 horas pero manejar 16", "Una vez que entras en servicio, todo el manejo debe detenerse 14 horas después, con los descansos contados dentro", "Debes dormir 14 horas después de un turno", "Tu total semanal está limitado a un promedio de 14 horas por día"],
      },
      {
        qEn: "A 30-minute break is required after…",
        qEs: "Se requiere un descanso de 30 minutos después de…",
        optsEn: ["8 cumulative hours of driving time", "Every fuel stop", "5 hours on duty, driving or not", "Only when you feel tired"],
        optsEs: ["8 horas acumuladas de tiempo de manejo", "Cada parada de combustible", "5 horas en servicio, manejando o no", "Solo cuando te sientes cansado"],
      },
      {
        qEn: "Which split-sleeper pair qualifies (and pauses the 14-hour clock)?",
        qEs: "¿Qué pareja de camarote dividido es válida (y pausa el reloj de 14 horas)?",
        optsEn: ["5 hours + 5 hours", "6 hours + 4 hours", "7 hours in the berth + 2 hours off duty", "Any two naps that feel restful"],
        optsEs: ["5 horas + 5 horas", "6 horas + 4 horas", "7 horas en el camarote + 2 horas fuera de servicio", "Dos siestas que se sientan reparadoras"],
      },
      {
        qEn: "Adverse driving conditions can extend…",
        qEs: "Las condiciones adversas de manejo pueden extender…",
        optsEn: ["Nothing — there is no such rule", "Only your pay", "Your break time", "The driving limit and the 14-hour window by up to 2 hours"],
        optsEs: ["Nada: no existe tal regla", "Solo tu pago", "Tu tiempo de descanso", "El límite de manejo y la ventana de 14 horas hasta por 2 horas"],
      },
    ],
  },
  {
    id: "pretrip-dvir",
    icon: "🔍",
    core: true,
    titleEn: "Pre-Trip Inspection & DVIR",
    titleEs: "Inspección previa al viaje y DVIR",
    blurbEn: "The same circle every time, the safety-critical five, and a DVIR written like evidence.",
    blurbEs: "El mismo círculo cada vez, los cinco puntos críticos de seguridad y un DVIR escrito como evidencia.",
    lessons: [
      {
        titleEn: "Walk the same circle every time",
        titleEs: "Camina el mismo círculo cada vez",
        bodyEn: "A good pre-trip is a routine, not a search. Start at the same place every day — approach the truck looking for leaks and lean, check the engine compartment, start the engine and watch the gauges, test the lights, then walk the driver's side, the coupling, the trailer, the rear, and back up the passenger side. Same order every time means a defect has to hide from a system, not from your memory. It takes about as long as a coffee, and it is the inspection the officer at the scale house assumes you did.",
        bodyEs: "Una buena inspección previa es una rutina, no una búsqueda. Empieza en el mismo lugar cada día: acércate al camión buscando fugas e inclinación, revisa el compartimento del motor, arranca el motor y observa los indicadores, prueba las luces, y luego camina el lado del conductor, el acople, el remolque, la parte trasera y de regreso por el lado del pasajero. El mismo orden cada vez significa que un defecto tiene que esconderse de un sistema, no de tu memoria. Toma más o menos lo que un café, y es la inspección que el oficial en la báscula asume que hiciste.",
      },
      {
        titleEn: "The safety-critical five",
        titleEs: "Los cinco críticos de seguridad",
        bodyEn: "Five systems can kill people when they fail, and they get your sharpest eyes: tires (tread, inflation, damage — steer tires need at least 4/32 tread), brakes (slack, leaks, low-air warning, parking brake hold), lights and reflectors (every light working, lenses clean), coupling (fifth wheel locked, jaws closed on the kingpin, safety chains and air lines right on a trailer), and load securement. A defect in one of these is not a 'watch it' item — it is a fix-before-you-roll item, and the app flags it to your owner for exactly that reason.",
        bodyEs: "Cinco sistemas pueden matar gente cuando fallan, y merecen tu mirada más atenta: llantas (banda, presión, daños: las llantas de dirección necesitan al menos 4/32 de banda), frenos (ajuste, fugas, alarma de baja presión, freno de estacionamiento firme), luces y reflectores (todas funcionando, lentes limpios), acople (quinta rueda bloqueada, mordazas cerradas en el perno rey, cadenas de seguridad y líneas de aire correctas) y sujeción de la carga. Un defecto en uno de estos no es algo de 'vigilar': es algo de arreglar antes de salir, y la aplicación lo marca a tu propietario exactamente por eso.",
      },
      {
        titleEn: "Write the DVIR like it matters",
        titleEs: "Escribe el DVIR como si importara",
        bodyEn: "The Driver Vehicle Inspection Report is the paper trail of that walk. Before you drive, review the PREVIOUS DVIR: any defect listed there must have been repaired or certified as not needing repair before the truck rolls again. Note your own defects plainly — what it is and where it is — sign it, and keep the copy. A defect-free day still gets a signed report where your company requires one. After a breakdown or a roadside inspection, that honest DVIR history is what proves the truck was looked after.",
        bodyEs: "El informe de inspección del vehículo (DVIR) es el registro en papel de esa caminata. Antes de manejar, revisa el DVIR ANTERIOR: cualquier defecto anotado allí debe haber sido reparado o certificado como que no necesitaba reparación antes de que el camión vuelva a salir. Anota tus propios defectos con claridad —qué es y dónde está—, fírmalo y guarda la copia. Un día sin defectos también lleva un informe firmado donde tu empresa lo requiere. Después de una avería o una inspección en carretera, ese historial honesto del DVIR es lo que prueba que el camión estaba cuidado.",
      },
    ],
    quiz: [
      {
        qEn: "Which defect must be fixed BEFORE the truck rolls?",
        qEs: "¿Qué defecto debe arreglarse ANTES de que el camión salga?",
        optsEn: ["The in-cab radio is dead", "Low windshield washer fluid", "An air brake leak with the low-air warning coming on", "A scuffed mudflap"],
        optsEs: ["La radio de la cabina no funciona", "Poco líquido limpiaparabrisas", "Una fuga en los frenos de aire con la alarma de baja presión activándose", "Una lodera raspada"],
      },
      {
        qEn: "Before driving, the previous DVIR matters because…",
        qEs: "Antes de manejar, el DVIR anterior importa porque…",
        optsEn: ["It tells you the fuel level", "Defects listed on it must be repaired, or certified as not needing repair, before the truck rolls again", "Officers never look at it", "It replaces today's inspection if it was clean"],
        optsEs: ["Te dice el nivel de combustible", "Los defectos anotados en él deben repararse, o certificarse como que no necesitan reparación, antes de que el camión vuelva a salir", "Los oficiales nunca lo miran", "Reemplaza la inspección de hoy si estaba limpio"],
      },
      {
        qEn: "Minimum tread depth for STEER tires is…",
        qEs: "La profundidad mínima de banda para las llantas de DIRECCIÓN es…",
        optsEn: ["2/32 inch", "No minimum if the tire holds air", "4/32 inch", "8/32 inch"],
        optsEs: ["2/32 de pulgada", "Sin mínimo si la llanta tiene aire", "4/32 de pulgada", "8/32 de pulgada"],
      },
      {
        qEn: "When air pressure falls to roughly 60 psi on a typical air-brake truck…",
        qEs: "Cuando la presión de aire cae a unas 60 psi en un camión típico con frenos de aire…",
        optsEn: ["Nothing happens", "The low-air warning must come on — a defect to fix, not to drive with", "The brakes work better", "The governor adds more air automatically"],
        optsEs: ["No pasa nada", "La alarma de baja presión debe activarse: es un defecto para reparar, no para manejar con él", "Los frenos funcionan mejor", "El gobernador agrega más aire automáticamente"],
      },
      {
        qEn: "During the coupling check, what proves the fifth wheel is locked on the kingpin?",
        qEs: "Durante la revisión del acople, ¿qué prueba que la quinta rueda está bloqueada en el perno rey?",
        optsEn: ["The trailer looks level", "The release handle is in, the jaws are closed around the kingpin, and there is no gap between the fifth wheel and the trailer's apron plate", "The air lines are connected", "The landing gear is up"],
        optsEs: ["El remolque se ve nivelado", "La palanca de liberación está adentro, las mordazas están cerradas alrededor del perno rey y no hay espacio entre la quinta rueda y la placa del remolque", "Las líneas de aire están conectadas", "Las patas de apoyo están arriba"],
      },
    ],
  },
];

COURSES.push(
  {
    id: "winter-ice",
    icon: "❄️",
    core: false,
    titleEn: "Winter & Ice Driving",
    titleEs: "Manejo en invierno y hielo",
    blurbEn: "Slow down before you have to, read black ice, chain up on time, and know when the answer is to park.",
    blurbEs: "Reduce la velocidad antes de tener que hacerlo, detecta el hielo negro, pon las cadenas a tiempo y sabe cuándo la respuesta es estacionar.",
    lessons: [
      {
        titleEn: "Slow down before you have to",
        titleEs: "Reduce la velocidad antes de tener que hacerlo",
        bodyEn: "Traction lost is speed you cannot get back. On wet pavement, cut your speed by about a third; on packed snow, cut it in half; on ice, the safe speed may be a crawl — or zero. If the road is icy and the wind is pushing, parking is not quitting, it is the professional call. Bridges and overpasses freeze first because cold air flows under them, and shaded curves stay icy after sunny stretches are clear. If spray from other tires suddenly stops, the water on the road is turning to ice under you.",
        bodyEs: "La tracción perdida es velocidad que no puedes recuperar. En pavimento mojado, reduce tu velocidad en un tercio; en nieve compactada, a la mitad; en hielo, la velocidad segura puede ser mínima, o cero. Si la carretera tiene hielo y el viento empuja, estacionar no es rendirse: es la decisión profesional. Los puentes y pasos elevados se congelan primero porque el aire frío pasa por debajo, y las curvas con sombra siguen con hielo cuando los tramos soleados ya están limpios. Si el rocío de las otras llantas se detiene de repente, el agua del camino se está convirtiendo en hielo debajo de ti.",
      },
      {
        titleEn: "Gentle inputs, long gaps",
        titleEs: "Movimientos suaves, distancias largas",
        bodyEn: "On slick roads every input gets halved: half the steering, half the throttle, half the brake, twice the following distance. Turn off cruise control — it cannot feel a slide starting and can drive the wheels exactly when they should coast. Use the engine brake with care: on very slick surfaces a strong Jake brake can break the drive tires loose, so many fleets teach running it low or off on ice. If the trailer starts to come around, the worst move is a hard brake; trained drivers ease off and steer gently toward the trailer's drift to straighten the rig.",
        bodyEs: "En caminos resbalosos cada movimiento se reduce a la mitad: mitad de giro, mitad de acelerador, mitad de freno, y el doble de distancia de seguimiento. Apaga el control de crucero: no puede sentir que empieza un derrape y puede impulsar las ruedas justo cuando deberían rodar libres. Usa el freno de motor con cuidado: en superficies muy resbalosas un freno Jake fuerte puede soltar las llantas motrices, por eso muchas flotas enseñan a llevarlo bajo o apagado en hielo. Si el remolque empieza a cruzarse, lo peor es frenar fuerte; los conductores entrenados sueltan y giran suavemente hacia el derrape del remolque para enderezar el conjunto.",
      },
      {
        titleEn: "Chains and the winter kit",
        titleEs: "Cadenas y el equipo de invierno",
        bodyEn: "Chain laws are not suggestions: when the chain sign is on, you chain up BEFORE the checkpoint or the slick grade, not on it. Practice putting your chains on in daylight at the yard so the first time is not at midnight in a storm; carry a flashlight, gloves, and something waterproof to kneel on. After chaining, drive a short distance and re-tighten. Your winter kit earns its space: extra fuel treatment against gelling, a scraper, washer fluid rated for the cold, food, water, blankets, and a phone charger — a parked night in a storm should be an inconvenience, not an emergency.",
        bodyEs: "Las leyes de cadenas no son sugerencias: cuando la señal de cadenas está activada, encadenas ANTES del punto de control o de la subida resbalosa, no sobre ella. Practica poner tus cadenas con luz del día en el patio para que la primera vez no sea a medianoche en una tormenta; lleva linterna, guantes y algo impermeable para arrodillarte. Después de encadenar, avanza una distancia corta y vuelve a apretar. Tu equipo de invierno se gana su espacio: tratamiento extra contra la gelificación del diésel, un raspador, líquido limpiaparabrisas para frío, comida, agua, cobijas y cargador de teléfono: una noche estacionado en una tormenta debe ser una molestia, no una emergencia.",
      },
    ],
    quiz: [
      {
        qEn: "On packed snow, your speed should generally be cut by about…",
        qEs: "En nieve compactada, tu velocidad generalmente debe reducirse en aproximadamente…",
        optsEn: ["One third", "Half", "Nothing, if you have good tires", "10 mph exactly"],
        optsEs: ["Un tercio", "La mitad", "Nada, si tienes buenas llantas", "Exactamente 10 mph"],
      },
      {
        qEn: "On ice, cruise control should be…",
        qEs: "En hielo, el control de crucero debe estar…",
        optsEn: ["On — it holds speed smoothly", "Set 5 mph lower", "Off — it cannot feel a slide and can power the wheels at the wrong moment", "Used only downhill"],
        optsEs: ["Encendido: mantiene la velocidad suavemente", "Ajustado 5 mph más bajo", "Apagado: no puede sentir un derrape y puede impulsar las ruedas en el momento equivocado", "Usado solo en bajadas"],
      },
      {
        qEn: "Where does ice usually form FIRST?",
        qEs: "¿Dónde suele formarse el hielo PRIMERO?",
        optsEn: ["In sunny straight stretches", "On bridges and overpasses, and in shaded curves", "Only at truck stops", "On gravel shoulders"],
        optsEs: ["En tramos rectos soleados", "En puentes y pasos elevados, y en curvas con sombra", "Solo en las paradas de camiones", "En los acotamientos de grava"],
      },
      {
        qEn: "A sudden stop in the road spray from other vehicles' tires can mean…",
        qEs: "Que el rocío de las llantas de otros vehículos se detenga de repente puede significar…",
        optsEn: ["Traffic is speeding up", "The water on the road is freezing into ice", "Your mirrors are fogged", "The rain has ended for good"],
        optsEs: ["El tráfico está acelerando", "El agua del camino se está congelando y convirtiéndose en hielo", "Tus espejos están empañados", "La lluvia terminó para siempre"],
      },
      {
        qEn: "When the chain law is in effect, the right time to chain up is…",
        qEs: "Cuando la ley de cadenas está en vigor, el momento correcto de encadenar es…",
        optsEn: ["On the slick grade itself", "Only if you get stuck", "Before the checkpoint or the grade — in a safe, designated area", "At the next fuel stop, whenever that is"],
        optsEs: ["En la misma subida resbalosa", "Solo si te atascas", "Antes del punto de control o de la subida, en un área segura y designada", "En la próxima parada de combustible, sea cuando sea"],
      },
    ],
  },
  {
    id: "load-securement",
    icon: "🪢",
    core: false,
    titleEn: "Load Securement",
    titleEs: "Sujeción de la carga",
    blurbEn: "Working load limits, tie-down counts, and the recheck stops that keep freight — and you — legal.",
    blurbEs: "Límites de carga de trabajo, conteo de amarres y las paradas de revisión que mantienen la carga, y a ti, dentro de la ley.",
    lessons: [
      {
        titleEn: "The 50 percent rule",
        titleEs: "La regla del 50 por ciento",
        bodyEn: "Securement math starts with one number: the aggregate working load limit of your tie-downs must be at least 50 percent of the cargo's weight. A 40,000-pound machine needs tie-downs whose working load limits add up to at least 20,000 pounds. Every strap and chain is rated, and a damaged strap's rating is zero — cuts, frays, and broken stitching retire it on the spot. Friction matters too: a load that can slide needs more securement, and direct tie-downs (attached to the load itself) count differently from indirect ones that pass over the top.",
        bodyEs: "Las matemáticas de la sujeción empiezan con un número: el límite de carga de trabajo total de tus amarres debe ser al menos el 50 por ciento del peso de la carga. Una máquina de 40,000 libras necesita amarres cuyos límites sumen al menos 20,000 libras. Cada correa y cadena tiene una capacidad, y la capacidad de una correa dañada es cero: cortes, deshilachados y costuras rotas la retiran al instante. La fricción también importa: una carga que puede deslizarse necesita más sujeción, y los amarres directos (sujetos a la carga misma) cuentan distinto de los indirectos que pasan por encima.",
      },
      {
        titleEn: "How many tie-downs?",
        titleEs: "¿Cuántos amarres?",
        bodyEn: "Length drives the minimum count: an article 5 feet or shorter and 1,100 pounds or less needs at least one tie-down; longer or heavier articles need two; and past 10 feet, add one more for every additional 10 feet or part of it. Heavy vehicles and machinery have their own rules — four tie-downs minimum, one at each corner, plus chains on accessory equipment. Edge protectors are not decoration: a sharp corner cuts a strap under load, so protect every strap that crosses an edge. When a load is blocked or braced against a headboard, that structure must itself be strong enough for the job.",
        bodyEs: "La longitud determina el conteo mínimo: un artículo de 5 pies o menos y 1,100 libras o menos necesita al menos un amarre; los artículos más largos o pesados necesitan dos; y después de 10 pies, agrega uno más por cada 10 pies adicionales o fracción. Los vehículos y maquinaria pesados tienen sus propias reglas: mínimo cuatro amarres, uno en cada esquina, más cadenas en el equipo accesorio. Los protectores de borde no son decoración: una esquina filosa corta una correa bajo carga, así que protege cada correa que cruce un borde. Cuando una carga está bloqueada o apoyada contra una cabecera, esa estructura también debe ser lo bastante fuerte para el trabajo.",
      },
      {
        titleEn: "Recheck early, recheck often",
        titleEs: "Revisa temprano, revisa seguido",
        bodyEn: "Loads settle. Straps stretch, cargo shifts a quarter inch at a time, and vibration works hooks loose. The rule: inspect the securement within the first 50 miles after loading, then again every 3 hours or 150 miles, and at every duty-status change. Whenever you find a loose strap, fix it there — not at the destination. An officer who finds a securement violation can put the truck out of service, and a load that comes off the trailer is a life-changing day for whoever is behind you.",
        bodyEs: "Las cargas se asientan. Las correas se estiran, la carga se mueve de a poco y la vibración afloja los ganchos. La regla: inspecciona la sujeción dentro de las primeras 50 millas después de cargar, luego otra vez cada 3 horas o 150 millas, y en cada cambio de estado de servicio. Cuando encuentres una correa floja, arréglala ahí, no en el destino. Un oficial que encuentra una infracción de sujeción puede sacar el camión de servicio, y una carga que se cae del remolque cambia la vida de quien venga detrás de ti.",
      },
    ],
    quiz: [
      {
        qEn: "The aggregate working load limit of your tie-downs must be at least…",
        qEs: "El límite de carga de trabajo total de tus amarres debe ser al menos…",
        optsEn: ["10% of the cargo weight", "25% of the cargo weight", "50% of the cargo weight", "Equal to the cargo weight twice over"],
        optsEs: ["El 10% del peso de la carga", "El 25% del peso de la carga", "El 50% del peso de la carga", "El doble del peso de la carga"],
      },
      {
        qEn: "A 40,000 lb machine therefore needs tie-downs rated in total to at least…",
        qEs: "Una máquina de 40,000 lb necesita entonces amarres con capacidad total de al menos…",
        optsEn: ["4,000 lb", "10,000 lb", "20,000 lb", "40,000 lb of chain only"],
        optsEs: ["4,000 lb", "10,000 lb", "20,000 lb", "40,000 lb solo de cadena"],
      },
      {
        qEn: "The FIRST in-trip securement recheck must happen…",
        qEs: "La PRIMERA revisión de sujeción durante el viaje debe hacerse…",
        optsEn: ["Within the first 50 miles after loading", "At the destination", "After 500 miles", "Only if the load feels loose"],
        optsEs: ["Dentro de las primeras 50 millas después de cargar", "En el destino", "Después de 500 millas", "Solo si la carga se siente floja"],
      },
      {
        qEn: "Edge protectors exist to…",
        qEs: "Los protectores de borde existen para…",
        optsEn: ["Make the load look tidy", "Add weight", "Flag the corners for other drivers", "Keep sharp cargo edges from cutting the tie-downs under load"],
        optsEs: ["Hacer que la carga se vea ordenada", "Agregar peso", "Señalar las esquinas a otros conductores", "Evitar que los bordes filosos de la carga corten los amarres bajo carga"],
      },
      {
        qEn: "A strap with a cut or broken stitching has a working load limit of…",
        qEs: "Una correa con un corte o costuras rotas tiene un límite de carga de trabajo de…",
        optsEn: ["Half its rating", "Zero — it is retired on the spot", "Its full rating if the cut is small", "Whatever the shipper says"],
        optsEs: ["La mitad de su capacidad", "Cero: se retira en el acto", "Su capacidad completa si el corte es pequeño", "Lo que diga el embarcador"],
      },
    ],
  },
  {
    id: "fatigue-wellness",
    icon: "😴",
    core: false,
    titleEn: "Fatigue & Wellness",
    titleEs: "Fatiga y bienestar",
    blurbEn: "Sleep science that actually applies at 2 a.m.: warning signs, the nap rule, and caffeine's real limits.",
    blurbEs: "Ciencia del sueño que sí aplica a las 2 a.m.: señales de alerta, la regla de la siesta y los límites reales de la cafeína.",
    lessons: [
      {
        titleEn: "Sleep is the only fix",
        titleEs: "Dormir es la única solución",
        bodyEn: "Adults need 7 to 9 hours of sleep, and a driver who runs on 5 is driving impaired — studies compare long wakefulness to alcohol in what it does to reaction time. Nothing substitutes: not coffee, not a cold window, not loud music. The body's low points come twice a day, roughly 2 to 6 a.m. and again mid-afternoon, and that is when fatigue crashes cluster. A 20-minute nap in a safe place is the one roadside tool that truly works — short enough to wake clear, long enough to reset the worst of the pressure to sleep.",
        bodyEs: "Los adultos necesitan de 7 a 9 horas de sueño, y un conductor que funciona con 5 está conduciendo afectado: los estudios comparan la vigilia prolongada con el alcohol en lo que le hace al tiempo de reacción. Nada lo sustituye: ni el café, ni una ventana fría, ni la música fuerte. Los puntos bajos del cuerpo llegan dos veces al día, aproximadamente de 2 a 6 a.m. y otra vez a media tarde, y ahí es cuando se agrupan los accidentes por fatiga. Una siesta de 20 minutos en un lugar seguro es la única herramienta en carretera que realmente funciona: lo bastante corta para despertar despejado y lo bastante larga para aliviar lo peor de la presión de sueño.",
      },
      {
        titleEn: "Know your warning signs",
        titleEs: "Conoce tus señales de alerta",
        bodyEn: "Fatigue announces itself before it takes you: frequent yawning, heavy eyelids, drifting in the lane, missing a sign or an exit you know, forgetting the last few miles, catching yourself with a start. Any one of these means the decision is already made — the only question is whether you park on purpose or the road decides for you. A four-second microsleep at 60 mph covers about 350 feet blind. There is no load, no appointment, and no dispatcher worth those 350 feet.",
        bodyEs: "La fatiga se anuncia antes de vencerte: bostezos frecuentes, párpados pesados, desviarte en el carril, perderte una señal o una salida que conoces, olvidar las últimas millas, sorprenderte a ti mismo con un sobresalto. Cualquiera de estas señales significa que la decisión ya está tomada: la única pregunta es si estacionas por tu voluntad o si el camino decide por ti. Un microsueño de cuatro segundos a 60 mph recorre unos 350 pies a ciegas. No hay carga, cita ni despachador que valga esos 350 pies.",
      },
      {
        titleEn: "Caffeine, food, and the long game",
        titleEs: "Cafeína, comida y el juego largo",
        bodyEn: "Caffeine takes about 30 minutes to kick in and stays in your system for hours — a coffee before a nap (the 'coffee nap') can stack both benefits, but caffeine late in a shift borrows from the sleep you need after it. Heavy greasy meals pull blood to your gut and pull your alertness down with it; lighter meals, water, and short walks at stops keep you steadier. Over a career, the wellness basics compound: move daily, guard your sleep like an appointment, and keep your medical card honest — hiding a condition helps no one when something goes wrong.",
        bodyEs: "La cafeína tarda unos 30 minutos en hacer efecto y permanece en tu sistema por horas: un café antes de una siesta (la 'siesta con café') puede sumar ambos beneficios, pero la cafeína tarde en un turno le roba al sueño que necesitas después. Las comidas pesadas y grasosas llevan la sangre a tu estómago y bajan tu alerta con ella; comidas ligeras, agua y caminatas cortas en las paradas te mantienen más estable. En una carrera, lo básico del bienestar se acumula: muévete a diario, protege tu sueño como una cita y mantén honesta tu tarjeta médica: esconder una condición no ayuda a nadie cuando algo sale mal.",
      },
    ],
    quiz: [
      {
        qEn: "The only real cure for drowsy driving is…",
        qEs: "La única cura real para manejar con sueño es…",
        optsEn: ["Coffee and an energy drink", "Opening the window", "Sleep — including a short nap in a safe place", "Turning the radio up"],
        optsEs: ["Café y una bebida energética", "Abrir la ventana", "Dormir, incluida una siesta corta en un lugar seguro", "Subir el volumen de la radio"],
      },
      {
        qEn: "A 4-second microsleep at 60 mph covers about…",
        qEs: "Un microsueño de 4 segundos a 60 mph recorre aproximadamente…",
        optsEn: ["35 feet", "100 feet", "350 feet — blind", "One truck length"],
        optsEs: ["35 pies", "100 pies", "350 pies, a ciegas", "El largo de un camión"],
      },
      {
        qEn: "Fatigue crashes cluster most in which hours?",
        qEs: "¿En qué horas se agrupan más los accidentes por fatiga?",
        optsEn: ["9 a.m. to noon", "Roughly 2–6 a.m. and again mid-afternoon", "Only on Fridays", "Whenever it rains"],
        optsEs: ["De 9 a.m. al mediodía", "Aproximadamente de 2 a 6 a.m. y otra vez a media tarde", "Solo los viernes", "Cada vez que llueve"],
      },
      {
        qEn: "Which of these is a reliable warning sign that you must stop and rest?",
        qEs: "¿Cuál de estas es una señal confiable de que debes detenerte a descansar?",
        optsEn: ["You feel alert after coffee", "Drifting in your lane and forgetting the last few miles", "Your favourite song comes on", "Traffic is light"],
        optsEs: ["Te sientes alerta después del café", "Desviarte en tu carril y olvidar las últimas millas", "Suena tu canción favorita", "El tráfico es ligero"],
      },
      {
        qEn: "Caffeine's honest limits are…",
        qEs: "Los límites honestos de la cafeína son…",
        optsEn: ["It replaces sleep completely", "It works instantly and lasts 10 minutes", "It never affects later sleep", "It takes ~30 minutes to kick in, lasts for hours, and does not replace sleep"],
        optsEs: ["Reemplaza el sueño por completo", "Funciona al instante y dura 10 minutos", "Nunca afecta el sueño posterior", "Tarda unos 30 minutos en hacer efecto, dura horas y no reemplaza el sueño"],
      },
    ],
  },
);

COURSES.push(
  {
    id: "distracted-driving",
    icon: "📵",
    core: false,
    titleEn: "Distracted Driving & Phone Policy",
    titleEs: "Conducción distraída y política del teléfono",
    blurbEn: "The handheld rule, why texting is the worst distraction there is, and setting the truck up before it moves.",
    blurbEs: "La regla del teléfono en la mano, por qué textear es la peor distracción y cómo preparar el camión antes de que se mueva.",
    lessons: [
      {
        titleEn: "Hands off the phone — it is the rule, not a tip",
        titleEs: "Manos fuera del teléfono: es la regla, no un consejo",
        bodyEn: "Federal rules for CMV drivers are blunt: no holding a phone, no reaching for one, no dialing by pressing more than a single button, no texting, no reading messages while driving. A violation means fines for you and for a carrier that allows it, plus disqualification for repeat offenses — and after a crash, phone records are the first thing investigators pull. Hands-free, one-touch, mounted: that is the legal shape of phone use in a moving truck. Everything else waits for a parking brake.",
        bodyEs: "Las reglas federales para conductores de vehículos comerciales son directas: no sostener un teléfono, no estirarte para alcanzarlo, no marcar presionando más de un solo botón, no textear, no leer mensajes mientras conduces. Una infracción significa multas para ti y para la empresa que lo permite, además de descalificación por reincidencia, y después de un accidente, los registros del teléfono son lo primero que sacan los investigadores. Manos libres, un solo toque, teléfono montado: esa es la forma legal de usar el teléfono en un camión en movimiento. Todo lo demás espera a que pongas el freno de estacionamiento.",
      },
      {
        titleEn: "Why texting is the worst one",
        titleEs: "Por qué textear es lo peor",
        bodyEn: "Distraction comes in three kinds — eyes off the road, hands off the wheel, mind off the drive — and texting is all three at once. Federal research found texting while driving a commercial vehicle multiplies crash risk many times over (the FMCSA figure commonly cited is 23 times). Reading or sending a text takes your eyes away for about five seconds: at 55 mph that is longer than a football field, crossed blind. A dispatch message, a family text, a fuel price — none of them are written for a moving truck, and all of them will still be there at the next stop.",
        bodyEs: "La distracción viene en tres tipos —ojos fuera del camino, manos fuera del volante, mente fuera del manejo— y textear es los tres a la vez. La investigación federal encontró que textear mientras se conduce un vehículo comercial multiplica el riesgo de accidente muchas veces (la cifra de la FMCSA que se cita comúnmente es 23 veces). Leer o enviar un texto aparta tu vista unos cinco segundos: a 55 mph eso es más que un campo de fútbol americano, recorrido a ciegas. Un mensaje de despacho, un texto familiar, un precio de combustible: ninguno está escrito para un camión en movimiento, y todos seguirán ahí en la próxima parada.",
      },
      {
        titleEn: "Set the truck up before it moves",
        titleEs: "Prepara el camión antes de que se mueva",
        bodyEn: "Most cab distraction is a setup problem. Before you roll: route entered, phone mounted and on do-not-disturb for non-essential alerts, playlist or radio chosen, food and drink within reach and opened, dispatch paperwork where you can glance legally at a stop. Tell family and dispatch your pattern — 'I answer at fuel stops' — so nobody expects a moving reply. If a call or message genuinely cannot wait, the professional move is the same as for fatigue: find a safe place, park, set the brake, then give it your full attention.",
        bodyEs: "La mayor parte de la distracción en cabina es un problema de preparación. Antes de salir: ruta ingresada, teléfono montado y en no molestar para alertas no esenciales, lista de música o radio elegida, comida y bebida al alcance y abiertas, documentos de despacho donde puedas mirarlos legalmente en una parada. Dile a tu familia y a despacho tu patrón —'respondo en las paradas de combustible'— para que nadie espere una respuesta en movimiento. Si una llamada o mensaje de verdad no puede esperar, la decisión profesional es la misma que con la fatiga: busca un lugar seguro, estaciónate, pon el freno y entonces dale tu atención completa.",
      },
    ],
    quiz: [
      {
        qEn: "While driving a CMV, using a handheld phone to dial is…",
        qEs: "Mientras conduces un vehículo comercial, usar un teléfono sostenido en la mano para marcar es…",
        optsEn: ["Fine if traffic is light", "Fine under 35 mph", "Prohibited — along with holding, reaching for, or texting on the phone", "Allowed for dispatch calls only"],
        optsEs: ["Está bien si el tráfico es ligero", "Está bien a menos de 35 mph", "Prohibido, junto con sostener, alcanzar o textear en el teléfono", "Permitido solo para llamadas de despacho"],
      },
      {
        qEn: "Texting is uniquely dangerous because it combines…",
        qEs: "Textear es especialmente peligroso porque combina…",
        optsEn: ["Speed and noise", "Eyes off the road, hands off the wheel, and mind off the drive — all at once", "Only boredom", "Radio interference"],
        optsEs: ["Velocidad y ruido", "Ojos fuera del camino, manos fuera del volante y mente fuera del manejo, todo a la vez", "Solo aburrimiento", "Interferencia con la radio"],
      },
      {
        qEn: "At 55 mph, the ~5 seconds a text takes your eyes for covers…",
        qEs: "A 55 mph, los ~5 segundos que un texto aparta tu vista recorren…",
        optsEn: ["About 50 feet", "One truck length", "More than the length of a football field", "Half a mile"],
        optsEs: ["Unos 50 pies", "El largo de un camión", "Más que el largo de un campo de fútbol americano", "Media milla"],
      },
      {
        qEn: "The legal shape of phone use in a moving truck is…",
        qEs: "La forma legal de usar el teléfono en un camión en movimiento es…",
        optsEn: ["In your lap, on speaker", "Mounted, hands-free, single-button operation", "Any way, if you use voice texting", "Held low, out of camera view"],
        optsEs: ["En tu regazo, con altavoz", "Montado, manos libres, operación de un solo botón", "De cualquier forma, si usas texto por voz", "Sostenido bajo, fuera de la vista de las cámaras"],
      },
      {
        qEn: "A message that genuinely cannot wait should be handled…",
        qEs: "Un mensaje que de verdad no puede esperar debe atenderse…",
        optsEn: ["At the next red light", "By reading it quickly at highway speed", "By slowing to 45 in the right lane", "Parked safely, with the brake set"],
        optsEs: ["En el próximo semáforo en rojo", "Leyéndolo rápido a velocidad de carretera", "Bajando a 45 en el carril derecho", "Estacionado de forma segura, con el freno puesto"],
      },
    ],
  },
  {
    id: "backing-parking",
    icon: "🅿️",
    core: false,
    titleEn: "Backing, Parking & Tight Spaces",
    titleEs: "Retroceso, estacionamiento y espacios reducidos",
    blurbEn: "GOAL, spotters, sight-side backing, and planning your parking before your clock plans it for you.",
    blurbEs: "GOAL, ayudantes, retroceso del lado visible y planear tu estacionamiento antes de que tu reloj lo planee por ti.",
    lessons: [
      {
        titleEn: "GOAL — Get Out And Look",
        titleEs: "GOAL: bájate y mira",
        bodyEn: "Backing is where slow trucks still do fast damage, and the cheapest tool in trucking is your own two feet: GOAL — Get Out And Look. Before the truck moves backward, walk the path: check for poles, low wires, dock plates, parked cars, soft ground, and the exact angle you need. Then back promptly — the picture you walked is freshest right after you walk it, and if anything changes or doubt creeps in, GOAL again. Nobody who knows this business thinks less of a driver for getting out twice.",
        bodyEs: "El retroceso es donde los camiones lentos aún hacen daños rápidos, y la herramienta más barata del transporte son tus propios pies: GOAL, bájate y mira (Get Out And Look). Antes de que el camión se mueva hacia atrás, camina la trayectoria: busca postes, cables bajos, placas de muelle, autos estacionados, suelo blando y el ángulo exacto que necesitas. Luego retrocede sin demora: la imagen que caminaste está más fresca justo después de caminarla, y si algo cambia o surge la duda, GOAL otra vez. Nadie que conoce este negocio piensa menos de un conductor por bajarse dos veces.",
      },
      {
        titleEn: "Spotters and sight-side backing",
        titleEs: "Ayudantes y retroceso del lado visible",
        bodyEn: "Back toward your driver's side whenever you can set it up — your direct view beats any mirror for judging the trailer's swing. If you use a spotter, agree the signals before you move, keep them in your mirror at all times, and follow the golden rule: if you lose sight of the spotter, STOP. The spotter watches the blind areas; you are still the one driving. Use your hazard lights, roll a window down to hear, and give a short horn tap before you start backing in a busy yard to announce the move.",
        bodyEs: "Retrocede hacia el lado del conductor siempre que puedas prepararlo: tu vista directa supera a cualquier espejo para juzgar el giro del remolque. Si usas un ayudante, acuerden las señales antes de moverte, manténlo en tu espejo en todo momento y sigue la regla de oro: si pierdes de vista al ayudante, DETENTE. El ayudante vigila las zonas ciegas; tú sigues siendo quien conduce. Usa tus luces de emergencia, baja una ventana para escuchar y da un toque corto de bocina antes de empezar a retroceder en un patio concurrido para anunciar el movimiento.",
      },
      {
        titleEn: "Parking is planned, not found",
        titleEs: "El estacionamiento se planea, no se encuentra",
        bodyEn: "The parking crunch after dark is predictable, so plan your stop while your clock still has options: pick the primary stop and a backup, favor pull-through spots that let you leave nose-first, and avoid parking on ramps and shoulders, which is illegal in many states and dangerous everywhere. In tight lots, GOAL applies to parking too — walk it, note the exit path, and set up so a morning departure doesn't need a backing move in a crowd. Parking the truck neatly, wheels straight and inside the lines, is the mark other drivers judge you by.",
        bodyEs: "La escasez de estacionamiento después del anochecer es predecible, así que planea tu parada mientras tu reloj aún tiene opciones: elige la parada principal y una de respaldo, prefiere los espacios de paso que te dejan salir de frente y evita estacionar en rampas y acotamientos, que es ilegal en muchos estados y peligroso en todas partes. En lotes reducidos, GOAL también aplica para estacionar: camínalo, observa la ruta de salida y acomódate para que la salida de la mañana no necesite retroceder entre la multitud. Estacionar el camión con orden, ruedas rectas y dentro de las líneas, es la marca por la que otros conductores te juzgan.",
      },
    ],
    quiz: [
      {
        qEn: "GOAL stands for…",
        qEs: "GOAL significa…",
        optsEn: ["Get Out And Look", "Go On And Load", "Gear Oil And Lube", "Get On A Lane"],
        optsEs: ["Get Out And Look (bájate y mira)", "Go On And Load", "Gear Oil And Lube", "Get On A Lane"],
      },
      {
        qEn: "You lose sight of your spotter mid-back. You should…",
        qEs: "Pierdes de vista a tu ayudante a mitad del retroceso. Debes…",
        optsEn: ["Keep backing slowly — they will move out of the way", "Stop immediately until you can see them again", "Speed up to finish before something changes", "Honk until they reappear, while rolling"],
        optsEs: ["Seguir retrocediendo lento: se quitará del camino", "Detenerte de inmediato hasta poder verlo de nuevo", "Acelerar para terminar antes de que algo cambie", "Tocar la bocina hasta que reaparezca, mientras avanzas"],
      },
      {
        qEn: "When you can set it up, you should back toward…",
        qEs: "Cuando puedes prepararlo, debes retroceder hacia…",
        optsEn: ["The blind (passenger) side", "Whichever side is closest", "Your driver's (sight) side, where your direct view is best", "It never matters"],
        optsEs: ["El lado ciego (del pasajero)", "El lado que esté más cerca", "Tu lado del conductor (el lado visible), donde tu vista directa es mejor", "Nunca importa"],
      },
      {
        qEn: "Halfway into a backing move, doubt creeps in about what's behind the trailer. The right move is…",
        qEs: "A mitad de un retroceso, surge la duda sobre qué hay detrás del remolque. Lo correcto es…",
        optsEn: ["Finish quickly from memory", "Ask a passerby to guess", "Trust the mirrors only", "Stop, set the brake, and GOAL again"],
        optsEs: ["Terminar rápido de memoria", "Pedirle a un transeúnte que adivine", "Confiar solo en los espejos", "Detenerte, poner el freno y hacer GOAL otra vez"],
      },
      {
        qEn: "The smart approach to overnight parking is…",
        qEs: "La forma inteligente de abordar el estacionamiento nocturno es…",
        optsEn: ["Start looking when 15 minutes remain on your clock", "Plan the stop — with a backup — while your clock still has options, favoring pull-through spots", "Ramps and shoulders are fine anywhere", "Park wherever the trailer fits, lines or not"],
        optsEs: ["Empezar a buscar cuando queden 15 minutos en tu reloj", "Planear la parada, con una de respaldo, mientras tu reloj aún tiene opciones, prefiriendo espacios de paso", "Las rampas y acotamientos están bien en cualquier lugar", "Estacionar donde quepa el remolque, con líneas o sin ellas"],
      },
    ],
  },
  {
    id: "roadside-inspection",
    icon: "📋",
    core: false,
    titleEn: "Roadside Inspection Readiness",
    titleEs: "Preparación para inspecciones en carretera",
    blurbEn: "What officers actually check, how STONEMILES's DOT Inspection Mode fits in, and how inspections end well.",
    blurbEs: "Qué revisan realmente los oficiales, cómo encaja el Modo de Inspección DOT de STONEMILES y cómo terminan bien las inspecciones.",
    lessons: [
      {
        titleEn: "What the officer is checking",
        titleEs: "Qué está revisando el oficial",
        bodyEn: "A roadside inspection checks three things: you (CDL, medical card, record of duty status), the paperwork (registration, IFTA licence, shipping papers, permits), and the truck (a walk-around that mirrors your pre-trip, up to a full Level I inspection with the officer underneath checking brakes and steering). Your daily logs for today plus the previous 7 days must be available. Everything on that list is something you touched this morning — readiness is not a performance, it is your pre-trip and your paperwork habits, seen from the other side.",
        bodyEs: "Una inspección en carretera revisa tres cosas: a ti (CDL, tarjeta médica, registro de estado de servicio), los documentos (registro del vehículo, licencia IFTA, papeles de embarque, permisos) y el camión (una caminata que refleja tu inspección previa, hasta una inspección completa de Nivel I con el oficial debajo revisando frenos y dirección). Tus registros diarios de hoy más los 7 días anteriores deben estar disponibles. Todo en esa lista es algo que tocaste esta mañana: estar listo no es una actuación, son tus hábitos de inspección previa y de documentos, vistos desde el otro lado.",
      },
      {
        titleEn: "DOT Inspection Mode in STONEMILES",
        titleEs: "El Modo de Inspección DOT en STONEMILES",
        bodyEn: "STONEMILES's DOT Inspection Mode — the big button on the Driver tab and in the Menu — opens a locked-down officer view: your current duty status, your HOS clocks, the last 8 days of duty logs, today's and yesterday's signed DVIRs, and a verify code an officer can check with no account to confirm the packet is genuine. It exists so one tap, gloves on, hands the officer a clean screen. Hold the honest line printed at its top: STONEMILES is a planning and record-keeping aid, NOT an FMCSA-registered ELD — if your carrier runs a certified ELD, that system holds the official record, and STONEMILES mirrors it.",
        bodyEs: "El Modo de Inspección DOT de STONEMILES —el botón grande en la pestaña del Conductor y en el Menú— abre una vista bloqueada para el oficial: tu estado de servicio actual, tus relojes de horas de servicio, los últimos 8 días de registros, los DVIR firmados de hoy y ayer, y un código de verificación que un oficial puede comprobar sin cuenta para confirmar que el paquete es genuino. Existe para que un solo toque, con los guantes puestos, le entregue al oficial una pantalla limpia. Mantén la línea honesta impresa arriba: STONEMILES es una ayuda de planificación y registro, NO un ELD registrado ante la FMCSA: si tu empresa usa un ELD certificado, ese sistema tiene el registro oficial y STONEMILES lo refleja.",
      },
      {
        titleEn: "How inspections end well",
        titleEs: "Cómo terminan bien las inspecciones",
        bodyEn: "Pull in promptly and safely when signaled, stay professional, and have documents reachable instead of buried — courtesy is not weakness, it is time management. Answer questions truthfully and briefly; never argue a violation on the roadside, because the place to dispute it is the citation process afterward. Know the stakes accurately: out-of-service violations (brakes, tires, hours) park the truck or you until fixed, and inspection results feed the safety scores fleets and insurers read. When it ends, log the time as it happened and report the result to your company the same day.",
        bodyEs: "Entra con prontitud y seguridad cuando te lo señalen, mantén la profesionalidad y ten los documentos al alcance en vez de enterrados: la cortesía no es debilidad, es administrar el tiempo. Responde las preguntas con la verdad y brevemente; nunca discutas una infracción en la carretera, porque el lugar para disputarla es el proceso de citación después. Conoce las consecuencias con exactitud: las infracciones de fuera de servicio (frenos, llantas, horas) estacionan el camión o a ti hasta que se arreglen, y los resultados de inspección alimentan los puntajes de seguridad que leen flotas y aseguradoras. Cuando termine, registra el tiempo tal como pasó e informa el resultado a tu empresa el mismo día.",
      },
    ],
    quiz: [
      {
        qEn: "How many days of duty logs must be available at a roadside inspection?",
        qEs: "¿Cuántos días de registros de servicio deben estar disponibles en una inspección en carretera?",
        optsEn: ["Today only", "Today plus the previous 7 days", "The last 30 days", "Logs are never checked roadside"],
        optsEs: ["Solo hoy", "Hoy más los 7 días anteriores", "Los últimos 30 días", "Los registros nunca se revisan en carretera"],
      },
      {
        qEn: "If your carrier runs a certified ELD, the official record is held by…",
        qEs: "Si tu empresa usa un ELD certificado, el registro oficial lo tiene…",
        optsEn: ["STONEMILES", "Your paper notebook", "The certified ELD — STONEMILES mirrors it as a planning aid", "The last scale house"],
        optsEs: ["STONEMILES", "Tu cuaderno de papel", "El ELD certificado: STONEMILES lo refleja como ayuda de planificación", "La última báscula"],
      },
      {
        qEn: "A Level I inspection is…",
        qEs: "Una inspección de Nivel I es…",
        optsEn: ["A paperwork-only check", "A driver-interview only", "The full North American Standard inspection, including under the vehicle — brakes, steering, coupling", "A weigh-only pass"],
        optsEs: ["Una revisión solo de documentos", "Solo una entrevista al conductor", "La inspección completa del Estándar Norteamericano, incluso debajo del vehículo: frenos, dirección, acople", "Solo un pesaje"],
      },
      {
        qEn: "An out-of-service violation means…",
        qEs: "Una infracción de fuera de servicio significa…",
        optsEn: ["A small fine, keep rolling", "The truck (or driver) cannot move until the violation is corrected", "A warning you can ignore", "Extra paperwork at the next stop only"],
        optsEs: ["Una multa pequeña, sigue rodando", "El camión (o el conductor) no puede moverse hasta que la infracción se corrija", "Una advertencia que puedes ignorar", "Solo documentos extra en la próxima parada"],
      },
      {
        qEn: "The best way to dispute a violation you believe is wrong is…",
        qEs: "La mejor manera de disputar una infracción que crees incorrecta es…",
        optsEn: ["Argue it on the roadside until the officer agrees", "Refuse to sign anything and drive off", "Stay professional roadside and dispute it afterward through the citation process", "Call dispatch and have them argue for you"],
        optsEs: ["Discutirla en la carretera hasta que el oficial esté de acuerdo", "Negarte a firmar algo e irte", "Mantener la profesionalidad en la carretera y disputarla después mediante el proceso de citación", "Llamar a despacho y que ellos discutan por ti"],
      },
    ],
  },
  {
    id: "hazmat-awareness",
    icon: "☣️",
    core: false,
    titleEn: "Hazmat Awareness",
    titleEs: "Conciencia sobre materiales peligrosos",
    blurbEn: "Placards, papers within reach, and the first moves when something leaks — awareness level, honestly labelled.",
    blurbEs: "Letreros, documentos al alcance y los primeros pasos cuando algo se fuga: nivel de conciencia, etiquetado con honestidad.",
    lessons: [
      {
        titleEn: "Papers and placards tell the story",
        titleEs: "Los documentos y letreros cuentan la historia",
        bodyEn: "For hazardous materials, the shipping paper is the load's identity: proper shipping name, hazard class, ID number, and an emergency contact, and it must ride within your immediate reach — in a door pocket or on the seat — and be handed over cleanly at an inspection or a crash scene. Placards must be readable from all four sides of the truck and match what is actually loaded; a wrong placard is worse than a missing one because it lies to the firefighters arriving first. If your load needs placards, it also needs a driver with the hazmat endorsement — awareness is not a substitute for the endorsement or your carrier's training.",
        bodyEs: "Para materiales peligrosos, el documento de embarque es la identidad de la carga: nombre oficial de embarque, clase de peligro, número de identificación y un contacto de emergencia, y debe viajar a tu alcance inmediato —en un bolsillo de la puerta o en el asiento— y entregarse con claridad en una inspección o en la escena de un accidente. Los letreros deben ser legibles desde los cuatro lados del camión y coincidir con lo que realmente va cargado; un letrero incorrecto es peor que uno faltante porque miente a los bomberos que llegan primero. Si tu carga necesita letreros, también necesita un conductor con la certificación de materiales peligrosos: la conciencia no sustituye la certificación ni la capacitación de tu empresa.",
      },
      {
        titleEn: "Parking, attendance, and smoking",
        titleEs: "Estacionamiento, vigilancia y fumar",
        bodyEn: "Placarded loads travel under extra rules: the truck must be attended or parked where the rules allow (never on or under a bridge, never in a tunnel, kept clear of crowded places when parked), tires checked at every stop because a fire starts small, and no smoking or open flame within 25 feet of certain classes of hazmat — explosives, flammables, oxidizers among them. Tunnels and some bridges restrict or ban placarded loads outright; posted signs rule, and the hazmat flags in STONEMILES are planning aids to warn you early, not permission to roll.",
        bodyEs: "Las cargas con letreros viajan bajo reglas extra: el camión debe estar vigilado o estacionado donde las reglas lo permiten (nunca sobre o bajo un puente, nunca en un túnel, lejos de lugares concurridos al estacionar), las llantas se revisan en cada parada porque un incendio empieza pequeño, y nada de fumar ni llamas abiertas a menos de 25 pies de ciertas clases de materiales peligrosos —explosivos, inflamables, oxidantes entre ellos—. Los túneles y algunos puentes restringen o prohíben por completo las cargas con letreros; las señales publicadas mandan, y las marcas de materiales peligrosos en STONEMILES son ayudas de planificación para avisarte temprano, no un permiso para rodar.",
      },
      {
        titleEn: "When something leaks",
        titleEs: "Cuando algo se fuga",
        bodyEn: "If you find a leak or a fire starts: get the truck stopped in the safest reachable place, set the brakes, kill the engine, and keep people away — stay upwind and uphill of the material. Do NOT try to identify an unknown substance by getting close; the placard, the shipping paper, and the Emergency Response Guidebook (ERG) tell responders what it is from a distance. Call 911 and your company's emergency number, give the ID number and class from the paperwork, and let trained responders work. Your job in the first minutes is distance, information, and keeping the scene from growing.",
        bodyEs: "Si encuentras una fuga o empieza un incendio: detén el camión en el lugar seguro más cercano, pon los frenos, apaga el motor y mantén alejada a la gente: quédate contra el viento y en terreno más alto que el material. NO trates de identificar una sustancia desconocida acercándote; el letrero, el documento de embarque y la Guía de Respuesta a Emergencias (ERG) les dicen a los respondedores qué es, desde la distancia. Llama al 911 y al número de emergencia de tu empresa, da el número de identificación y la clase de los documentos, y deja trabajar a los respondedores entrenados. Tu trabajo en los primeros minutos es distancia, información y evitar que la escena crezca.",
      },
    ],
    quiz: [
      {
        qEn: "Hazmat shipping papers must ride…",
        qEs: "Los documentos de embarque de materiales peligrosos deben viajar…",
        optsEn: ["In the trailer with the freight", "At the home office", "Within the driver's immediate reach — door pocket or seat — while at the controls", "Wherever they fit"],
        optsEs: ["En el remolque con la carga", "En la oficina principal", "Al alcance inmediato del conductor —bolsillo de la puerta o asiento— mientras está a los controles", "Donde quepan"],
      },
      {
        qEn: "Placards must be…",
        qEs: "Los letreros deben ser…",
        optsEn: ["On the rear door only", "Readable from all four sides and match the load actually carried", "Optional when the load is small", "Whatever the shipper had in stock"],
        optsEs: ["Solo en la puerta trasera", "Legibles desde los cuatro lados y coincidir con la carga realmente transportada", "Opcionales cuando la carga es pequeña", "Los que el embarcador tuviera disponibles"],
      },
      {
        qEn: "Smoking and open flames are prohibited within ___ of placarded explosives, flammables, and oxidizers.",
        qEs: "Fumar y las llamas abiertas están prohibidos a menos de ___ de explosivos, inflamables y oxidantes con letreros.",
        optsEn: ["5 feet", "10 feet", "25 feet", "100 yards"],
        optsEs: ["5 pies", "10 pies", "25 pies", "100 yardas"],
      },
      {
        qEn: "You discover a hazmat leak at a stop. Your FIRST moves are…",
        qEs: "Descubres una fuga de material peligroso en una parada. Tus PRIMEROS pasos son…",
        optsEn: ["Get close and smell it to identify it", "Stop safely, keep people away, stay upwind, and call 911 and your company with the ID number from the papers", "Drive it to the nearest shop", "Cover it with a tarp and finish the run"],
        optsEs: ["Acercarte y olerlo para identificarlo", "Detenerte con seguridad, mantener alejada a la gente, quedarte contra el viento y llamar al 911 y a tu empresa con el número de identificación de los documentos", "Llevarlo al taller más cercano", "Cubrirlo con una lona y terminar el viaje"],
      },
      {
        qEn: "The hazmat flags and notes in STONEMILES are…",
        qEs: "Las marcas y notas de materiales peligrosos en STONEMILES son…",
        optsEn: ["Legal permission to use restricted routes", "A replacement for the hazmat endorsement", "Planning aids that warn you early — posted signs and the official rules always rule", "Only decoration"],
        optsEs: ["Un permiso legal para usar rutas restringidas", "Un reemplazo de la certificación de materiales peligrosos", "Ayudas de planificación que te avisan temprano: las señales publicadas y las reglas oficiales siempre mandan", "Solo decoración"],
      },
    ],
  },
);

// ---------- Shared copy -------------------------------------------------------

export const ACADEMY_HONESTY_EN =
  "These are STONEMILES training-completion records — real documentation a fleet can file, showing what a driver studied, when, and the quiz score they passed with. They are NOT an accredited third-party certification, and the app never calls them one.";
export const ACADEMY_HONESTY_ES =
  "Estos son registros de finalización de capacitación de STONEMILES: documentación real que una flota puede archivar, que muestra qué estudió un conductor, cuándo y con qué puntaje aprobó el examen. NO son una certificación acreditada de terceros, y la aplicación nunca los llama así.";

const SAFETY_RULE_EN =
  "How training counts into your Safety score (no hidden math): Safety starts at 100. Each overspeed event in the last 7 days costs −3. Each CORE course (Defensive Driving, Hours of Service, Pre-Trip & DVIR) left due this season costs −5. Passing a core course's refresher removes its −5. Nothing else about training moves the score.";
const SAFETY_RULE_ES =
  "Cómo cuenta la capacitación en tu puntaje de Seguridad (sin matemáticas ocultas): Seguridad empieza en 100. Cada evento de exceso de velocidad en los últimos 7 días cuesta −3. Cada curso PRINCIPAL (Manejo defensivo, Horas de servicio, Inspección previa y DVIR) que quede pendiente esta temporada cuesta −5. Aprobar el repaso de un curso principal elimina su −5. Nada más sobre la capacitación mueve el puntaje.";

function courseTitle(c: Course, lang: Lang): string {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.title[o] ?? c.titleEn;
  return lang === "es" ? c.titleEs : c.titleEn;
}
function courseBlurb(c: Course, lang: Lang): string {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.blurb[o] ?? c.blurbEn;
  return lang === "es" ? c.blurbEs : c.blurbEn;
}
function lessonTitle(c: Course, li: number, l: Lesson, lang: Lang): string {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.lessons[li]?.title[o] ?? l.titleEn;
  return lang === "es" ? l.titleEs : l.titleEn;
}
function lessonBody(c: Course, li: number, l: Lesson, lang: Lang): string {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.lessons[li]?.body[o] ?? l.bodyEn;
  return lang === "es" ? l.bodyEs : l.bodyEn;
}
function quizQ(c: Course, qi: number, q: QuizQ, lang: Lang): string {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.quiz[qi]?.q[o] ?? q.qEn;
  return lang === "es" ? q.qEs : q.qEn;
}
function quizOpts(c: Course, qi: number, q: QuizQ, lang: Lang): string[] {
  const o = academyOverlayLang(lang);
  if (o) return ACADEMY_I18N[c.id]?.quiz[qi]?.opts[o] ?? q.optsEn;
  return lang === "es" ? q.optsEs : q.optsEn;
}
function courseById(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

type AcademyT = ApiResponse<typeof api, "getSafetyAcademy">;
type CourseStatusT = AcademyT["courses"][number];

// ---------- Driver-facing Academy hub -----------------------------------------

export function SafetyAcademyPanel({
  setBanner,
  onOpenPlans,
  language,
}: {
  setBanner: Banner;
  onOpenPlans?: () => void;
  language: Lang;
}) {
  const es = language === "es";
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["safety-academy"], queryFn: () => api.getSafetyAcademy({}) });
  const acad = q.data;
  const [openId, setOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<number[]>([-1, -1, -1, -1, -1]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResponse<typeof api, "submitTrainingQuiz"> | null>(null);

  const openCourse = (id: string) => {
    setOpenId(openId === id ? null : id);
    setAnswers([-1, -1, -1, -1, -1]);
    setShowQuiz(false);
    setResult(null);
  };

  const statusChip = (s: CourseStatusT) => {
    if (s.status === "current")
      return <span className="rounded-full bg-emerald-900/60 px-2.5 py-1 text-[10px] font-bold text-emerald-300">{es ? "✅ AL DÍA" : "✅ CURRENT"}</span>;
    if (s.status === "due")
      return <span className="rounded-full bg-amber-900/60 px-2.5 py-1 text-[10px] font-bold text-amber-200">{es ? "⏳ PENDIENTE" : "⏳ DUE"}</span>;
    return <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold text-[var(--dim)]">{es ? "SIN EMPEZAR" : "NOT STARTED"}</span>;
  };

  const recordText = (): string | null => {
    if (!acad || acad.completions.length === 0) return null;
    const lines = [
      "SAFETY TRAINING RECORD — STONEMILES",
      es ? ACADEMY_HONESTY_ES : ACADEMY_HONESTY_EN,
      "",
      ...acad.completions.map((c) => {
        const course = courseById(c.courseId);
        return `${course ? courseTitle(course, language) : c.courseId} — ${es ? "aprobado" : "passed"} ${new Date(c.completedAt).toLocaleString()} · ${es ? "puntaje" : "score"} ${c.scorePct}% · ${es ? "temporada" : "season"} ${c.seasonNumber} · ${es ? "sello" : "seal"} ${c.chainHash ?? "—"}`;
      }),
    ];
    return lines.join("\n");
  };

  return (
    <div id="safety-academy">
      <Section title={es ? "🎓 Academia de Seguridad — capacitación que se sella en tu registro" : "🎓 Safety Academy — training that seals into your record"} ariaLabel="Safety Academy" defaultOpen={false}>
        <p className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed">
          <strong>{es ? "Honestidad primero: " : "Honesty first: "}</strong>
          {es ? ACADEMY_HONESTY_ES : ACADEMY_HONESTY_EN}
        </p>
        {q.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">{es ? "Cargando la academia…" : "Loading the Academy…"}</p>}
        {q.isError && (
          <p className="mt-2 text-sm font-semibold text-[var(--danger)]">
            {es ? "No se pudo cargar la Academia — nada cambió. Reabre el panel para reintentar." : "Couldn't load the Academy — nothing was changed. Reopen this panel to retry."}
          </p>
        )}

        {acad && !acad.premium && (
          <div className="mt-3 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface)] p-3.5" aria-label={es ? "Academia de Seguridad bloqueada — función premium" : "Safety Academy locked — premium feature"}>
            <p className="text-base font-semibold">
              🔒 {es
                ? "La Academia de Seguridad viene con Diamond Driver y Owner (los conductores Owner tienen Diamond incluido). Tu plan registrado no es Diamond — el catálogo está abajo; las lecciones, exámenes y registros sellados se abren al mejorar a Diamond."
                : "The Safety Academy comes with Diamond Driver and Owner plans (Owner drivers get Diamond included). Your recorded plan isn't Diamond — the catalog is below; lessons, quizzes, and sealed records unlock when you upgrade to Diamond."}
            </p>
            <ul className="mt-2 space-y-1.5">
              {COURSES.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                  <span className="font-bold">{c.icon} {courseTitle(c, language)}{c.core ? <span className="ml-1.5 text-[10px] font-bold text-amber-300">{es ? "PRINCIPAL" : "CORE"}</span> : null}</span>
                  <span aria-hidden>🔒</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
              {es
                ? `Cada curso: lecciones cortas y un examen de 5 preguntas; se aprueba con ${PASSING_PCT}% o más. Cada aprobación se sella en tu registro y cuenta en tu Pasaporte de Reputación.`
                : `Every course: short lessons plus a 5-question quiz, passed at ${PASSING_PCT}% or better. Every pass seals into your record and counts on your Reputation Passport.`}
            </p>
            {onOpenPlans && (
              <button
                type="button"
                className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold"
                aria-label={es ? "Abrir Planes para mejorar y desbloquear la Academia de Seguridad" : "Open Plans to upgrade for the Safety Academy"}
                onClick={onOpenPlans}
              >
                {es ? "Mejorar a Full u Owner →" : "Upgrade to Full or Owner →"}
              </button>
            )}
          </div>
        )}

        {acad && acad.premium && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center" aria-label={es ? "Tu progreso de capacitación" : "Your training progress"}>
              <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
                <div className="font-condensed text-2xl font-bold">{acad.totals.completedEver}/{COURSES.length}</div>
                <div className="text-[11px] text-[var(--dim)]">{es ? "cursos aprobados" : "courses passed"}</div>
              </div>
              <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
                <div className="font-condensed text-2xl font-bold text-emerald-300">{acad.totals.current}</div>
                <div className="text-[11px] text-[var(--dim)]">{es ? "al día" : "current"}</div>
              </div>
              <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
                <div className={`font-condensed text-2xl font-bold ${acad.totals.due > 0 ? "text-amber-200" : ""}`}>{acad.totals.due}</div>
                <div className="text-[11px] text-[var(--dim)]">{es ? "pendientes" : "due"}</div>
              </div>
            </div>
            <p className="mt-2 text-sm text-[var(--dim)]">
              🏁 {es
                ? <>Temporada {acad.season.number} — termina en {acad.season.daysLeft} día{acad.season.daysLeft === 1 ? "" : "s"}. Cada temporada nueva, los tres cursos PRINCIPALES vuelven a estar pendientes como repasos. Tu historial nunca se borra: se archiva.</>
                : <>Season {acad.season.number} — ends in {acad.season.daysLeft} day{acad.season.daysLeft === 1 ? "" : "s"}. Each new season, the three CORE courses come due again as refreshers. Your history is never deleted — it is archived.</>}
            </p>
            <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]">
              📊 {es ? SAFETY_RULE_ES : SAFETY_RULE_EN}
            </p>

            <CompanyVideosSection setBanner={setBanner} language={language} />

            <ul className="mt-3 space-y-2" aria-label={es ? "Catálogo de cursos" : "Course catalog"}>
              {COURSES.map((c) => {
                const st = acad.courses.find((x) => x.courseId === c.id);
                if (!st) return null;
                const open = openId === c.id;
                return (
                  <li key={c.id} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface)]">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
                      aria-label={`${open ? (es ? "Cerrar" : "Close") : (es ? "Abrir" : "Open")} ${courseTitle(c, language)}`}
                      aria-expanded={open}
                      onClick={() => openCourse(c.id)}
                    >
                      <span className="min-w-0">
                        <span className="block text-base font-bold">
                          {c.icon} {courseTitle(c, language)}
                          {c.core && <span className="ml-1.5 rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-200">{es ? "PRINCIPAL · REPASO CADA TEMPORADA" : "CORE · REFRESHER EVERY SEASON"}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--dim)]">
                          {st.lastCompletedAt
                            ? `${es ? "Última aprobación" : "Last passed"} ${new Date(st.lastCompletedAt).toLocaleDateString()}${st.bestScorePct != null ? ` · ${es ? "mejor" : "best"} ${st.bestScorePct}%` : ""}`
                            : es ? "Aún sin aprobar" : "Not passed yet"}
                          {st.attempts > 0 ? ` · ${st.attempts} ${es ? "intento(s)" : "attempt(s)"}` : ""}
                        </span>
                      </span>
                      {statusChip(st)}
                    </button>
                    {open && (
                      <div className="border-t border-[var(--border)] px-3.5 py-3">
                        <p className="text-base leading-relaxed text-[var(--dim)]">{courseBlurb(c, language)}</p>
                        {academyOverlayLang(language) && (
                          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">{tt(language, "govern.note")}</p>
                        )}
                        <div className="mt-3 space-y-4">
                          {c.lessons.map((l, li) => (
                            <article key={li} aria-label={`${es ? "Lección" : "Lesson"} ${li + 1}: ${lessonTitle(c, li, l, language)}`}>
                              <h3 className="font-condensed text-xl font-bold">{es ? `Lección ${li + 1} — ` : `Lesson ${li + 1} — `}{lessonTitle(c, li, l, language)}</h3>
                              <p className="mt-1 text-base leading-relaxed">{lessonBody(c, li, l, language)}</p>
                              {academyOverlayLang(language) && (
                                <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">English: {l.bodyEn}</p>
                              )}
                            </article>
                          ))}
                        </div>
                        <CourseVideos courseId={c.id} setBanner={setBanner} language={language} />
                        {!showQuiz && !result && (
                          <button
                            type="button"
                            className="btn-neon btn-press mt-4 w-full rounded-xl py-3 font-bold"
                            aria-label={`${es ? "Empezar el examen de" : "Start the quiz for"} ${courseTitle(c, language)}`}
                            onClick={() => setShowQuiz(true)}
                          >
                            {es ? `📝 Hacer el examen — 5 preguntas, se aprueba con ${PASSING_PCT}%` : `📝 Take the quiz — 5 questions, pass at ${PASSING_PCT}%`}
                          </button>
                        )}
                        {(showQuiz || result) && (
                          <div className="mt-4 border-t border-[var(--border)] pt-3" aria-label={`${es ? "Examen de" : "Quiz for"} ${courseTitle(c, language)}`}>
                            <h3 className="font-condensed text-xl font-bold">{es ? "Examen" : "Quiz"} — {courseTitle(c, language)}</h3>
                            <p className="text-xs text-[var(--dim)]">
                              {es
                                ? `Se aprueba con ${PASSING_PCT}% o más (4 de 5). Cada intento queda registrado, apruebes o no. Si no apruebas, vuelve a leer las lecciones y reinténtalo.`
                                : `Passing is ${PASSING_PCT}% or better (4 of 5). Every attempt is recorded, pass or fail. If you don't pass, re-read the lessons and retake it.`}
                            </p>
                            <div className="mt-3 space-y-4">
                              {c.quiz.map((qq, qi) => (
                                <fieldset key={qi} disabled={result != null}>
                                  <legend className="text-base font-bold">{qi + 1}. {quizQ(c, qi, qq, language)}</legend>
                                  {academyOverlayLang(language) && (
                                    <p className="mt-0.5 text-xs font-normal text-[var(--dim)]">English: {qq.qEn}</p>
                                  )}
                                  <div className="mt-1.5 space-y-1.5" role="radiogroup" aria-label={`${es ? "Pregunta" : "Question"} ${qi + 1}`}>
                                    {quizOpts(c, qi, qq, language).map((opt, oi) => (
                                      <label key={oi} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-base ${answers[qi] === oi ? "border-[var(--accent)] bg-[var(--surface2)]" : "border-[var(--border)] bg-[var(--surface2)] opacity-90"}`}>
                                        <input
                                          type="radio"
                                          name={`quiz-${c.id}-${qi}`}
                                          className="mt-1 h-5 w-5 shrink-0"
                                          checked={answers[qi] === oi}
                                          aria-label={`${es ? "Pregunta" : "Question"} ${qi + 1}, ${es ? "opción" : "option"} ${oi + 1}: ${opt}`}
                                          onChange={() => setAnswers(answers.map((a, j) => (j === qi ? oi : a)))}
                                        />
                                        <span>{opt}</span>
                                      </label>
                                    ))}
                                  </div>
                                </fieldset>
                              ))}
                            </div>
                            {!result && (
                              <button
                                type="button"
                                disabled={busy || answers.some((a) => a < 0)}
                                className="btn-neon btn-press mt-4 w-full rounded-xl py-3 font-bold disabled:opacity-50"
                                aria-label={`${es ? "Enviar el examen de" : "Submit the quiz for"} ${courseTitle(c, language)}`}
                                onClick={() => {
                                  setBusy(true);
                                  void api
                                    .submitTrainingQuiz({ courseId: c.id, answers })
                                    .then((r) => {
                                      setResult(r);
                                      if (r.ok && r.passed) {
                                        setBanner(es ? `🎓 ¡Aprobado y sellado! ${courseTitle(c, language)} — ${r.scorePct}%. Está en tu registro y en tu Pasaporte.` : `🎓 Passed & sealed! ${courseTitle(c, language)} — ${r.scorePct}%. It is on your record and your Passport.`);
                                        void queryClient.invalidateQueries({ queryKey: ["safety-academy"] });
                                        void queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
                                        void queryClient.invalidateQueries({ queryKey: ["passport"] });
                                        void queryClient.invalidateQueries({ queryKey: ["fleet-training"] });
                                      } else if (r.ok) {
                                        setBanner(es ? `Examen registrado: ${r.scorePct}% — se necesitaba ${PASSING_PCT}%. Vuelve a leer las lecciones y reinténtalo.` : `Attempt recorded: ${r.scorePct}% — ${PASSING_PCT}% needed. Re-read the lessons and retake it.`);
                                        void queryClient.invalidateQueries({ queryKey: ["safety-academy"] });
                                      } else {
                                        setBanner(r.error ?? (es ? "No se pudo calificar el examen." : "Couldn't grade that quiz."));
                                      }
                                    })
                                    .catch(() => setBanner(es ? "No se pudo calificar el examen — inténtalo de nuevo." : "Couldn't grade that quiz — try again."))
                                    .finally(() => setBusy(false));
                                }}
                              >
                                {busy ? (es ? "Calificando…" : "Grading…") : answers.some((a) => a < 0) ? (es ? "Responde las 5 preguntas" : "Answer all 5 questions") : (es ? "Enviar examen" : "Submit quiz")}
                              </button>
                            )}
                            {result && result.ok && (
                              <div className={`mt-4 rounded-2xl border px-3.5 py-3 ${result.passed ? "border-emerald-500/50 bg-emerald-900/30" : "border-amber-500/50 bg-amber-900/30"}`} role="status" aria-label={es ? "Resultado del examen" : "Quiz result"}>
                                <div className="font-condensed text-2xl font-bold">
                                  {result.passed ? (es ? `✅ APROBADO — ${result.scorePct}%` : `✅ PASSED — ${result.scorePct}%`) : (es ? `❌ NO APROBADO — ${result.scorePct}%` : `❌ NOT PASSED — ${result.scorePct}%`)}
                                </div>
                                <p className="mt-1 text-sm">
                                  {result.passed
                                    ? result.alreadyCompleted
                                      ? es
                                        ? "Ya tenías este curso al día en esta temporada — el intento quedó registrado; tu aprobación sellada original sigue en pie."
                                        : "You already had this course current this season — the attempt was recorded; your original sealed completion stands."
                                      : es
                                        ? `Aprobación sellada en tu registro (sello ${result.sealedHash ? result.sealedHash.slice(0, 12) : "—"}…). Cuenta en tu Pasaporte de Reputación y en el tablero de capacitación de tu propietario.`
                                        : `Completion sealed into your record (seal ${result.sealedHash ? result.sealedHash.slice(0, 12) : "—"}…). It counts on your Reputation Passport and your owner's training board.`
                                    : es
                                      ? `Acertaste ${result.correct} de ${result.total}. El intento quedó registrado — sin aprobación y sin sello. Vuelve a leer las lecciones de arriba y haz el examen otra vez.`
                                      : `You got ${result.correct} of ${result.total}. The attempt is recorded — no completion, no seal. Re-read the lessons above and take the quiz again.`}
                                </p>
                                {!result.passed && (
                                  <button
                                    type="button"
                                    className="btn-press mt-3 w-full rounded-xl bg-[var(--surface2)] border border-[var(--border)] py-3 font-bold"
                                    aria-label={es ? "Volver a las lecciones y reintentar el examen" : "Back to the lessons to retake the quiz"}
                                    onClick={() => { setResult(null); setShowQuiz(false); setAnswers([-1, -1, -1, -1, -1]); }}
                                  >
                                    {es ? "↩ Volver a las lecciones" : "↩ Back to the lessons"}
                                  </button>
                                )}
                              </div>
                            )}
                            {result && !result.ok && (
                              <p className="mt-3 rounded-xl bg-red-900/40 px-3 py-2.5 text-sm font-semibold text-red-200" role="alert">{result.error}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <h3 className="font-condensed text-lg font-bold">{es ? "🧾 Tus finalizaciones selladas" : "🧾 Your sealed completions"}</h3>
              {acad.completions.length === 0 && (
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {es
                    ? "Todavía ninguna — esta lista empieza vacía para todos. Aprueba el examen de un curso y tu finalización sellada aparece aquí, en tu perfil y en tu Pasaporte."
                    : "None yet — this list starts empty for everyone. Pass a course quiz and your sealed completion appears here, on your profile, and on your Passport."}
                </p>
              )}
              <ul className="mt-1.5 space-y-1.5">
                {acad.completions.map((comp) => {
                  const course = courseById(comp.courseId);
                  return (
                    <li key={comp.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                      <span className="font-bold">{course ? `${course.icon} ${courseTitle(course, language)}` : comp.courseId}</span>
                      <span className="block text-xs text-[var(--dim)]">
                        {new Date(comp.completedAt).toLocaleString()} · {es ? "puntaje" : "score"} {comp.scorePct}% · {es ? "temporada" : "season"} {comp.seasonNumber}
                        {comp.chainHash ? ` · ${es ? "sello" : "seal"} ${comp.chainHash.slice(0, 12)}…` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <XBar
                label={es ? "Registro de capacitación de seguridad" : "Safety training record"}
                filename="stonemiles-safety-training-record.txt"
                setBanner={setBanner}
                resolve={() => recordText()}
              />
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

// ---------- Owner-facing fleet training board ----------------------------------

type BoardT = ApiResponse<typeof api, "getFleetTrainingBoard">;

export function FleetTrainingBoard({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["fleet-training"], queryFn: () => api.getFleetTrainingBoard({}) });
  const board: BoardT | undefined = q.data;
  const [openUser, setOpenUser] = useState<string | null>(null);
  // Owner video upload form state.
  const [upTitle, setUpTitle] = useState("");
  const [upDesc, setUpDesc] = useState("");
  const [upCourseId, setUpCourseId] = useState("");
  const [upOrder, setUpOrder] = useState("0");
  const [upCheckKind, setUpCheckKind] = useState<"none" | "quiz" | "custom">("none");
  const [upQuizCourseId, setUpQuizCourseId] = useState("defensive-driving");
  const [upQ, setUpQ] = useState("");
  const [upOpts, setUpOpts] = useState<string[]>(["", "", "", ""]);
  const [upCorrect, setUpCorrect] = useState(0);
  const [upBusy, setUpBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  if (!board || !board.isOwnerView) return null;
  const invalidateBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ["fleet-training"] });
    void queryClient.invalidateQueries({ queryKey: ["training-media"] });
  };
  const onUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!upTitle.trim()) { setBanner("Give the video a title first — the title is what your drivers see in the Academy."); return; }
    const mime = videoMimeFor(file);
    if (!mime) { setBanner(`"${file.name}" isn't a supported web video format here. Upload MP4, WebM, MOV (QuickTime), or M4V. Nothing was uploaded.`); return; }
    if (file.size > VIDEO_MAX_BYTES) { setBanner(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — this web build's limit is 50 MB per video. Nothing was uploaded.`); return; }
    if (upCheckKind === "custom" && (!upQ.trim() || upOpts.some((o) => !o.trim()))) { setBanner("Finish the custom check first: one question and all four options."); return; }
    setUpBusy(true);
    try {
      const enc = await fileToBase64(file);
      const r = await api.uploadTrainingVideo({
        title: upTitle.trim(),
        description: upDesc.trim() || null,
        courseId: upCourseId || null,
        sortOrder: parseInt(upOrder || "0", 10) || 0,
        quizCourseId: upCheckKind === "quiz" ? upQuizCourseId : null,
        customCheck: upCheckKind === "custom" ? { question: upQ.trim(), options: upOpts.map((o) => o.trim()), correctIndex: upCorrect } : null,
        mime,
        dataBase64: enc.dataBase64,
      });
      if (r.ok) {
        setBanner(`🎬 Video uploaded: "${upTitle.trim()}" — visible to your company's members only, in the Academy${upCourseId ? " inside its course" : " as a company lesson"}.`);
        setUpTitle("");
        setUpDesc("");
        invalidateBoard();
      } else {
        setBanner(r.error ?? "Upload failed — nothing was saved.");
      }
    } catch {
      setBanner("Couldn't read that file — the upload didn't happen. Try again.");
    } finally {
      setUpBusy(false);
    }
  };
  const onReplaceFile = (mediaId: number, title: string) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mime = videoMimeFor(file);
    if (!mime) { setBanner(`"${file.name}" isn't a supported web video format here (MP4, WebM, MOV, M4V). The original video is unchanged.`); return; }
    if (file.size > VIDEO_MAX_BYTES) { setBanner(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — over this web build's 50 MB per-video limit. The original video is unchanged.`); return; }
    try {
      const enc = await fileToBase64(file);
      const r = await api.replaceTrainingVideo({ mediaId, mime, dataBase64: enc.dataBase64 });
      setBanner(r.ok ? `🎬 "${title}" replaced with the new file. Watch progress and sealed completions are untouched.` : (r.error ?? "Couldn't replace that video."));
      if (r.ok) invalidateBoard();
    } catch {
      setBanner("Couldn't read that file — the original video is unchanged.");
    }
  };
  const chip = (status: string) =>
    status === "current" ? (
      <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300">CURRENT</span>
    ) : status === "due" ? (
      <span className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-200">DUE</span>
    ) : (
      <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--dim)]">NOT STARTED</span>
    );
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3" aria-label="Fleet training board">
      <h3 className="font-condensed text-xl font-bold">🎓 Fleet training board — Safety Academy</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Per driver: courses completed, what is current vs due, and the last completion date — from sealed
        training records only. Season {board.season.number} ends in {board.season.daysLeft} day
        {board.season.daysLeft === 1 ? "" : "s"}; the three CORE courses (Defensive Driving, Hours of Service,
        Pre-Trip &amp; DVIR) come due again as refreshers every season. {ACADEMY_HONESTY_EN}
      </p>
      <ul className="mt-2 space-y-1.5">
        {board.rows.map((r) => (
          <li key={r.username} className="rounded-xl bg-[var(--surface)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-bold">
                @{r.username} <span className="text-xs font-normal text-[var(--dim)]">· {r.role}{r.isMe ? " · you" : ""}</span>
              </span>
              {r.dataAvailable ? (
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold"
                  aria-label={`View course detail for ${r.username}`}
                  aria-expanded={openUser === r.username}
                  onClick={() => {
                    const next = openUser === r.username ? null : r.username;
                    setOpenUser(next);
                    if (next && !r.isMe) {
                      void api
                        .logPortalAccess({ viewerUsername: board.me, targetUsername: r.username, what: "training board (Safety Academy)" })
                        .then(() => queryClient.invalidateQueries({ queryKey: ["portal-access"] }))
                        .catch(() => undefined);
                      // Security Pack 2: sealed access audit entry too.
                      void api
                        .logRecordAccess({ targetUsername: r.username, what: "training records (Safety Academy fleet board)", kind: "view" })
                        .then(() => queryClient.invalidateQueries({ queryKey: ["my-access-log"] }))
                        .catch(() => undefined);
                    }
                  }}
                >
                  {openUser === r.username ? "Close" : "Courses"}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-[var(--dim)]">syncs at release</span>
              )}
            </div>
            {r.dataAvailable ? (
              <>
                <p className="mt-1 text-xs text-[var(--dim)]">
                  <strong className="text-[var(--text)]">{r.completedCount}/{COURSES.length} completed</strong> ·{" "}
                  {r.currentCount} current · {r.dueCount} due · last completion{" "}
                  {r.lastCompletionAt ? new Date(r.lastCompletionAt).toLocaleDateString() : "none yet"}
                </p>
                {openUser === r.username && (
                  <ul className="mt-2 space-y-1">
                    {r.courses.map((cc) => {
                      const course = courseById(cc.courseId);
                      return (
                        <li key={cc.courseId} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface2)] px-2.5 py-1.5 text-xs">
                          <span className="min-w-0">
                            <span className="font-bold">{course ? `${course.icon} ${course.titleEn}` : cc.courseId}</span>
                            {course?.core ? <span className="ml-1 font-bold text-amber-300">CORE</span> : null}
                            <span className="block text-[var(--dim)]">
                              {cc.lastCompletedAt ? `Last passed ${new Date(cc.lastCompletedAt).toLocaleDateString()}` : "Never passed"}
                            </span>
                          </span>
                          {chip(cc.status)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-[var(--dim)]">
                This driver's sealed training records live on their device in this staging build and sync here
                at release — nothing about their progress is estimated or filled in.
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <h4 className="font-condensed text-lg font-bold">🎬 Company training videos — owner uploads</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
          Videos are <strong className="text-[var(--text)]">company-only</strong>: visible solely to your company's
          members, never public, never shared with another company, stored in the company vault.{" "}
          <strong className="text-[var(--text)]">This web build's real limit: 50 MB per video — MP4, WebM, MOV
          (QuickTime), or M4V.</strong> A file over the limit or in another format is refused with the reason —
          never silently dropped, never half-saved. A driver completes a video by watching 90% plus passing any
          check you attach; the completion seals into their training record labelled “owner-uploaded.”
        </p>
        {board.canUpload ? (
          <div className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-3" aria-label="Upload a training video">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Upload a training video</div>
            <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-title">Title (drivers see this)</label>
            <input id="up-title" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upTitle} aria-label="Training video title" placeholder="e.g. Yard safety walk-through" onChange={(e) => setUpTitle(e.target.value)} />
            <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-desc">Short description (optional)</label>
            <input id="up-desc" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upDesc} aria-label="Training video description" placeholder="What this video teaches" onChange={(e) => setUpDesc(e.target.value)} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-place">Placement</label>
                <select id="up-place" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upCourseId} aria-label="Where this video lesson lives" onChange={(e) => setUpCourseId(e.target.value)}>
                  <option value="">Standalone company lesson</option>
                  {COURSES.map((c) => (
                    <option key={c.id} value={c.id}>Lesson inside: {c.titleEn}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-order">Order (lower shows first)</label>
                <input id="up-order" type="number" min={0} max={999} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upOrder} aria-label="Video lesson order" onChange={(e) => setUpOrder(e.target.value)} />
              </div>
            </div>
            <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-check">Completion check (optional)</label>
            <select id="up-check" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upCheckKind} aria-label="Attach a completion check" onChange={(e) => setUpCheckKind(e.target.value as "none" | "quiz" | "custom")}>
              <option value="none">None — watching 90% completes it</option>
              <option value="quiz">Attach an Academy quiz</option>
              <option value="custom">Write one custom check question</option>
            </select>
            {upCheckKind === "quiz" && (
              <select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upQuizCourseId} aria-label="Which Academy quiz to attach" onChange={(e) => setUpQuizCourseId(e.target.value)}>
                {COURSES.map((c) => (
                  <option key={c.id} value={c.id}>{c.titleEn} quiz (pass at {PASSING_PCT}%)</option>
                ))}
              </select>
            )}
            {upCheckKind === "custom" && (
              <div className="mt-2 space-y-1.5">
                <input className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upQ} aria-label="Custom check question" placeholder="Your check question" onChange={(e) => setUpQ(e.target.value)} />
                {upOpts.map((o, i) => (
                  <input key={i} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={o} aria-label={`Custom check option ${i + 1}`} placeholder={`Option ${i + 1}`} onChange={(e) => setUpOpts(upOpts.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor="up-correct">Correct option</label>
                <select id="up-correct" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm" value={upCorrect} aria-label="Which custom check option is correct" onChange={(e) => setUpCorrect(parseInt(e.target.value, 10))}>
                  {[0, 1, 2, 3].map((i) => (
                    <option key={i} value={i}>Option {i + 1}</option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--dim)]">Drivers see the question and options — never which one is correct. The key stays on the server.</p>
              </div>
            )}
            <label className="btn-neon btn-press mt-3 block w-full cursor-pointer rounded-xl py-3 text-center font-bold">
              {upBusy ? "Uploading…" : "🎬 Choose video file & upload (max 50 MB)"}
              <input type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.m4v" className="hidden" aria-label="Choose a training video file to upload" disabled={upBusy} onChange={(e) => void onUploadFile(e)} />
            </label>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--dim)]">
            Only the company owner (fleet admin) can upload, replace, or remove videos.
            {!board.rows.some((r) => r.role === "owner") && " Uploads appear here once your company exists — videos are company-only."}
          </p>
        )}
        <div className="mt-2 space-y-2">
          {board.media.length === 0 && <p className="text-sm text-[var(--dim)]">No videos uploaded yet — this board starts empty.</p>}
          {board.media.map((m) => {
            const done = m.watchers.filter((w) => w.status === "completed");
            const going = m.watchers.filter((w) => w.status !== "completed");
            return (
              <div key={m.id} className="rounded-xl bg-[var(--surface)] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm font-bold">
                    🎬 {m.title}
                    {m.removed && <span className="ml-1.5 rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-bold text-red-200">REMOVED</span>}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--dim)]">
                    {m.courseId ? `Lesson in ${courseById(m.courseId)?.titleEn ?? m.courseId}` : "Company lesson"} · {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {m.removed ? (
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    Removed by @{m.uploadedBy}. Past completion records stay sealed in drivers' training records — removing a video never unseals or deletes a completion.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs">
                      ✅ <strong>Completed ({done.length}):</strong>{" "}
                      {done.length > 0 ? done.map((w) => `@${w.username}${w.completedAt ? ` (${new Date(w.completedAt).toLocaleDateString()})` : ""}`).join(", ") : "nobody yet"}
                    </p>
                    <p className="mt-0.5 text-xs">
                      ▶ <strong>Watching ({going.length}):</strong>{" "}
                      {going.length > 0 ? going.map((w) => `@${w.username} · ${w.progressPct}%`).join(", ") : "nobody in progress"}
                    </p>
                    <p className="mt-0.5 text-xs">
                      ⏳ <strong>Not started:</strong> {m.notStarted.length > 0 ? m.notStarted.map((n) => `@${n}`).join(", ") : "every member has started"}
                    </p>
                    {board.canUpload && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="btn-press cursor-pointer rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-1.5 text-xs font-bold">
                          Replace video
                          <input type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.m4v" className="hidden" aria-label={`Replace the video file for ${m.title}`} onChange={(e) => void onReplaceFile(m.id, m.title)(e)} />
                        </label>
                        {confirmRemoveId === m.id ? (
                          <>
                            <span className="text-xs font-semibold text-amber-200">Remove “{m.title}”? Drivers keep their sealed completion records — removal never unseals or deletes a completion.</span>
                            <button
                              type="button"
                              className="btn-press rounded-lg bg-red-900/70 px-3 py-1.5 text-xs font-bold text-red-100"
                              aria-label={`Confirm removing ${m.title}`}
                              onClick={() => {
                                void api.removeTrainingVideo({ mediaId: m.id }).then((r) => {
                                  setBanner(r.ok ? (r.note ?? "Video removed.") : (r.error ?? "Couldn't remove that video."));
                                  if (r.ok) invalidateBoard();
                                  setConfirmRemoveId(null);
                                });
                              }}
                            >
                              Yes, remove it
                            </button>
                            <button type="button" className="btn-press rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-1.5 text-xs font-bold" aria-label="Cancel removing the video" onClick={() => setConfirmRemoveId(null)}>
                              Keep it
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn-press rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-1.5 text-xs font-bold" aria-label={`Remove ${m.title}`} onClick={() => setConfirmRemoveId(m.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">{board.note}</p>
    </section>
  );
}

// ---------- Owner-uploaded company training videos ------------------------------
// Company-only: the server enforces membership on every read, URL, and
// progress report. The web build's REAL limit, stated here and enforced
// server-side: 50 MB per video, MP4 / WebM / MOV / M4V. Completion =
// watched >= 90% AND any attached check passed; the completion seals
// into the driver's training record labelled "owner-uploaded".

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"];

export function videoMimeFor(file: File): string | null {
  if (file.type && VIDEO_MIMES.includes(file.type)) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".m4v")) return "video/x-m4v";
  return null;
}

type MediaT = ApiResponse<typeof api, "listTrainingMedia">["media"][number];

export function VideoLessonCard({ media, setBanner, language }: { media: MediaT; setBanner: Banner; language: Lang }) {
  const es = language === "es";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const urlQuery = useQuery({
    queryKey: ["training-media-url", media.id],
    queryFn: () => api.getTrainingMediaUrl({ mediaId: media.id }),
    enabled: open,
  });
  const [localPct, setLocalPct] = useState(media.myProgressPct);
  const lastReportRef = useRef(media.myProgressPct);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([-1, -1, -1, -1, -1]);
  const [customChoice, setCustomChoice] = useState(-1);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<ApiResponse<typeof api, "submitTrainingVideoCheck"> | null>(null);

  const shownPct = Math.max(media.myProgressPct, localPct);
  const completed = media.myStatus === "completed";
  const quizCourse = media.quizCourseId ? courseById(media.quizCourseId) : undefined;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["training-media"] });
    void queryClient.invalidateQueries({ queryKey: ["fleet-training"] });
    void queryClient.invalidateQueries({ queryKey: ["passport"] });
  };
  const report = (pct: number) => {
    lastReportRef.current = pct;
    void api
      .reportTrainingWatch({ mediaId: media.id, progressPct: pct })
      .then((r) => {
        if (r.status === "completed") {
          setBanner(es ? `🎬 ¡Video completado y sellado! «${media.title}» — fuente: subido por el propietario.` : `🎬 Video completed & sealed! "${media.title}" — source: owner-uploaded.`);
          invalidate();
        }
      })
      .catch(() => undefined);
  };
  const onTime = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (!v.duration || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const pct = Math.min(100, Math.floor((v.currentTime / v.duration) * 100));
    setLocalPct((p) => Math.max(p, pct));
    if (pct >= lastReportRef.current + 5 || (pct >= 90 && lastReportRef.current < 90)) report(pct);
  };
  const submitCheck = (answers: number[]) => {
    setCheckBusy(true);
    void api
      .submitTrainingVideoCheck({ mediaId: media.id, answers })
      .then((r) => {
        setCheckResult(r);
        if (!r.ok) setBanner(r.error ?? "Couldn't grade that check.");
        else if (r.passed) {
          setBanner(
            r.status === "completed"
              ? es
                ? `✅ Revisión aprobada y finalización sellada — «${media.title}».`
                : `✅ Check passed and the completion is sealed — "${media.title}".`
              : es
                ? "✅ Revisión aprobada. Termina de ver el video (90%) para sellar la finalización."
                : "✅ Check passed. Finish watching (90%) to seal the completion.",
          );
          invalidate();
        } else {
          setBanner(es ? `Revisión no aprobada (${r.scorePct}%). Vuelve a ver el video e inténtalo de nuevo.` : `Check not passed (${r.scorePct}%). Re-watch the video and try again.`);
        }
      })
      .catch(() => setBanner("Couldn't grade that check — try again."))
      .finally(() => setCheckBusy(false));
  };

  return (
    <article className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface)] px-3.5 py-3" aria-label={`${es ? "Video de capacitación" : "Training video"}: ${media.title}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-base font-bold">🎬 {media.title}</h4>
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            {es ? "Subido por el propietario" : "Owner-uploaded"} · {es ? "solo la empresa" : "company only"} · {(media.sizeBytes / 1048576).toFixed(1)} MB · {new Date(media.createdAt).toLocaleDateString()}
            {media.courseId ? ` · ${es ? "lección dentro de" : "lesson inside"} ${courseById(media.courseId) ? courseTitle(courseById(media.courseId)!, language) : media.courseId}` : ` · ${es ? "lección de la empresa" : "company lesson"}`}
          </p>
        </div>
        {completed ? (
          <span className="shrink-0 rounded-full bg-emerald-900/60 px-2.5 py-1 text-[10px] font-bold text-emerald-300">{es ? "✅ COMPLETADO Y SELLADO" : "✅ COMPLETED & SEALED"}</span>
        ) : media.myStatus === "started" ? (
          <span className="shrink-0 rounded-full bg-amber-900/60 px-2.5 py-1 text-[10px] font-bold text-amber-200">{es ? `▶ EN CURSO · ${shownPct}%` : `▶ STARTED · ${shownPct}%`}</span>
        ) : (
          <span className="shrink-0 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-bold text-[var(--dim)]">{es ? "SIN EMPEZAR" : "NOT STARTED"}</span>
        )}
      </div>
      {media.description && <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{media.description}</p>}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface2)]" role="progressbar" aria-valuenow={shownPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${es ? "Progreso de visualización de" : "Watch progress for"} ${media.title}`}>
        <div className="h-full bg-[var(--accent)]" style={{ width: `${shownPct}%` }} />
      </div>
      <p className="mt-1 text-xs text-[var(--dim)]">
        {completed
          ? `${es ? "Finalización sellada" : "Completion sealed"}${media.sealedHash ? ` · ${es ? "sello" : "seal"} ${media.sealedHash.slice(0, 12)}…` : ""} · ${es ? "fuente: subido por el propietario" : "source: owner-uploaded"}`
          : es
            ? `Se completa al ver el 90%${media.needsCheck ? " y aprobar la revisión adjunta" : ""}. El progreso se guarda con honestidad: el punto más lejano alcanzado.`
            : `Completes at 90% watched${media.needsCheck ? " plus passing the attached check" : ""}. Progress is saved honestly — the furthest point you reached.`}
      </p>
      <button
        type="button"
        className="btn-press mt-2 w-full rounded-xl bg-[var(--surface2)] border border-[var(--border)] py-2.5 text-sm font-bold"
        aria-label={open ? `${es ? "Cerrar el reproductor de" : "Close the player for"} ${media.title}` : `${es ? "Ver" : "Watch"} ${media.title}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? (es ? "Cerrar reproductor" : "Close player") : es ? "▶ Ver el video" : "▶ Watch the video"}
      </button>
      {open && (
        <div className="mt-2">
          {urlQuery.isLoading && <p className="text-sm text-[var(--dim)]">{es ? "Cargando el video…" : "Loading the video…"}</p>}
          {urlQuery.data && !urlQuery.data.url && (
            <p className="rounded-xl bg-red-900/40 px-3 py-2.5 text-sm font-semibold text-red-200">
              {es ? "Este video no está disponible para tu empresa." : "This video isn't available to your company."}
            </p>
          )}
          {urlQuery.data?.url && (
            <video
              controls
              preload="metadata"
              className="w-full rounded-xl bg-black"
              src={urlQuery.data.url}
              aria-label={`${es ? "Reproductor de video" : "Video player"}: ${media.title}`}
              onTimeUpdate={onTime}
              onPause={onTime}
              onEnded={() => { setLocalPct(100); report(100); }}
            />
          )}
          {media.needsCheck && !media.myCheckPassed && (
            <div className="mt-3 border-t border-[var(--border)] pt-3" aria-label={es ? "Revisión adjunta" : "Attached check"}>
              <h5 className="font-condensed text-lg font-bold">{es ? "Revisión adjunta del propietario" : "Owner's attached check"}</h5>
              {shownPct < 90 ? (
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {es ? "Ve al menos el 90% del video para desbloquear la revisión. Aprobarla (con el video visto) sella tu finalización." : "Watch at least 90% of the video to unlock the check. Passing it (with the watch complete) seals your completion."}
                </p>
              ) : quizCourse ? (
                <div className="mt-2 space-y-3">
                  <p className="text-xs text-[var(--dim)]">{es ? `Examen de la Academia adjunto: ${courseTitle(quizCourse, language)} — se aprueba con ${PASSING_PCT}%.` : `Attached Academy quiz: ${courseTitle(quizCourse, language)} — pass at ${PASSING_PCT}%.`}</p>
                  {quizCourse.quiz.map((qq, qi) => (
                    <fieldset key={qi}>
                      <legend className="text-sm font-bold">{qi + 1}. {quizQ(quizCourse, qi, qq, language)}</legend>
                      {academyOverlayLang(language) && (
                        <p className="mt-0.5 text-xs font-normal text-[var(--dim)]">English: {qq.qEn}</p>
                      )}
                      <div className="mt-1 space-y-1" role="radiogroup" aria-label={`${es ? "Revisión, pregunta" : "Check question"} ${qi + 1}`}>
                        {quizOpts(quizCourse, qi, qq, language).map((opt, oi) => (
                          <label key={oi} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm">
                            <input type="radio" name={`video-check-${media.id}-${qi}`} className="mt-0.5 h-4 w-4 shrink-0" checked={quizAnswers[qi] === oi} aria-label={`${es ? "Pregunta" : "Question"} ${qi + 1}, ${es ? "opción" : "option"} ${oi + 1}: ${opt}`} onChange={() => setQuizAnswers(quizAnswers.map((a, j) => (j === qi ? oi : a)))} />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    disabled={checkBusy || quizAnswers.some((a) => a < 0)}
                    className="btn-neon btn-press w-full rounded-xl py-2.5 font-bold disabled:opacity-50"
                    aria-label={`${es ? "Enviar la revisión adjunta de" : "Submit the attached check for"} ${media.title}`}
                    onClick={() => submitCheck(quizAnswers)}
                  >
                    {checkBusy ? (es ? "Calificando…" : "Grading…") : es ? "Enviar revisión" : "Submit check"}
                  </button>
                </div>
              ) : media.customCheck ? (
                <div className="mt-2">
                  <p className="text-sm font-bold">{media.customCheck.question}</p>
                  <div className="mt-1.5 space-y-1" role="radiogroup" aria-label={es ? "Pregunta de revisión personalizada" : "Custom check question"}>
                    {media.customCheck.options.map((opt, oi) => (
                      <label key={oi} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm">
                        <input type="radio" name={`video-custom-${media.id}`} className="mt-0.5 h-4 w-4 shrink-0" checked={customChoice === oi} aria-label={`${es ? "Opción" : "Option"} ${oi + 1}: ${opt}`} onChange={() => setCustomChoice(oi)} />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={checkBusy || customChoice < 0}
                    className="btn-neon btn-press mt-2 w-full rounded-xl py-2.5 font-bold disabled:opacity-50"
                    aria-label={`${es ? "Enviar la revisión de" : "Submit the check for"} ${media.title}`}
                    onClick={() => submitCheck([customChoice])}
                  >
                    {checkBusy ? (es ? "Calificando…" : "Grading…") : es ? "Enviar revisión" : "Submit check"}
                  </button>
                </div>
              ) : null}
              {checkResult && checkResult.ok && !checkResult.passed && (
                <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2 text-sm font-semibold text-amber-200">
                  {es ? `No aprobado (${checkResult.scorePct}%) — el intento quedó registrado. Vuelve a ver el video e inténtalo otra vez.` : `Not passed (${checkResult.scorePct}%) — the attempt was recorded. Re-watch and try again.`}
                </p>
              )}
            </div>
          )}
          {media.needsCheck && media.myCheckPassed && !completed && (
            <p className="mt-2 text-sm font-semibold text-emerald-300">{es ? "✅ Revisión aprobada — termina de ver el video (90%) para sellar." : "✅ Check passed — finish watching (90%) to seal."}</p>
          )}
        </div>
      )}
    </article>
  );
}

export function CompanyVideosSection({ setBanner, language }: { setBanner: Banner; language: Lang }) {
  const es = language === "es";
  const q = useQuery({ queryKey: ["training-media"], queryFn: () => api.listTrainingMedia({}) });
  if (q.isLoading) return null;
  const data = q.data;
  if (!data || !data.inCompany) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">
        🎬 {es
          ? "Videos de capacitación de la empresa: las lecciones que suba el propietario de tu flota aparecen aquí — solo para miembros de la empresa, nunca públicas."
          : "Company training videos: lessons your fleet owner uploads appear here — company members only, never public."}
      </p>
    );
  }
  const standalone = data.media.filter((m) => m.courseId == null);
  const attachedCount = data.media.length - standalone.length;
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <h3 className="font-condensed text-lg font-bold">{es ? "🎬 Videos de la empresa — subidos por el propietario" : "🎬 Company videos — owner-uploaded lessons"}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        {es
          ? "Solo para miembros de tu empresa — nunca públicos, nunca compartidos con otra empresa. Ver el 90% (y aprobar la revisión adjunta, si hay) sella tu finalización en tu registro de capacitación, con la fuente «subido por el propietario»."
          : "Visible only to your company's members — never public, never shared across companies. Watching 90% (plus passing any attached check) seals the completion into your training record, labelled source “owner-uploaded.”"}
      </p>
      <div className="mt-2 space-y-2">
        {standalone.map((m) => (
          <VideoLessonCard key={m.id} media={m} setBanner={setBanner} language={language} />
        ))}
        {standalone.length === 0 && (
          <p className="text-sm text-[var(--dim)]">{es ? "Aún no hay lecciones independientes de la empresa." : "No standalone company lessons yet."}</p>
        )}
        {attachedCount > 0 && (
          <p className="text-xs text-[var(--dim)]">
            {es
              ? `Además, ${attachedCount} video(s) están adjuntos como lecciones dentro de los cursos de la Academia de abajo — ábrelos dentro de su curso.`
              : `Also: ${attachedCount} video(s) are attached as lessons inside Academy courses below — open them inside their course.`}
          </p>
        )}
      </div>
    </div>
  );
}

export function CourseVideos({ courseId, setBanner, language }: { courseId: string; setBanner: Banner; language: Lang }) {
  const q = useQuery({ queryKey: ["training-media"], queryFn: () => api.listTrainingMedia({}) });
  const mine = (q.data?.media ?? []).filter((m) => m.courseId === courseId);
  if (mine.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <h3 className="font-condensed text-lg font-bold">{language === "es" ? "🎬 Lecciones en video del propietario de tu empresa" : "🎬 Video lessons from your company owner"}</h3>
      <div className="mt-2 space-y-2">
        {mine.map((m) => (
          <VideoLessonCard key={m.id} media={m} setBanner={setBanner} language={language} />
        ))}
      </div>
    </div>
  );
}
