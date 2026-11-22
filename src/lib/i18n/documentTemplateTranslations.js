/* Static template wording, translated at export time.

   A saved template is authored once in English. When an itinerary is exported in
   another language, the operator expects one document in one language - not an
   English letterhead wrapped around Portuguese itinerary rows. This module
   translates the template's own prose and printed labels in place, while leaving
   {{placeholders}}, {Tokens}, values, brand names and the Word layout untouched.

   The dictionaries cover the wording TorBuilder templates use and the standard
   field labels the merge recognises. A tenant can add its own exact-phrase
   overrides through `template_translations[lang]` in the template data. */

import { DOCUMENT_LABEL_KEYS } from './documentLabels';
import { isTranslatedDocument } from './languages';
import { t } from './index';

/* The labels that the field filler can read after they have been printed in the
   target language. English is the source and needs no entry here. */
export const FIELD_LABEL_TRANSLATIONS = {
  'pt-BR': {
    'OPERATOR REFERENCE': 'REFERÊNCIA DO OPERADOR',
    'OPERATOR REF': 'REF DO OPERADOR',
    'CLIENT REFERENCE': 'REFERÊNCIA DO CLIENTE',
    'YOUR REFERENCE': 'SUA REFERÊNCIA',
    'OPERATOR': 'OPERADOR',
    'CLIENT NAME': 'NOME DO CLIENTE',
    'CLIENT': 'CLIENTE',
    'CUSTOMER': 'CLIENTE',
    'KOBO REFERENCE': 'REFERÊNCIA KOBO',
    'OUR REFERENCE': 'NOSSA REFERÊNCIA',
    'OUR REF': 'NOSSO REF',
    'REFERENCE': 'REFERÊNCIA',
    'REF': 'REF',
    'DATE OF TRAVEL': 'DATA DE VIAGEM',
    'TRAVEL DATES': 'DATAS DE VIAGEM',
    'TRAVEL DATE': 'DATA DE VIAGEM',
    'DATES OF TRAVEL': 'DATAS DE VIAGEM',
    'DATES': 'DATAS',
    'PAX COUNT': 'QUANTIDADE DE PAX',
    'NUMBER OF PASSENGERS': 'NÚMERO DE PASSAGEIROS',
    'PASSENGERS': 'PASSAGEIROS',
    'TRAVELLERS': 'VIAJANTES',
    'TRAVELERS': 'VIAJANTES',
    'PASSENGER NAMES': 'NOMES DOS PASSAGEIROS',
    'TRAVELLER NAMES': 'NOMES DOS VIAJANTES',
    'PROGRAMME': 'PROGRAMA',
    'PROGRAM': 'PROGRAMA',
    'STATUS': 'STATUS',
    'TOUR DESIGNER': 'DESIGNER DA VIAGEM',
    'CONSULTANT': 'CONSULTOR',
    'DESIGNER': 'DESIGNER',
    'COMPANY NAME': 'NOME DA EMPRESA',
    'COMPANY': 'EMPRESA'
  },
  fr: {
    'OPERATOR REFERENCE': 'RÉFÉRENCE DE L’OPÉRATEUR',
    'OPERATOR REF': 'RÉF. OPÉRATEUR',
    'CLIENT REFERENCE': 'RÉFÉRENCE CLIENT',
    'YOUR REFERENCE': 'VOTRE RÉFÉRENCE',
    'OPERATOR': 'OPÉRATEUR',
    'CLIENT NAME': 'NOM DU CLIENT',
    'CLIENT': 'CLIENT',
    'CUSTOMER': 'CLIENT',
    'KOBO REFERENCE': 'RÉFÉRENCE KOBO',
    'OUR REFERENCE': 'NOTRE RÉFÉRENCE',
    'OUR REF': 'NOTRE RÉF.',
    'REFERENCE': 'RÉFÉRENCE',
    'REF': 'RÉF.',
    'DATE OF TRAVEL': 'DATE DE VOYAGE',
    'TRAVEL DATES': 'DATES DE VOYAGE',
    'TRAVEL DATE': 'DATE DE VOYAGE',
    'DATES OF TRAVEL': 'DATES DE VOYAGE',
    'DATES': 'DATES',
    'PAX COUNT': 'NOMBRE DE PAX',
    'NUMBER OF PASSENGERS': 'NOMBRE DE PASSAGERS',
    'PASSENGERS': 'PASSAGERS',
    'TRAVELLERS': 'VOYAGEURS',
    'TRAVELERS': 'VOYAGEURS',
    'PASSENGER NAMES': 'NOMS DES PASSAGERS',
    'TRAVELLER NAMES': 'NOMS DES VOYAGEURS',
    'PROGRAMME': 'PROGRAMME',
    'PROGRAM': 'PROGRAMME',
    'STATUS': 'STATUT',
    'TOUR DESIGNER': 'CONCEPTEUR DU VOYAGE',
    'CONSULTANT': 'CONSEILLER',
    'DESIGNER': 'CONCEPTEUR',
    'COMPANY NAME': 'NOM DE L’ENTREPRISE',
    'COMPANY': 'ENTREPRISE'
  },
  de: {
    'OPERATOR REFERENCE': 'OPERATOR-REFERENZ',
    'OPERATOR REF': 'OPERATOR-REF.',
    'CLIENT REFERENCE': 'KUNDENREFERENZ',
    'YOUR REFERENCE': 'IHRE REFERENZ',
    'OPERATOR': 'VERANSTALTER',
    'CLIENT NAME': 'KUNDENNAME',
    'CLIENT': 'KUNDE',
    'CUSTOMER': 'KUNDE',
    'KOBO REFERENCE': 'KOBO-REFERENZ',
    'OUR REFERENCE': 'UNSERE REFERENZ',
    'OUR REF': 'UNSER REF.',
    'REFERENCE': 'REFERENZ',
    'REF': 'REF.',
    'DATE OF TRAVEL': 'REISEDATUM',
    'TRAVEL DATES': 'REISEDATEN',
    'TRAVEL DATE': 'REISEDATUM',
    'DATES OF TRAVEL': 'REISEDATEN',
    'DATES': 'DATEN',
    'PAX COUNT': 'PAX-ANZAHL',
    'NUMBER OF PASSENGERS': 'ANZAHL DER REISENDEN',
    'PASSENGERS': 'REISENDE',
    'TRAVELLERS': 'REISENDE',
    'TRAVELERS': 'REISENDE',
    'PASSENGER NAMES': 'NAMEN DER REISENDEN',
    'TRAVELLER NAMES': 'NAMEN DER REISENDEN',
    'PROGRAMME': 'PROGRAMM',
    'PROGRAM': 'PROGRAMM',
    'STATUS': 'STATUS',
    'TOUR DESIGNER': 'REISEBERATER',
    'CONSULTANT': 'BERATER',
    'DESIGNER': 'GESTALTER',
    'COMPANY NAME': 'FIRMENNAME',
    'COMPANY': 'FIRMA'
  },
  es: {
    'OPERATOR REFERENCE': 'REFERENCIA DEL OPERADOR',
    'OPERATOR REF': 'REF. DEL OPERADOR',
    'CLIENT REFERENCE': 'REFERENCIA DEL CLIENTE',
    'YOUR REFERENCE': 'SU REFERENCIA',
    'OPERATOR': 'OPERADOR',
    'CLIENT NAME': 'NOMBRE DEL CLIENTE',
    'CLIENT': 'CLIENTE',
    'CUSTOMER': 'CLIENTE',
    'KOBO REFERENCE': 'REFERENCIA KOBO',
    'OUR REFERENCE': 'NUESTRA REFERENCIA',
    'OUR REF': 'NUESTRA REF.',
    'REFERENCE': 'REFERENCIA',
    'REF': 'REF.',
    'DATE OF TRAVEL': 'FECHA DE VIAJE',
    'TRAVEL DATES': 'FECHAS DE VIAJE',
    'TRAVEL DATE': 'FECHA DE VIAJE',
    'DATES OF TRAVEL': 'FECHAS DE VIAJE',
    'DATES': 'FECHAS',
    'PAX COUNT': 'NÚMERO DE PAX',
    'NUMBER OF PASSENGERS': 'NÚMERO DE PASAJEROS',
    'PASSENGERS': 'PASAJEROS',
    'TRAVELLERS': 'VIAJEROS',
    'TRAVELERS': 'VIAJEROS',
    'PASSENGER NAMES': 'NOMBRES DE LOS PASAJEROS',
    'TRAVELLER NAMES': 'NOMBRES DE LOS VIAJEROS',
    'PROGRAMME': 'PROGRAMA',
    'PROGRAM': 'PROGRAMA',
    'STATUS': 'ESTADO',
    'TOUR DESIGNER': 'DISEÑADOR DE VIAJES',
    'CONSULTANT': 'CONSULTOR',
    'DESIGNER': 'DISEÑADOR',
    'COMPANY NAME': 'NOMBRE DE LA EMPRESA',
    'COMPANY': 'EMPRESA'
  }
};

