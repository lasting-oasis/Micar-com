// Spanish for the plain-HTML pages (US Spanish, "usted"), keyed by the English text in pages.ts and about.ts, HTML and
// {placeholders} included. Terms follow the site's own table (i18n-es.ts): intercambio, precio de etiqueta, versión,
// millaje, precios pedidos, anuncios. about.test.ts fails if a Spanish page asks for a text that is in neither table.
export const SEO_ES: Record<string, string> = {
  "Not yet: no verifier is connected":
    "Todavía no: no hay ningún verificador conectado",
  "{points} of 100":
    "{points} de 100",
  "What MiCar is":
    "Qué es MiCar",
  "MiCar (said MEE-car) treats a car as an asset with a record. You type a car and get its value; you park it in the Garage and it becomes a card with its own MiCar ID, a passport of its history and a grade; and the card's car can be driven in MiCar World, a 3D town. It is free and needs no account.":
    "MiCar (se pronuncia MI-car) trata un auto como un bien con historial. Usted escribe un auto y obtiene su valor; lo estaciona en el Garaje y se convierte en una tarjeta con su propio MiCar ID, un pasaporte de su historial y una calificación; y el auto de la tarjeta se puede manejar en MiCar World, un pueblo en 3D. Es gratis y no requiere cuenta.",
  "<strong>What is checked today: nothing.</strong> Every fact about a single car on MiCar (its mileage, condition, title, accidents, records) is what its owner states, with or without files attached. MiCar has checked no record, inspected no car and connected no inspector, shop or data provider. The grade and the levels below are built so that an owner's word alone can only go so far, and the pages say where that limit is.":
    "<strong>Qué se ha comprobado hoy: nada.</strong> Cada dato sobre un auto en MiCar (su millaje, estado, título, accidentes, registros) es lo que declara su dueño, con o sin archivos adjuntos. MiCar no ha revisado ningún registro, no ha inspeccionado ningún auto y no ha conectado a ningún inspector, taller ni proveedor de datos. La calificación y los niveles de abajo están hechos para que la sola palabra del dueño llegue hasta cierto punto, y las páginas dicen dónde está ese límite.",
  "A free calculator for {models} models from {makes} makes. It gives today's trade-in, private-party and dealer retail value, a price range, a confidence level with its reasons, the build-up line by line, and a five-year forecast. It starts from the car's original window-sticker price (MiCar holds {trims} trim prices across {years} model years) and adjusts for age, mileage, condition, title, reported accidents, region and the used-car market, and for local supply and asking prices when you give them.":
    "Una calculadora gratuita para {models} modelos de {makes} marcas. Da el valor de hoy por intercambio, en venta particular y en concesionario, un rango de precios, un nivel de confianza con sus razones, el desglose línea por línea y un pronóstico a cinco años. Parte del precio de etiqueta original del auto (MiCar tiene {trims} precios por versión en {years} años modelo) y lo ajusta por antigüedad, millaje, estado, título, accidentes reportados, región y el mercado de autos usados, y por la oferta local y los precios pedidos cuando usted los da.",
  "The values are estimates, not offers and not appraisals. For {fitted} models the resale curve is fitted to {listings} real asking prices, with an average miss of {mae}; for the others it rests on published resale figures or on the make and body style. <a href=\"{method}\">How a value is worked out, and how far off it can be</a>.":
    "Los valores son estimaciones, no ofertas ni avalúos. En {fitted} modelos la curva de reventa está ajustada a {listings} precios pedidos reales, con un error promedio de {mae}; en los demás se apoya en cifras de reventa publicadas o en la marca y la carrocería. <a href=\"{method}\">Cómo se calcula un valor y cuánto puede fallar</a>.",
  "Browse <a href=\"{cars}\">every car MiCar can value</a>, with each trim's original MSRP, the EPA's engine and drivetrain configurations and the price source.":
    "Vea <a href=\"{cars}\">todos los autos que MiCar puede valorar</a>, con el precio de etiqueta original de cada versión, las configuraciones de motor y tracción de la EPA y la fuente del precio.",
  "The Garage: one car, one record":
    "El Garaje: un auto, un historial",
  "Park a car in the Garage and it gets:":
    "Estacione un auto en el Garaje y recibe:",
  "<strong>A MiCar ID</strong>, written <code>MC-XXXX-XXXX-XXXC</code>. It is random, with a check character so a mistyped ID is refused. It is never made from the VIN, and it stays with the car when the owner changes.":
    "<strong>Un MiCar ID</strong>, escrito <code>MC-XXXX-XXXX-XXXC</code>. Es aleatorio, con un carácter de control para rechazar un ID mal escrito. Nunca se genera a partir del VIN y se queda con el auto cuando cambia de dueño.",
  "<strong>A specification sheet</strong> where every figure carries its source: the manufacturer, a government agency (the EPA's vehicle file), a named test, reference data, or the owner. A figure nobody has is left blank, never invented.":
    "<strong>Una hoja de especificaciones</strong> donde cada cifra lleva su fuente: el fabricante, una agencia del gobierno (el archivo de vehículos de la EPA), una prueba con nombre, datos de referencia o el dueño. Una cifra que nadie tiene se deja en blanco, nunca se inventa.",
  "<strong>Seven attributes</strong> scored 0 to 1000 from that specification ({attributes}) and a Power Rating, their average. Modifications and wear move them, each change shown with its evidence.":
    "<strong>Siete atributos</strong> con puntaje de 0 a 1000 a partir de esa especificación ({attributes}) y un Power Rating, su promedio. Las modificaciones y el desgaste los mueven, y cada cambio se muestra con su evidencia.",
  "<strong>A passport</strong>: a history that is only ever added to. Entries are {entries}, each with photographs, receipts or reports attached if the owner has them. It keeps an odometer log that flags a reading lower than an earlier one, and the chain of owners.":
    "<strong>Un pasaporte</strong>: un historial al que solo se le agrega. Las entradas son {entries}, cada una con fotografías, recibos o informes adjuntos si el dueño los tiene. Lleva un registro del odómetro que señala una lectura menor que una anterior, y la cadena de dueños.",
  "<strong>A grade</strong> from 1 to 10, worked out from the passport and nothing else. When the record changes, so does the grade.":
    "<strong>Una calificación</strong> de 1 a 10, calculada a partir del pasaporte y de nada más. Cuando el historial cambia, la calificación también.",
  "<strong>A collectible card</strong> with a rarity tier, a finish that follows the grade, and a numbered edition for each level the car reaches. No price is ever printed on a card, and nothing in a race changes a grade.":
    "<strong>Una tarjeta coleccionable</strong> con un nivel de rareza, un acabado que sigue a la calificación y una edición numerada por cada nivel que alcanza el auto. Nunca se imprime un precio en una tarjeta, y nada de lo que pasa en una carrera cambia una calificación.",
  "<strong>Where it is kept:</strong> in the visitor's own browser, and nowhere else. Nothing is uploaded and accounts are not open yet, so a car parked on one device is not on another, and nobody can look a car up on MiCar by its VIN or its MiCar ID. An owner can download the passport as a file and hand a car over to another Garage.":
    "<strong>Dónde se guarda:</strong> en el navegador del propio visitante y en ningún otro lugar. No se sube nada y las cuentas todavía no están abiertas, así que un auto estacionado en un dispositivo no está en otro, y nadie puede buscar un auto en MiCar por su VIN ni por su MiCar ID. El dueño puede descargar el pasaporte como archivo y traspasar un auto a otro Garaje.",
  "Open the Garage":
    "Abrir el Garaje",
  "The grade ({formula})":
    "La calificación ({formula})",
  "Five parts, each scored 0 to 100, weighted and divided by ten. The last column is the most an owner can reach alone, without an independent check.":
    "Cinco partes, cada una con puntaje de 0 a 100, ponderadas y divididas entre diez. La última columna es lo máximo que un dueño puede alcanzar solo, sin una revisión independiente.",
  "Part":
    "Parte",
  "Most an owner's own word and files can score":
    "Lo máximo que pueden sumar la palabra y los archivos del dueño",
  "So a grade earned on an owner's records alone has a ceiling, and the Verification part stays at zero until someone independent has checked something.":
    "Así, una calificación obtenida solo con los registros del dueño tiene un tope, y la parte de Verificación se queda en cero hasta que alguien independiente haya revisado algo.",
  "Evidence, and the four levels":
    "La evidencia y los cuatro niveles",
  "Every entry is one of three things: <strong>declared</strong> (the owner says so), <strong>documented</strong> (a file is attached) or <strong>verified</strong> (an independent verifier attested to it). Attaching a file moves a claim from declared to documented and no further.":
    "Cada entrada es una de tres cosas: <strong>declarada</strong> (lo dice el dueño), <strong>documentada</strong> (lleva un archivo adjunto) o <strong>verificada</strong> (un verificador independiente dio fe de ella). Adjuntar un archivo pasa una afirmación de declarada a documentada y nada más.",
  "What it means":
    "Qué significa",
  "Can a car reach it today?":
    "¿Puede un auto alcanzarlo hoy?",
  "The rules for verifiers are built and tested (who may attest, what an attestation is bound to, when it lapses, how one is withdrawn), but the list of verifiers is empty. Until that changes, no car on MiCar is Verified or Certified, and any claim that one is would be false.":
    "Las reglas para los verificadores están hechas y probadas (quién puede dar fe, a qué queda ligada una atestación, cuándo vence, cómo se retira), pero la lista de verificadores está vacía. Hasta que eso cambie, ningún auto en MiCar está Verificado ni Certificado, y cualquier afirmación de que lo está sería falsa.",
  "What others may see of a car":
    "Qué pueden ver otros de un auto",
  "The Garage shows each owner the public view of their car. It leaves out the VIN (only whether one is on file), every owner's identity, every file, note, cost and shop name. Days are blurred to months and mileage is rounded down to the thousand. Its format is published as a <a href=\"{schema}\">JSON Schema</a>.":
    "El Garaje le muestra a cada dueño la vista pública de su auto. Deja fuera el VIN (solo dice si hay uno registrado), la identidad de cada dueño y cada archivo, nota, costo y nombre de taller. Los días se reducen a meses y el millaje se redondea hacia abajo al millar. Su formato está publicado como un <a href=\"{schema}\">JSON Schema</a>.",
  "A 3D town in the browser with three places. The Garage, where cars are tuned and fitted with parts. The Dealership, a simulator of the car business: buy at auction, recondition, sell. The Strip, with six kinds of race, alone or live against friends through a link. It runs at <a href=\"{world}\">micar-sim.onrender.com</a> and needs JavaScript and WebGL. Money and prizes in the World are game currency.":
    "Un pueblo en 3D en el navegador, con tres lugares. El Garaje, donde los autos se ajustan y se les ponen piezas. El Concesionario, un simulador del negocio de autos: comprar en subasta, reacondicionar, vender. La Pista, con seis tipos de carrera, a solas o en vivo contra amigos mediante un enlace. Funciona en <a href=\"{world}\">micar-sim.onrender.com</a> y requiere JavaScript y WebGL. El dinero y los premios del mundo son moneda del juego.",
  "A printable window sheet for a car on the lot: the car's details, the asking price, MiCar's value check and forecast, and a QR code that opens the car's page. The whole record is packed into the link, so nothing is stored on a server. It is an information sheet, not the manufacturer's label and not the FTC Buyers Guide.":
    "Una hoja de ventana imprimible para un auto en el lote: los detalles del auto, el precio de venta, el análisis de valor y el pronóstico de MiCar, y un código QR que abre la página del auto. Todo el registro va dentro del enlace, así que no se guarda nada en un servidor. Es una hoja informativa, no la etiqueta del fabricante ni la Guía del Comprador de la FTC.",
  "MiCar Shop: a body shop, a mechanic bay and a customer tracker for real shops, at <a href=\"{shop}\">micar-sim.onrender.com/shop</a>.":
    "MiCar Shop: un taller de carrocería, un taller mecánico y un seguimiento para clientes, para talleres reales, en <a href=\"{shop}\">micar-sim.onrender.com/shop</a>.",
  "For software and AI agents":
    "Para programas y agentes de IA",
  "<a href=\"{url}\">llms.txt</a>: a short map of the site":
    "<a href=\"{url}\">llms.txt</a>: un mapa breve del sitio",
  "<a href=\"{index}\">The data API</a>: every model, year, trim, MSRP, EPA configuration and source as JSON, described in <a href=\"{openapi}\">OpenAPI 3.1</a>":
    "<a href=\"{index}\">La API de datos</a>: cada modelo, año, versión, precio de etiqueta, configuración de la EPA y fuente en JSON, descrita en <a href=\"{openapi}\">OpenAPI 3.1</a>",
  "The live valuation endpoint:":
    "El punto de valoración en vivo:",
  "<a href=\"{method}\">The valuation method as data</a> and the <a href=\"{schema}\">vehicle record format</a>":
    "<a href=\"{method}\">El método de valoración como datos</a> y el <a href=\"{schema}\">formato del registro de un vehículo</a>",
  "<a href=\"{repo}\">The source code</a>, including every formula of the card engine in <code>packages/engine/README.md</code>":
    "<a href=\"{repo}\">El código fuente</a>, con todas las fórmulas del motor de tarjetas en <code>packages/engine/README.md</code>",
  "The data files and the source code are in English.":
    "Los archivos de datos y el código fuente están en inglés.",
  "What MiCar is: a free used-car value calculator for {models} models, a Garage that gives each car a MiCar ID, a passport, a grade and a collectible card, and a 3D world to drive it in. And what is checked today: nothing; every fact about a car is its owner's word.":
    "Qué es MiCar: una calculadora gratuita del valor de autos usados para {models} modelos, un Garaje que le da a cada auto un MiCar ID, un pasaporte, una calificación y una tarjeta coleccionable, y un mundo en 3D para manejarlo. Y qué se ha comprobado hoy: nada; cada dato sobre un auto es la palabra de su dueño.",
  "What MiCar is: car values, the Garage, the passport and the grade | MiCar":
    "Qué es MiCar: valores de autos, el Garaje, el pasaporte y la calificación | MiCar",
  "How a value is worked out":
    "Cómo se calcula un valor",
  "How MiCar works out a value":
    "Cómo calcula MiCar un valor",
  "A MiCar value is an estimate from a depreciation model fitted to real asking prices. It is not an offer to buy, not an appraisal of a particular car, and not a live market price. This page gives every step, the numbers the engine uses, how far off it has measured itself to be, and what it does not know.":
    "Un valor de MiCar es una estimación de un modelo de depreciación ajustado a precios pedidos reales. No es una oferta de compra, ni un avalúo de un auto en particular, ni un precio de mercado en vivo. Esta página da cada paso, las cifras que usa el motor, cuánto ha medido que falla y lo que no sabe.",
  "The steps, in order":
    "Los pasos, en orden",
  "The calculator and the <a href=\"{api}\">valuation API</a> show these same lines with the dollars for the car in question.":
    "La calculadora y la <a href=\"{api}\">API de valoración</a> muestran estas mismas líneas con los dólares del auto en cuestión.",
  "<strong>Original MSRP.</strong> The window-sticker price of that trim in that model year, excluding destination. MiCar has {trims} trim prices for {years} model years of {models} models; each model year names its source on the <a href=\"{cars}\">car pages</a>. {maker} of those model years come from the manufacturer's own pricing; the rest come from secondary pricing sites.":
    "<strong>Precio de etiqueta original (MSRP).</strong> El precio de etiqueta de esa versión en ese año modelo, sin el cargo de destino. MiCar tiene {trims} precios por versión para {years} años modelo de {models} modelos; cada año modelo nombra su fuente en las <a href=\"{cars}\">páginas de los autos</a>. {maker} de esos años modelo vienen de los precios del propio fabricante; el resto, de sitios secundarios de precios.",
  "<strong>New-car prices since then.</strong> Used buyers compare against what a new one costs today, so the sticker is raised {rate} for each year since the model year.":
    "<strong>Precios de autos nuevos desde entonces.</strong> Quien compra un usado lo compara con lo que cuesta uno nuevo hoy, así que el precio de etiqueta se sube {rate} por cada año transcurrido desde el año modelo.",
  "<strong>Age and model resale.</strong> A curve that lands on the share of a new car's price this model typically keeps after five years. Trim content above the base car is taken to keep {keep} as much of its value as the car itself.":
    "<strong>Antigüedad y reventa del modelo.</strong> Una curva que llega a la parte del precio de un auto nuevo que este modelo suele conservar a los cinco años. Se considera que el equipamiento de una versión por encima del auto base conserva {keep} del valor que conserva el auto mismo.",
  "<strong>Mileage.</strong> {miles} miles a year is expected. Each 1,000 miles above that takes about {per}% off, to at most half; each 1,000 below adds 0.4%, to at most 12%.":
    "<strong>Millaje.</strong> Se esperan {miles} millas al año. Cada 1,000 millas por encima quitan cerca de {per}%, hasta la mitad como máximo; cada 1,000 por debajo suman 0.4%, hasta 12% como máximo.",
  "<strong>Condition, title and reported accidents.</strong> The tables below.":
    "<strong>Estado, título y accidentes reportados.</strong> Las tablas de abajo.",
  "<strong>Regional demand.</strong> A few percent either way for trucks, electric cars and all-wheel-drive brands by US region.":
    "<strong>Demanda regional.</strong> Unos puntos porcentuales arriba o abajo para camionetas, autos eléctricos y marcas de tracción total, según la región de EE. UU.",
  "<strong>Market conditions.</strong> The US Bureau of Labor Statistics' used-car price index, read weekly, moves the value up to {swing} either way for an average model, more for luxury, fleet and electric models and less for models with steady demand.":
    "<strong>Condiciones del mercado.</strong> El índice de precios de autos usados de la Oficina de Estadísticas Laborales de EE. UU., leído cada semana, mueve el valor hasta {swing} arriba o abajo en un modelo promedio, más en modelos de lujo, de flotilla y eléctricos, y menos en modelos de demanda estable.",
  "<strong>Local supply, if you give it.</strong> How many similar cars are listed nearby, against a typical {typical}: from 18% off when there are many to 8% on when there are few.":
    "<strong>Oferta local, si usted la da.</strong> Cuántos autos similares están anunciados cerca, frente a unos {typical} habituales: desde 18% menos cuando hay muchos hasta 8% más cuando hay pocos.",
  "<strong>Priced to sell, if you say so.</strong> {month} off to sell within a month, {week} off within a week.":
    "<strong>Precio para vender rápido, si usted lo indica.</strong> {month} menos para vender en un mes, {week} menos en una semana.",
  "<strong>Local asking prices, if you give them.</strong> The estimate moves toward the median of the asking prices you enter, less {under} because buyers usually pay under asking. More prices count for more: five count for about three quarters of the answer. A price far from the estimate is ignored and said to be.":
    "<strong>Precios pedidos en su zona, si usted los da.</strong> La estimación se acerca a la mediana de los precios pedidos que usted ingresa, menos {under} porque los compradores suelen pagar menos de lo pedido. Más precios pesan más: cinco cuentan por unas tres cuartas partes de la respuesta. Un precio muy alejado de la estimación se ignora, y se dice.",
  "The result is the private-party value. Trade-in is that less a dealer's margin (8% to 16%, larger on cheaper cars) and the cost of reconditioning; dealer retail is that plus most of the margin. The range around it runs from 3% to 22% either side, wider for older cars, branded titles, major accidents, unusual mileage and models with no data of their own, and each answer lists its reasons.":
    "El resultado es el valor en venta particular. El intercambio es ese valor menos el margen del concesionario (8% a 16%, mayor en autos más baratos) y el costo de reacondicionamiento; el precio en concesionario es ese valor más la mayor parte del margen. El rango alrededor va de 3% a 22% hacia cada lado, más amplio en autos más viejos, títulos con marca, accidentes graves, millaje inusual y modelos sin datos propios, y cada respuesta enumera sus razones.",
  "Change":
    "Cambio",
  "Meaning":
    "Significado",
  "no change":
    "sin cambio",
  "The figures for a rebuilt and a salvage title are a dealer's rule of thumb. MiCar has not tested them against sale prices, and every such value carries a warning saying so. Get an independent appraisal before relying on one.":
    "Las cifras para un título reconstruido y uno de salvamento son una regla práctica de concesionario. MiCar no las ha comparado con precios de venta, y cada valor de ese tipo lleva una advertencia que lo dice. Obtenga una tasación independiente antes de confiar en uno.",
  "How far off it is":
    "Cuánto falla",
  "On {date}, the resale curve of {fitted} models was fitted to {listings} real listings: dealer asking prices for the volume trim of several model years of each model. Across them the engine's value misses the asking price by {mae} on average. {dropped} listings more than 35% from the estimate were left out as outliers (wrecks, mislabelled trims). The closest fit is the {best} ({bestMae}), the worst the {worst} ({worstMae}).":
    "El {date}, la curva de reventa de {fitted} modelos se ajustó a {listings} anuncios reales: precios pedidos por concesionarios para la versión de mayor volumen de varios años modelo de cada modelo. En conjunto, el valor del motor se aparta del precio pedido {mae} en promedio. Se dejaron fuera {dropped} anuncios a más de 35% de la estimación, como casos atípicos (autos chocados, versiones mal etiquetadas). El mejor ajuste es el del {best} ({bestMae}); el peor, el del {worst} ({worstMae}).",
  "Three limits on that figure. These are <strong>asking prices, not sale prices</strong>. The samples are small: between {min} and {max} listings a model. And the other <strong>{rest} of {models} models are not fitted to listings at all</strong>: their resale share comes from published resale studies or from the make and body style, and no error has been measured for them. The calculator and the API say which case a car is in, under its confidence level.":
    "Tres límites de esa cifra. Son <strong>precios pedidos, no precios de venta</strong>. Las muestras son pequeñas: entre {min} y {max} anuncios por modelo. Y los otros <strong>{rest} de {models} modelos no están ajustados a anuncios en absoluto</strong>: su parte de reventa viene de estudios de reventa publicados o de la marca y la carrocería, y no se les ha medido ningún error. La calculadora y la API dicen en qué caso está un auto, bajo su nivel de confianza.",
  "Kept at 5 yrs is the share of a new one's price the model keeps after five years. Miss is the average distance from the asking price. Lean is the typical direction: plus means the engine runs high.":
    "«A 5 años» es la parte del precio de uno nuevo que el modelo conserva a los cinco años. «Error» es la distancia promedio al precio pedido. «Sesgo» es la dirección habitual: más significa que el motor da de más.",
  "Listings":
    "Anuncios",
  "Kept at 5 yrs":
    "A 5 años",
  "Miss":
    "Error",
  "Lean":
    "Sesgo",
  "The same figures as <a href=\"{json}\">JSON</a>.":
    "Las mismas cifras en <a href=\"{json}\">JSON</a>.",
  "What it does not know":
    "Lo que no sabe",
  "<strong>Anything about the particular car.</strong> Mileage, condition, title and accidents are what the person asking states. MiCar looks up no title history, reads no odometer and inspects nothing.":
    "<strong>Nada sobre el auto en particular.</strong> El millaje, el estado, el título y los accidentes son lo que declara quien pregunta. MiCar no consulta ningún historial de título, no lee ningún odómetro y no inspecciona nada.",
  "<strong>Sale prices.</strong> It has asking prices for some models and none for most.":
    "<strong>Precios de venta.</strong> Tiene precios pedidos de algunos modelos y de la mayoría, ninguno.",
  "<strong>Options.</strong> It knows the trim's sticker price, not the packages or accessories fitted to one car.":
    "<strong>Opciones.</strong> Conoce el precio de etiqueta de la versión, no los paquetes ni los accesorios de un auto en particular.",
  "<strong>Your local market, unless you tell it.</strong> Without the number of similar cars nearby or their asking prices, it uses the national index only.":
    "<strong>Su mercado local, a menos que usted se lo diga.</strong> Sin el número de autos similares cerca ni sus precios pedidos, usa solo el índice nacional.",
  "<strong>A generation that behaves differently.</strong> One resale share serves every year of a model, which is why the {worst} fits worst.":
    "<strong>Una generación que se comporta distinto.</strong> Una sola parte de reventa sirve para todos los años de un modelo, y por eso el {worst} es el que peor ajusta.",
  "<strong>Classic, exotic and very old cars.</strong> The curve is fitted to ordinary cars of recent model years.":
    "<strong>Autos clásicos, exóticos y muy viejos.</strong> La curva está ajustada a autos comunes de años modelo recientes.",
  "How MiCar works out a used-car value: every step from the original MSRP, the numbers the engine uses, its measured error against {listings} real asking prices ({mae} on average, for {fitted} of {models} models), and what it does not know.":
    "Cómo calcula MiCar el valor de un auto usado: cada paso desde el precio de etiqueta original, las cifras que usa el motor, su error medido frente a {listings} precios pedidos reales ({mae} en promedio, en {fitted} de {models} modelos) y lo que no sabe.",
  "How MiCar works out a used-car value, and how far off it can be | MiCar":
    "Cómo calcula MiCar el valor de un auto usado y cuánto puede fallar | MiCar",
  "All cars":
    "Todos los autos",
  "Every car MiCar can value":
    "Todos los autos que MiCar puede valorar",
  "{models} models from {makes} makes, each with original sticker prices by model year and a free used-car value calculator.":
    "{models} modelos de {makes} marcas, cada uno con precios de etiqueta originales por año modelo y una calculadora gratuita del valor de autos usados.",
  "Cars MiCar can value":
    "Autos que MiCar puede valorar",
  "Every car MiCar can value: used-car values and original MSRP by model | MiCar":
    "Todos los autos que MiCar puede valorar: valores de autos usados y precio de etiqueta original por modelo | MiCar",
  "Browse {models} car models from {makes} makes with original sticker prices by year and a free trade-in, private-party and dealer retail value calculator.":
    "Vea {models} modelos de {makes} marcas con precios de etiqueta originales por año y una calculadora gratuita del valor por intercambio, en venta particular y en concesionario.",
  "{name} ({body}) used values on MiCar: original sticker prices (MSRP) for the {span} model years, {range} new, and a free calculator for trade-in, private-party and dealer retail value.":
    "Valores de {name} ({body}) usados en MiCar: precios de etiqueta originales (MSRP) de los años modelo {span}, {range} de nuevo, y una calculadora gratuita del valor por intercambio, en venta particular y en concesionario.",
  "Value a {year}":
    "Valorar un {year}",
  "at {low}":
    "de {low}",
  "{name} values":
    "Valores del {name}",
  "The {name} is {body}.":
    "El {name} es {body}.",
  "MiCar has original window-sticker prices for {n} model years ({span}), {price} before destination.":
    "MiCar tiene precios de etiqueta originales de {n} años modelo ({span}), {price} sin el cargo de destino.",
  "Pick a year to see what one is worth today: trade-in, private-party and dealer retail, with a price range and a five-year forecast. Free, no account.":
    "Elija un año para ver cuánto vale uno hoy: por intercambio, en venta particular y en concesionario, con un rango de precios y un pronóstico a cinco años. Gratis, sin cuenta.",
  "Value my {name}":
    "Valorar mi {name}",
  "Original MSRP by model year":
    "Precio de etiqueta original por año modelo",
  "Trims":
    "Versiones",
  "MSRP range (excl. destination)":
    "Rango de precio de etiqueta (sin destino)",
  "Every trim, engine and price source":
    "Cada versión, motor y fuente del precio",
  "How the EPA lists the {car} (engine, transmission, drive, fuel):":
    "Cómo lista la EPA el {car} (motor, transmisión, tracción y combustible, en las palabras de la EPA):",
  "a secondary pricing site":
    "un sitio secundario de precios",
  "Prices from {source}.":
    "Precios de {source}.",
  "The same figures are also available as <a href=\"{json}\">JSON</a>.":
    "Las mismas cifras también están disponibles en <a href=\"{json}\">JSON</a>.",
  "Sticker prices come from manufacturer and pricing sources gathered for MiCar, named for each model year. Today's values are estimates, not offers: the calculator works them out from the sticker price, age, mileage, condition, title, reported accidents, region and the used-car market, and from local supply and asking prices when you give them. MiCar checks no record of any car.":
    "Los precios de etiqueta vienen de fuentes del fabricante y de precios reunidas para MiCar, nombradas en cada año modelo. Los valores de hoy son estimaciones, no ofertas: la calculadora los obtiene del precio de etiqueta, la antigüedad, el millaje, el estado, el título, los accidentes reportados, la región y el mercado de autos usados, y de la oferta local y los precios pedidos cuando usted los da. MiCar no revisa ningún registro de ningún auto.",
  "How a value is worked out, and how far off it can be":
    "Cómo se calcula un valor y cuánto puede fallar",
  "{name} values and original MSRP ({span}) | MiCar":
    "Valores y precio de etiqueta original del {name} ({span}) | MiCar",
  "Every trim and its MSRP, with the EPA's engine and drivetrain configurations where the EPA lists them, is also available as <a href=\"{json}\">JSON</a>.":
    "Cada versión y su precio de etiqueta, con las configuraciones de motor y tracción de la EPA donde la EPA las lista, también están disponibles en <a href=\"{json}\">JSON</a>.",
  "from {low} to {high}":
    "de {low} a {high}",
  "Destination charge {usd}, not included in the prices below.":
    "Cargo de destino de {usd}, no incluido en los precios de abajo.",
  "{name} ({body}) used values on MiCar: original sticker prices (MSRP) for the {span} model year, {range} new, and a free calculator for trade-in, private-party and dealer retail value.":
    "Valores de {name} ({body}) usados en MiCar: precios de etiqueta originales (MSRP) del año modelo {span}, {range} de nuevo, y una calculadora gratuita del valor por intercambio, en venta particular y en concesionario.",
  "MiCar has original window-sticker prices for {n} model year ({span}), {price} before destination.":
    "MiCar tiene precios de etiqueta originales de {n} año modelo ({span}), {price} sin el cargo de destino.",
  "The EPA's vehicle file lists no configuration for the {car}.":
    "El archivo de vehículos de la EPA no lista ninguna configuración para el {car}.",
  "Configuration":
    "Configuración",
  "the manufacturer's own pricing":
    "los precios del propio fabricante",
  "a source MiCar did not classify":
    "una fuente que MiCar no clasificó",
};
