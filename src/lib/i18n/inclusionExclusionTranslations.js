/* Inclusions and Exclusions multi-language translations.
 *
 * Provides dictionary translations for standard inclusion, exclusion, and meal plan
 * lines commonly used in itineraries and packages across all supported languages:
 * en (source), pt-BR, fr, de, es.
 *
 * If a tenant has stored custom translations in text_i18n, those take precedence.
 * When lines in English match standard phrases, this helper automatically translates
 * them so client documents in Portuguese, French, German, or Spanish are genuinely
 * translated rather than output in English.
 */

import { isTranslatedDocument, SOURCE_LANGUAGE } from './languages';

export const STANDARD_INCLUSIONS_TRANSLATIONS = [
  {
    pattern: /accommodation\s*(as\s*(specified|indicated|stated|booked))?/i,
    en: 'Accommodation as specified',
    'pt-BR': 'Alojamento conforme especificado',
    fr: 'Hébergement selon l\'itinéraire',
    de: 'Unterkunft wie angegeben',
    es: 'Alojamiento según especificado'
  },
  {
    pattern: /meals\s*(as\s*(specified|indicated|stated|booked))?/i,
    en: 'Meals as specified',
    'pt-BR': 'Refeições conforme especificado',
    fr: 'Repas selon l\'itinéraire',
    de: 'Mahlzeiten wie angegeben',
    es: 'Comidas según especificado'
  },
  {
    pattern: /breakfast\s*(daily|included)?/i,
    en: 'Breakfast daily',
    'pt-BR': 'Café da manhã diariamente',
    fr: 'Petit-déjeuner quotidien',
    de: 'Täglich Frühstück',
    es: 'Desayuno diario'
  },
  {
    pattern: /all\s*transfers\s*(as\s*specified)?|airport\s*transfers?/i,
    en: 'Airport and inter-hotel transfers as specified',
    'pt-BR': 'Traslados de aeroporto e hotel conforme especificado',
    fr: 'Transferts aéroport et hôtel selon l\'itinéraire',
    de: 'Flughafen- und Hoteltransfers wie angegeben',
    es: 'Traslados de aeropuerto y hotel según especificado'
  },
  {
    pattern: /transfers?\s*(as\s*(specified|indicated|stated))?/i,
    en: 'Transfers as specified',
    'pt-BR': 'Traslados conforme especificado',
    fr: 'Transferts selon l\'itinéraire',
    de: 'Transfers wie angegeben',
    es: 'Traslados según especificado'
  },
  {
    pattern: /activities\s*(as\s*(specified|indicated|stated|booked))?|game\s*drives?/i,
    en: 'Activities and game drives as specified',
    'pt-BR': 'Atividades e safáris conforme especificado',
    fr: 'Activités et safaris selon l\'itinéraire',
    de: 'Aktivitäten und Pirschfahrten wie angegeben',
    es: 'Actividades y safaris según especificado'
  },
  {
    pattern: /(park\s*(fees|charges)|conservation\s*lev(y|ies)|entrance\s*fees?)/i,
    en: 'Park fees and conservation levies',
    'pt-BR': 'Taxas de parque e taxas de conservação',
    fr: 'Frais de parc et taxes de conservation',
    de: 'Parkeintrittsgebühren und Naturschutzabgaben',
    es: 'Tasas de parques y tasas de conservación'
  },
  {
    pattern: /tourism\s*lev(y|ies)/i,
    en: 'Tourism levies and government taxes',
    'pt-BR': 'Taxas de turismo e impostos governamentais',
    fr: 'Taxes de séjour et taxes gouvernementales',
    de: 'Tourismusabgaben und staatliche Steuern',
    es: 'Tasas turísticas e impuestos gubernamentales'
  },
  {
    pattern: /(transport|transportation)\s*(in\s*.*vehicle)?/i,
    en: 'Transportation in designated tour vehicle',
    'pt-BR': 'Transporte em veículo turístico designado',
    fr: 'Transport en véhicule de tourisme désigné',
    de: 'Transport im dafür vorgesehenen Tourfahrzeug',
    es: 'Transporte en vehículo turístico designado'
  },
  {
    pattern: /(english\s*speaking\s*)?(guide|driver|tour\s*leader)/i,
    en: 'Professional English-speaking guide/driver',
    'pt-BR': 'Guia/motorista profissional de língua inglesa',
    fr: 'Guide/chauffeur professionnel anglophone',
    de: 'Professioneller englischsprachiger Reiseleiter/Fahrer',
    es: 'Guía/conductor profesional de habla inglesa'
  },
  {
    pattern: /toll\s*fees?|porterage/i,
    en: 'Toll fees and porterage',
    'pt-BR': 'Taxas de pedágio e carregadores de bagagem',
    fr: 'Frais de péage et portage',
    de: 'Mautgebühren und Gepäckträger',
    es: 'Peajes y porteadores de equipaje'
  }
];