/* Letter prose and policy wording that appears in saved letterhead templates.
   Each source is an exact English phrase as it is printed in the document. */
const TEMPLATE_PHRASES = [
  {
    en: 'Dear',
    'pt-BR': 'Prezado', fr: 'Cher', de: 'Sehr geehrte', es: 'Estimado'
  },
  {
    en: 'Sir/',
    'pt-BR': 'Senhor/', fr: 'Monsieur/', de: 'Herrn/', es: 'Señor/'
  },
  {
    en: 'Madam',
    'pt-BR': 'Senhora', fr: 'Madame', de: 'Dame', es: 'Señora'
  },
  {
    en: 'Thank you very much for your request, and I am pleased to send you the following',
    'pt-BR': 'Muito obrigado pelo seu pedido e tenho o prazer de enviar-lhe o seguinte',
    fr: 'Je vous remercie vivement de votre demande et suis heureux de vous transmettre ce qui suit',
    de: 'Vielen Dank für Ihre Anfrage; gerne sende ich Ihnen das Folgende',
    es: 'Muchas gracias por su solicitud y me complace enviarle lo siguiente'
  },
  {
    en: 'PLEASE NOTE',
    'pt-BR': 'OBSERVAÇÃO', fr: 'VEUILLEZ NOTER', de: 'HINWEIS', es: 'NOTA'
  },
  {
    en: 'Ensure that passengers have the necessary documentation for the trip',
    'pt-BR': 'Certifique-se de que os passageiros possuem a documentação necessária para a viagem',
    fr: 'Veuillez vous assurer que les passagers disposent des documents nécessaires au voyage',
    de: 'Bitte stellen Sie sicher, dass die Reisenden über die erforderlichen Reisedokumente verfügen',
    es: 'Asegúrese de que los pasajeros tengan la documentación necesaria para el viaje'
  },
  {
    en: 'Itinerary details',
    'pt-BR': 'Detalhes do itinerário',
    fr: 'Détails de l’itinéraire',
    de: 'Reisedetails',
    es: 'Detalles del itinerario'
  },
  {
    en: 'Subtotal (excl. tax)',
    'pt-BR': 'Subtotal (sem imposto)',
    fr: 'Sous-total (hors taxes)',
    de: 'Zwischensumme (ohne Steuern)',
    es: 'Subtotal (sin impuestos)'
  },
  {
    en: 'Total (incl. tax)',
    'pt-BR': 'Total (com imposto)',
    fr: 'Total (taxes comprises)',
    de: 'Gesamt (inkl. Steuern)',
    es: 'Total (con impuestos)'
  },
  {
    en: 'Total due',
    'pt-BR': 'Total a pagar',
    fr: 'Total à payer',
    de: 'Gesamtbetrag',
    es: 'Total a pagar'
  },
  {
    en: 'CANCELLATION POLICY',
    'pt-BR': 'POLÍTICA DE CANCELAMENTO',
    fr: 'POLITIQUE D’ANNULATION',
    de: 'STORNORICHTLINIE',
    es: 'POLÍTICA DE CANCELACIÓN'
  },
  {
    en: 'KOBO SOUTH AFRICA – CANCELLATION POLICY',
    'pt-BR': 'POLÍTICA DE CANCELAMENTO – KOBO ÁFRICA DO SUL',
    fr: 'POLITIQUE D’ANNULATION – KOBO AFRIQUE DU SUD',
    de: 'STORNORICHTLINIE – KOBO SÜDAFRIKA',
    es: 'POLÍTICA DE CANCELACIÓN – KOBO SUDÁFRICA'
  },
  {
    en: 'KOBO BOTSWANA – CANCELLATION POLICY',
    'pt-BR': 'POLÍTICA DE CANCELAMENTO – KOBO BOTSUANA',
    fr: 'POLITIQUE D’ANNULATION – KOBO BOTSWANA',
    de: 'STORNORICHTLINIE – KOBO BOTSUANA',
    es: 'POLÍTICA DE CANCELACIÓN – KOBO BOTSWANA'
  },
  {
    en: 'Between 40 and 35 days before the start of services: 25% of the total cost of services will be charged.',
    'pt-BR': 'Entre 40 e 35 dias antes do início dos serviços: 25% do custo total dos serviços será cobrado.',
    fr: 'Entre 40 et 35 jours avant le début des prestations : 25 % du coût total des prestations sera facturé.',
    de: 'Zwischen 40 und 35 Tagen vor Beginn der Leistungen: 25 % der Gesamtkosten werden berechnet.',
    es: 'Entre 40 y 35 días antes del inicio de los servicios: se cobrará el 25 % del coste total de los servicios.'
  },
  {
    en: 'Between 34 and 31 days before the start of services: 50% of the total cost of services will be charged.',
    'pt-BR': 'Entre 34 e 31 dias antes do início dos serviços: 50% do custo total dos serviços será cobrado.',
    fr: 'Entre 34 et 31 jours avant le début des prestations : 50 % du coût total des prestations sera facturé.',
    de: 'Zwischen 34 und 31 Tagen vor Beginn der Leistungen: 50 % der Gesamtkosten werden berechnet.',
    es: 'Entre 34 y 31 días antes del inicio de los servicios: se cobrará el 50 % del coste total de los servicios.'
  },
  {
    en: 'Less than 30 days or after the start of services: 100% of the total cost of services will be charged.',
    'pt-BR': 'Menos de 30 dias ou após o início dos serviços: 100% do custo total dos serviços será cobrado.',
    fr: 'Moins de 30 jours ou après le début des prestations : 100 % du coût total des prestations sera facturé.',
    de: 'Weniger als 30 Tage oder nach Beginn der Leistungen: 100 % der Gesamtkosten werden berechnet.',
    es: 'Menos de 30 días o después del inicio de los servicios: se cobrará el 100 % del coste total de los servicios.'
  },
  {
    en: 'Between 90 and 46 days before the start of services: 20% of the total cost of services will be charged',
    'pt-BR': 'Entre 90 e 46 dias antes do início dos serviços: 20% do custo total dos serviços será cobrado',
    fr: 'Entre 90 et 46 jours avant le début des prestations : 20 % du coût total des prestations sera facturé',
    de: 'Zwischen 90 und 46 Tagen vor Beginn der Leistungen: 20 % der Gesamtkosten werden berechnet',
    es: 'Entre 90 y 46 días antes del inicio de los servicios: se cobrará el 20 % del coste total de los servicios'
  },
  {
    en: 'Between 45 and 31 days before the start of services: 50% of the total cost of services will be charged',
    'pt-BR': 'Entre 45 e 31 dias antes do início dos serviços: 50% do custo total dos serviços será cobrado',
    fr: 'Entre 45 et 31 jours avant le début des prestations : 50 % du coût total des prestations sera facturé',
    de: 'Zwischen 45 und 31 Tagen vor Beginn der Leistungen: 50 % der Gesamtkosten werden berechnet',
    es: 'Entre 45 y 31 días antes del inicio de los servicios: se cobrará el 50 % del coste total de los servicios'
  },
  {
    en: 'Less than 30 days or after the start of services: 100% of the total cost of services will be charged',
    'pt-BR': 'Menos de 30 dias ou após o início dos serviços: 100% do custo total dos serviços será cobrado',
    fr: 'Moins de 30 jours ou après le début des prestations : 100 % du coût total des prestations sera facturé',
    de: 'Weniger als 30 Tage oder nach Beginn der Leistungen: 100 % der Gesamtkosten werden berechnet',
    es: 'Menos de 30 días o después del inicio de los servicios: se cobrará el 100 % del coste total de los servicios'
  },
  {
    en: 'I trust that the above content is correct; if you have any questions, I will be at your complete disposal',
    'pt-BR': 'Espero que o conteúdo acima esteja correto; em caso de dúvidas, estou à sua inteira disposição',
    fr: 'Je suis convaincu que le contenu ci-dessus est correct ; si vous avez des questions, je reste à votre entière disposition',
    de: 'Ich gehe davon aus, dass die obigen Angaben korrekt sind; bei Fragen stehe ich Ihnen gerne zur Verfügung',
    es: 'Confío en que el contenido anterior sea correcto; si tiene alguna pregunta, estoy a su entera disposición'
  },
  {
    en: 'Sincerely',
    'pt-BR': 'Atenciosamente', fr: 'Cordialement', de: 'Mit freundlichen Grüßen', es: 'Atentamente'
  },
  {
    en: 'Quotation',
    'pt-BR': 'Orçamento', fr: 'Devis', de: 'Angebot', es: 'Presupuesto'
  },
  {
    en: 'Provisional Booking',
    'pt-BR': 'Reserva provisória', fr: 'Réservation provisoire', de: 'Vorläufige Buchung', es: 'Reserva provisional'
  },
  {
    en: 'Confirmed Booking',
    'pt-BR': 'Reserva confirmada', fr: 'Réservation confirmée', de: 'Bestätigte Buchung', es: 'Reserva confirmada'
  }
];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesCaseOf = (matched, translated) => {
  if (matched === matched.toUpperCase() && /[A-Z]/.test(matched)) return translated.toUpperCase();
  if (/^[A-Z]/.test(matched) && /^[a-z]/.test(translated)) {
    return `${translated[0].toUpperCase()}${translated.slice(1)}`;
  }
  return translated;
};

