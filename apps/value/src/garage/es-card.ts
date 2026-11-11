// Spanish for the card, the page shell and the engine's own words (attributes, levels, rarity, data quality).
export const ES_CARD: Record<string, string> = {
  // The page
  '{mi}Car Garage': '{mi}Car Garage',
  'Your cars, as cards.': 'Sus autos, en tarjetas.',
  'on this device': 'en este dispositivo',
  'Saved on this device. Nothing here leaves your browser. Accounts come with phase 1.': 'Guardado en este dispositivo. Nada sale de su navegador. Las cuentas llegan con la fase 1.',
  'Example cards': 'Tarjetas de ejemplo',
  'Two specimens to show what a card carries. Their numbers are illustrative placeholders, not verified manufacturer data.': 'Dos ejemplares para mostrar lo que lleva una tarjeta. Sus números son ilustrativos, no datos verificados del fabricante.',
  'House cards': 'Tarjetas de la casa',
  'Real vehicles from the reference catalogue, scored by the same rules as yours. Their figures were gathered from public sources and have not been verified; a dash means a figure could not be sourced, so that attribute is not rated.': 'Vehículos reales del catálogo de referencia, puntuados con las mismas reglas que el suyo. Sus datos se reunieron de fuentes públicas y no han sido verificados; un guion significa que no se encontró la fuente de un dato, así que ese atributo queda sin medir.',
  // The card
  'Power rating': 'Índice de poder',
  'of 1000': 'de 1000',
  '{n} of 7 rated': '{n} de 7 medidos',
  'example': 'ejemplo',
  'Ed. {n}': 'Ed. {n}',
  'grade report': 'informe de calificación',
  'Overall {n} of 100': 'Total {n} de 100',
  'Estimated from other figures': 'Estimado a partir de otros datos',
  'An example card. Its values are placeholders, not data about a real car.': 'Una tarjeta de ejemplo. Sus valores son ilustrativos, no datos de un auto real.',
  'A house card from the reference catalogue. It has no owner, so it has no grade.': 'Una tarjeta de la casa, del catálogo de referencia. No tiene dueño, así que no tiene calificación.',
  // Attributes
  'Power': 'Potencia', 'Speed': 'Velocidad', 'Acceleration': 'Aceleración', 'Handling': 'Manejo',
  'Durability': 'Durabilidad', 'Reliability': 'Confiabilidad', 'Efficiency': 'Eficiencia',
  'Engine or electric motor performance': 'Rendimiento del motor de combustión o eléctrico',
  'Maximum achievable speed': 'Velocidad máxima alcanzable',
  'Ability to gain speed': 'Capacidad de ganar velocidad',
  'Cornering, steering and vehicle control': 'Curvas, dirección y control del vehículo',
  'Resistance to wear and physical damage': 'Resistencia al desgaste y al daño físico',
  'Mechanical dependability': 'Confiabilidad mecánica',
  'Fuel or energy efficiency': 'Eficiencia de combustible o energía',
  'PWR': 'POT', 'SPD': 'VEL', 'ACC': 'ACE', 'HDL': 'MAN', 'DUR': 'DUR', 'REL': 'CON', 'EFF': 'EFI',
  'ID': 'ID', 'DOC': 'DOC', 'CND': 'EST', 'ORG': 'ORI', 'VER': 'VER',
  // How a score was reached, and how good its data is
  'Read from the specification': 'Tomado de la especificación',
  'Modelled from the configuration': 'Modelado a partir de la configuración',
  'Illustrative value': 'Valor ilustrativo',
  'Not rated: figures missing': 'Sin medir: faltan datos',
  'Illustrative example': 'Ejemplo ilustrativo',
  'Owner-entered data': 'Datos del dueño',
  'Reference data, not verified': 'Datos de referencia, sin verificar',
  'Sourced data': 'Datos con fuente',
  'Verified data': 'Datos verificados',
  'Declared': 'Declarado', 'Documented': 'Documentado', 'Verified': 'Verificado',
  // Certification levels
  'Registered': 'Registrado', 'Certified': 'Certificado',
  'The vehicle is on record with an owner.': 'El vehículo está registrado con un dueño.',
  'Its identity and history are backed by files the owner attached.': 'Su identidad y su historial están respaldados por archivos que adjuntó el dueño.',
  'An independent party has checked its identity, and its mileage or its records.': 'Un tercero independiente revisó su identidad, y su millaje o sus registros.',
  'An independent inspector has examined the vehicle in person.': 'Un inspector independiente examinó el vehículo en persona.',
  // Rarity
  'Common': 'Común', 'Uncommon': 'Poco común', 'Rare': 'Rara', 'Epic': 'Épica', 'Legendary': 'Legendaria', 'Mythic': 'Mítica', 'One-of-One': 'Única',
  // Body classes
  'Sports car': 'Deportivo', 'Coupe': 'Cupé', 'Hatchback': 'Hatchback', 'Wagon': 'Familiar', 'SUV': 'SUV', 'Off-road 4x4': 'Todoterreno 4x4', 'Pickup': 'Pickup', 'Van': 'Van',
  // The five parts of the grade, short
  'Identity': 'Identidad', 'Documentation': 'Documentación', 'Condition': 'Estado', 'Originality': 'Originalidad', 'Verification': 'Verificación',
  // Editions
  'Registration Edition': 'Edición de registro', 'Documented Edition': 'Edición documentada', 'Verified Edition': 'Edición verificada', 'Certified Edition': 'Edición certificada',
  // Modification chips
  'Engine': 'Motor', 'ECU': 'ECU', 'Intake': 'Admisión', 'Turbo': 'Turbo', 'Blower': 'Compresor', 'Nitrous': 'Nitro', 'Trans': 'Transm.',
  'Susp': 'Susp.', 'Tires': 'Llantas', 'Brakes': 'Frenos', 'Weight': 'Peso', 'Aero': 'Aero', 'Off-road': 'Todoterreno', 'Eco': 'Eco',
  '{title}, {kind}. Press Enter to turn the card over.': '{title}, {kind}. Presione Enter para voltear la tarjeta.',
  // The card back: its inspect view, the four-backs page and the foils' names (@micar/holo's FOIL_LABELS)
  'Card back': 'Reverso de la tarjeta',
  'Card back: {title}': 'Reverso de la tarjeta: {title}',
  'The back of the card: {rarity}, {foil}': 'El reverso de la tarjeta: {rarity}, {foil}',
  'Drag to tilt the card': 'Arrastre para inclinar la tarjeta',
  'Card backs': 'Reversos de la tarjeta',
  "Every card carries the same back. Its foil follows the card's rarity: earned, never sold.": 'Todas las tarjetas llevan el mismo reverso. Su foil sigue a la rareza de la tarjeta: se gana, nunca se vende.',
  'Show the {foil} back': 'Mostrar el reverso: {foil}',
  'Gloss': 'Brillo', 'Standard holo': 'Holográfico estándar', 'Full-spectrum rainbow': 'Arcoíris de espectro completo', 'Refractive prismatic': 'Prismático refractivo',
};