export const STANDARD_EXCLUSIONS_TRANSLATIONS = [
  {
    pattern: /(international|domestic|all)?\s*flights?/i,
    en: 'International and domestic flights',
    'pt-BR': 'Voos internacionais e domésticos',
    fr: 'Vols internationaux et nationaux',
    de: 'Internationale und Inlandsflüge',
    es: 'Vuelos internacionales y domésticos'
  },
  {
    pattern: /(passport|visa)\s*(fees?)?/i,
    en: 'Visa and passport fees',
    'pt-BR': 'Taxas de visto e passaporte',
    fr: 'Frais de visa et passeport',
    de: 'Visa- und Reisepassgebühren',
    es: 'Tasas de visado y pasaporte'
  },
  {
    pattern: /(travel\s*)?insurance/i,
    en: 'Travel and medical insurance',
    'pt-BR': 'Seguro de viagem e assistência médica',
    fr: 'Assurance voyage et médicale',
    de: 'Reise- und Krankenversicherung',
    es: 'Seguro de viaje y médico'
  },
  {
    pattern: /gratuities|tips/i,
    en: 'Gratuities and tips to guides, drivers, and lodge staff',
    'pt-BR': 'Gorjetas para guias, motoristas e funcionários do alojamento',
    fr: 'Pourboires aux guides, chauffeurs et personnel des lodges',
    de: 'Trinkgelder für Reiseleiter, Fahrer und Hotelpersonal',
    es: 'Propinas para guías, conductores y personal del hotel'
  },
  {
    pattern: /personal\s*(expenses|items)/i,
    en: 'Personal expenses (telephone, laundry, souvenirs, etc.)',
    'pt-BR': 'Despesas pessoais (telefone, lavanderia, lembranças, etc.)',
    fr: 'Dépenses personnelles (téléphone, blanchisserie, souvenirs, etc.)',
    de: 'Persönliche Ausgaben (Telefon, Wäscherei, Souvenirs usw.)',
    es: 'Gastos personales (teléfono, lavandería, compras, etc.)'
  },
  {
    pattern: /(drinks|beverages|alcohol)/i,
    en: 'Drinks and alcoholic beverages unless specified',
    'pt-BR': 'Bebidas alcoólicas e não alcoólicas, exceto quando especificado',
    fr: 'Boissons et alcools, sauf indication contraire',
    de: 'Getränke und alkoholische Getränke, sofern nicht anders angegeben',
    es: 'Bebidas y alcohol, salvo especificado'
  },
  {
    pattern: /optional\s*(activities|excursions|tours)/i,
    en: 'Optional activities and excursions not listed in itinerary',
    'pt-BR': 'Atividades e passeios opcionais não listados no itinerário',
    fr: 'Activités et excursions facultatives non mentionnées',
    de: 'Optionale Aktivitäten und Ausflüge, die nicht im Reiseplan stehen',
    es: 'Actividades y excursiones opcionales no incluidas en el itinerario'
  },
  {
    pattern: /meals\s*(not\s*specified|other\s*than)/i,
    en: 'Meals other than specified',
    'pt-BR': 'Refeições não especificadas no programa',
    fr: 'Repas non mentionnés au programme',
    de: 'Mahlzeiten, die nicht im Reiseverlauf angegeben sind',
    es: 'Comidas no especificadas en el programa'
  }
];