const phraseMapFor = (lang) => {
  const map = new Map();
  const add = (english, translated) => {
    if (!english || !translated || english === translated) return;
    const key = String(english).trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, String(translated).trim());
  };

  Object.entries(FIELD_LABEL_TRANSLATIONS[lang] || {}).forEach(([english, translated]) => add(english, translated));
  TEMPLATE_PHRASES.forEach((phrase) => add(phrase.en, phrase[lang]));

  /* Every plain document label is a template phrase too. This picks up
     headings such as Inclusions, Exclusions and Pricing Breakdown without
     having to duplicate the dictionaries. Plural keys need a count, so they
     are deliberately left to the generator that already localises them. */
  DOCUMENT_LABEL_KEYS.forEach((key) => {
    const english = t('en', key);
    const translated = t(lang, key);
    if (typeof english === 'string' && typeof translated === 'string'
      && !/\{\w+\}/.test(english) && !/\{\w+\}/.test(translated)) add(english, translated);
  });

  return map;
};

const PHRASE_MAPS = Object.fromEntries(
  Object.keys(FIELD_LABEL_TRANSLATIONS).map((lang) => [lang, phraseMapFor(lang)])
);

export const templateTextOverridesFor = (data = {}, lang = data.lang || '') => {
  const overrides = data?.template_translations ?? data?.templateTranslations ?? data?.translations;
  const forLanguage = overrides && typeof overrides === 'object' ? overrides[lang] || overrides : null;
  return forLanguage && typeof forLanguage === 'object' ? forLanguage : {};
};

