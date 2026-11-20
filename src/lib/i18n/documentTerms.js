/* The service categories a document prints.

   A category is the operator's own word for what a line is, so it is not in the
   label dictionary. The categories the app ships are, however, known words that a
   translated document should not leave in English. A category the table does not
   know is printed exactly as the operator typed it - inventing a translation for
   a tenant's own vocabulary would be worse than leaving it alone. */

const TERMS = {
  en: {
    accommodation: 'Accommodation',
    transfers: 'Transfers',
    transport: 'Transport',
    activities: 'Activities / Tours',
    flights: 'Flights / Charter',
    meals: 'Meals',
    guide: 'Guide',
    trains: 'Trains',
    tickets: 'Tickets',
    extras: 'Extras',
    carrental: 'Car Rental',
    fees: 'Fees & Tickets',
    surcharge: 'Fees & Tickets'
  },
  'pt-BR': {
    accommodation: 'Alojamento',
    transfers: 'Traslados',
    transport: 'Transporte',
    activities: 'Atividades / Passeios',
    flights: 'Voos / Charter',
    meals: 'Refeições',
    guide: 'Guia',
    trains: 'Trens',
    tickets: 'Ingressos',
    extras: 'Extras',
    carrental: 'Aluguel de carro',
    fees: 'Taxas e ingressos',
    surcharge: 'Taxas e ingressos'
  },
  fr: {
    accommodation: 'Hébergement',
    transfers: 'Transferts',
    transport: 'Transport',
    activities: 'Activités / Excursions',
    flights: 'Vols / Charter',
    meals: 'Repas',
    guide: 'Guide',
    trains: 'Trains',
    tickets: 'Billets',
    extras: 'Extras',
    carrental: 'Location de voiture',
    fees: 'Frais et billets',
    surcharge: 'Frais et billets'
  },
  de: {
    accommodation: 'Unterkunft',
    transfers: 'Transfers',
    transport: 'Transport',
    activities: 'Aktivitäten / Touren',
    flights: 'Flüge / Charter',
    meals: 'Mahlzeiten',
    guide: 'Reiseleitung',
    trains: 'Züge',
    tickets: 'Tickets',
    extras: 'Extras',
    carrental: 'Mietwagen',
    fees: 'Gebühren und Tickets',
    surcharge: 'Gebühren und Tickets'
  },
  es: {
    accommodation: 'Alojamiento',
    transfers: 'Traslados',
    transport: 'Transporte',
    activities: 'Actividades / Excursiones',
    flights: 'Vuelos / Charter',
    meals: 'Comidas',
    guide: 'Guía',
    trains: 'Trenes',
    tickets: 'Entradas',
    extras: 'Extras',
    carrental: 'Alquiler de coche',
    fees: 'Tasas y entradas',
    surcharge: 'Tasas y entradas'
  }
};

const termKey = (category) => {
  const text = String(category || '').trim().toLowerCase();
  if (!text) return '';
  if (/accommodation|alojamiento|hébergement|unterkunft/i.test(text)) return 'accommodation';
  if (/transfer|traslado/i.test(text)) return 'transfers';
  if (/transport/i.test(text)) return 'transport';
  if (/activit|tour|excursion|passeio/i.test(text)) return 'activities';
  if (/flight|charter|voo|vol|flug|vuelo/i.test(text)) return 'flights';
  if (/meal|refei|repas|mahlzeit|comida/i.test(text)) return 'meals';
  if (/guide|guia|guía|reiseleitung/i.test(text)) return 'guide';
  if (/train|trem|zug/i.test(text)) return 'trains';
  if (/ticket|ingresso|billet|entrada/i.test(text)) return 'tickets';
  if (/extra/i.test(text)) return 'extras';
  if (/car\s*rental|aluguel de carro|location de voiture|mietwagen|alquiler de coche/i.test(text)) return 'carrental';
  if (/fee|surcharge|taxa|frais|gebühr|tasa|recargo/i.test(text)) return 'fees';
  return '';
};

export const categoryLabel = (lang, category) => {
  const source = String(category || '').trim();
  const key = termKey(source);
  if (!key) return source;
  return TERMS[lang]?.[key] || TERMS.en[key] || source;
};

/* The category a fee line is filed under in an inclusions list. */
export const feeCategoryLabel = (lang, category) => categoryLabel(lang, category || 'Fees & Tickets');