export const MEAL_PLAN_TRANSLATIONS = {
  'bed & breakfast': {
    'pt-BR': 'Café da manhã',
    fr: 'Nuit et petit-déjeuner',
    de: 'Übernachtung & Frühstück',
    es: 'Alojamiento y desayuno'
  },
  'b&b': {
    'pt-BR': 'Café da manhã',
    fr: 'Nuit et petit-déjeuner',
    de: 'Übernachtung & Frühstück',
    es: 'Alojamiento y desayuno'
  },
  'half board': {
    'pt-BR': 'Meia pensão',
    fr: 'Demi-pension',
    de: 'Halbpension',
    es: 'Media pensión'
  },
  'dinner, bed & breakfast': {
    'pt-BR': 'Jantar e café da manhã',
    fr: 'Dîner, nuit et petit-déjeuner',
    de: 'Abendessen, Übernachtung & Frühstück',
    es: 'Cena, alojamiento y desayuno'
  },
  'dbb': {
    'pt-BR': 'Jantar e café da manhã',
    fr: 'Dîner, nuit et petit-déjeuner',
    de: 'Abendessen, Übernachtung & Frühstück',
    es: 'Cena, alojamiento y desayuno'
  },
  'full board': {
    'pt-BR': 'Pensão completa',
    fr: 'Pension complète',
    de: 'Vollpension',
    es: 'Pensión completa'
  },
  'all inclusive': {
    'pt-BR': 'Tudo incluído',
    fr: 'Tout compris',
    de: 'Alles inklusive',
    es: 'Todo incluido'
  },
  'room only': {
    'pt-BR': 'Apenas quarto',
    fr: 'Hébergement seul',
    de: 'Nur Übernachtung',
    es: 'Solo alojamiento'
  },
  'self catering': {
    'pt-BR': 'Sem refeições',
    fr: 'Gestion libre / sans repas',
    de: 'Selbstverpflegung',
    es: 'Sin comidas'
  }
};

export const translateMealPlan = (mealPlan, lang) => {
  if (!mealPlan || !isTranslatedDocument(lang)) return mealPlan || '';
  const clean = String(mealPlan).trim().toLowerCase();
  for (const [key, mapping] of Object.entries(MEAL_PLAN_TRANSLATIONS)) {
    if (clean === key || clean.includes(key)) {
      return mapping[lang] || mealPlan;
    }
  }
  return mealPlan;
};

export const translateInclusionLine = (line, lang) => {
  if (!line || !isTranslatedDocument(lang)) return line || '';
  const text = String(line).trim();
  for (const entry of STANDARD_INCLUSIONS_TRANSLATIONS) {
    if (entry.pattern.test(text)) {
      return entry[lang] || text;
    }
  }
  return text;
};

export const translateExclusionLine = (line, lang) => {
  if (!line || !isTranslatedDocument(lang)) return line || '';
  const text = String(line).trim();
  for (const entry of STANDARD_EXCLUSIONS_TRANSLATIONS) {
    if (entry.pattern.test(text)) {
      return entry[lang] || text;
    }
  }
  return text;
};

export const translateInclusionsBlock = (rawText, lang) => {
  if (!rawText || !isTranslatedDocument(lang)) return rawText || '';
  return String(rawText)
    .split(/\r?\n/)
    .map((line) => {
      const stripped = line.replace(/^\s*[-*•–—]\s*/, '').trim();
      if (!stripped) return line;
      const translated = translateInclusionLine(stripped, lang);
      return line.startsWith('-') ? `- ${translated}` : translated;
    })
    .join('\n');
};

export const translateExclusionsBlock = (rawText, lang) => {
  if (!rawText || !isTranslatedDocument(lang)) return rawText || '';
  return String(rawText)
    .split(/\r?\n/)
    .map((line) => {
      const stripped = line.replace(/^\s*[-*•–—✘\u2718]\s*/, '').trim();
      if (!stripped) return line;
      const translated = translateExclusionLine(stripped, lang);
      return line.startsWith('-') ? `- ${translated}` : translated;
    })
    .join('\n');
};