/* Translate prose but never the merge contract. A template can contain both
   "{{reference}}" and "{Tour Designer}" in a sentence; those are restored
   byte-for-byte after the surrounding words have been replaced. */
export const translateTemplateText = (text, lang, overrides = {}) => {
  const source = String(text ?? '');
  if (!isTranslatedDocument(lang) || !source.trim()) return source;

  const map = new Map(PHRASE_MAPS[lang] || []);
  Object.entries(overrides).forEach(([english, translated]) => {
    if (translated) map.set(String(english).trim().toLowerCase(), String(translated));
  });
  if (!map.size) return source;

  const placeholders = [];
  const protectedText = source.replace(/(\{\{[\s\S]*?\}\}|\{[^{}]{1,80}\})/g, (token) => {
    placeholders.push(token);
    return `\uE000${placeholders.length - 1}\uE001`;
  });

  const translated = [...map.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((value, [english, target]) => {
      const startsWord = /[\p{L}\p{N}]/u.test(english[0] || '');
      const endsWord = /[\p{L}\p{N}]/u.test(english[english.length - 1] || '');
      const pattern = new RegExp(
        `${startsWord ? '\\b' : ''}${escapeRegExp(english)}${endsWord ? '\\b' : ''}`,
        'gi'
      );
      return value.replace(pattern, (matched) => matchesCaseOf(matched, target));
    }, protectedText);

  return translated.replace(/\uE000(\d+)\uE001/g, (full, index) => placeholders[Number(index)] ?? full);
};

const decodeXml = (value) => String(value ?? '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const encodeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const TEXT_NODE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

/* Translate each text run separately. That keeps bold labels, coloured policy
   headings, table cells, headers and footers exactly as the template authored
   them - only the printable words change. */
export const translateDocxTemplateXml = (xml, lang, data = {}) => {
  if (!isTranslatedDocument(lang)) return String(xml ?? '');
  const overrides = templateTextOverridesFor(data, lang);
  return String(xml ?? '').replace(TEXT_NODE, (match, attributes, content) => {
    const decoded = decodeXml(content);
    const translated = translateTemplateText(decoded, lang, overrides);
    return translated === decoded ? match : `<w:t${attributes}>${encodeXml(translated)}</w:t>`;
  });
};

export const translateDocxTemplatePartsInZip = (zip, lang, data = {}) => {
  if (!isTranslatedDocument(lang)) return 0;
  const parts = zip.file(/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i);
  let changed = 0;
  parts.forEach((part) => {
    const translated = translateDocxTemplateXml(part.asText(), lang, data);
    if (translated !== part.asText()) {
      /* PizZip file lookups are read-only; writing by name updates the part. */
      zip.file(part.name, translated);
      changed += 1;
    }
  });
  return changed;
};
