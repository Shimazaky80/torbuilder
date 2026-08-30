-- =============================================================================
-- Migration: Full World Currencies Seed
-- Adds country and country_code columns to app_currencies (if not present)
-- then upserts all ISO 4217 currencies safely (no TRUNCATE, FK-safe)
-- =============================================================================

-- Step 1: Extend the table with country metadata columns
ALTER TABLE public.app_currencies
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS country_code  CHAR(2);   -- ISO 3166-1 alpha-2

-- Step 2: Upsert all world currencies (safe even with foreign key references)
INSERT INTO public.app_currencies (code, symbol, name, country, country_code, is_default, is_active)
VALUES
  -- A
  ('AED', 'د.إ',  'UAE Dirham',                               'United Arab Emirates',       'AE', FALSE, TRUE),
  ('AFN', '؋',   'Afghan Afghani',                            'Afghanistan',                'AF', FALSE, TRUE),
  ('ALL', 'L',   'Albanian Lek',                              'Albania',                    'AL', FALSE, TRUE),
  ('AMD', '֏',   'Armenian Dram',                             'Armenia',                    'AM', FALSE, TRUE),
  ('ANG', 'ƒ',   'Netherlands Antillean Guilder',             'Netherlands Antilles',       'AN', FALSE, TRUE),
  ('AOA', 'Kz',  'Angolan Kwanza',                            'Angola',                     'AO', FALSE, TRUE),
  ('ARS', '$',   'Argentine Peso',                            'Argentina',                  'AR', FALSE, TRUE),
  ('AUD', 'A$',  'Australian Dollar',                         'Australia',                  'AU', FALSE, TRUE),
  ('AWG', 'ƒ',   'Aruban Florin',                             'Aruba',                      'AW', FALSE, TRUE),
  ('AZN', '₼',   'Azerbaijani Manat',                         'Azerbaijan',                 'AZ', FALSE, TRUE),
  -- B
  ('BAM', 'KM',  'Bosnia-Herzegovina Convertible Mark',       'Bosnia and Herzegovina',     'BA', FALSE, TRUE),
  ('BBD', 'Bds$','Barbadian Dollar',                          'Barbados',                   'BB', FALSE, TRUE),
  ('BDT', '৳',   'Bangladeshi Taka',                          'Bangladesh',                 'BD', FALSE, TRUE),
  ('BGN', 'лв',  'Bulgarian Lev',                             'Bulgaria',                   'BG', FALSE, TRUE),
  ('BHD', 'BD',  'Bahraini Dinar',                            'Bahrain',                    'BH', FALSE, TRUE),
  ('BIF', 'Fr',  'Burundian Franc',                           'Burundi',                    'BI', FALSE, TRUE),
  ('BMD', '$',   'Bermudian Dollar',                          'Bermuda',                    'BM', FALSE, TRUE),
  ('BND', 'B$',  'Brunei Dollar',                             'Brunei',                     'BN', FALSE, TRUE),
  ('BOB', 'Bs',  'Bolivian Boliviano',                        'Bolivia',                    'BO', FALSE, TRUE),
  ('BRL', 'R$',  'Brazilian Real',                            'Brazil',                     'BR', FALSE, TRUE),
  ('BSD', 'B$',  'Bahamian Dollar',                           'Bahamas',                    'BS', FALSE, TRUE),
  ('BTN', 'Nu',  'Bhutanese Ngultrum',                        'Bhutan',                     'BT', FALSE, TRUE),
  ('BWP', 'P',   'Botswana Pula',                             'Botswana',                   'BW', FALSE, TRUE),
  ('BYN', 'Br',  'Belarusian Ruble',                          'Belarus',                    'BY', FALSE, TRUE),
  ('BZD', 'BZ$', 'Belize Dollar',                             'Belize',                     'BZ', FALSE, TRUE),
  -- C
  ('CAD', 'CA$', 'Canadian Dollar',                           'Canada',                     'CA', FALSE, TRUE),
  ('CDF', 'Fr',  'Congolese Franc',                           'Democratic Republic of Congo','CD', FALSE, TRUE),
  ('CHF', 'Fr',  'Swiss Franc',                               'Switzerland',                'CH', FALSE, TRUE),
  ('CLP', 'CLP$','Chilean Peso',                              'Chile',                      'CL', FALSE, TRUE),
  ('CNY', '¥',   'Chinese Yuan',                              'China',                      'CN', FALSE, TRUE),
  ('COP', 'COL$','Colombian Peso',                            'Colombia',                   'CO', FALSE, TRUE),
  ('CRC', '₡',   'Costa Rican Colón',                         'Costa Rica',                 'CR', FALSE, TRUE),
  ('CUP', '$',   'Cuban Peso',                                'Cuba',                       'CU', FALSE, TRUE),
  ('CVE', 'Esc', 'Cape Verdean Escudo',                       'Cape Verde',                 'CV', FALSE, TRUE),
  ('CZK', 'Kč',  'Czech Koruna',                              'Czech Republic',             'CZ', FALSE, TRUE),
  -- D
  ('DJF', 'Fr',  'Djiboutian Franc',                          'Djibouti',                   'DJ', FALSE, TRUE),
  ('DKK', 'kr',  'Danish Krone',                              'Denmark',                    'DK', FALSE, TRUE),
  ('DOP', 'RD$', 'Dominican Peso',                            'Dominican Republic',         'DO', FALSE, TRUE),
  ('DZD', 'دج',  'Algerian Dinar',                            'Algeria',                    'DZ', FALSE, TRUE),
  -- E
  ('EGP', 'ج.م', 'Egyptian Pound',                            'Egypt',                      'EG', FALSE, TRUE),
  ('ERN', 'Nkf', 'Eritrean Nakfa',                            'Eritrea',                    'ER', FALSE, TRUE),
  ('ETB', 'Br',  'Ethiopian Birr',                            'Ethiopia',                   'ET', FALSE, TRUE),
  ('EUR', '€',   'Euro',                                      'Eurozone',                   'EU', FALSE, TRUE),
  -- F
  ('FJD', 'FJ$', 'Fijian Dollar',                             'Fiji',                       'FJ', FALSE, TRUE),
  ('FKP', '£',   'Falkland Islands Pound',                    'Falkland Islands',           'FK', FALSE, TRUE),
  -- G
  ('GBP', '£',   'British Pound Sterling',                    'United Kingdom',             'GB', FALSE, TRUE),
  ('GEL', '₾',   'Georgian Lari',                             'Georgia',                    'GE', FALSE, TRUE),
  ('GHS', 'GH₵', 'Ghanaian Cedi',                             'Ghana',                      'GH', FALSE, TRUE),
  ('GIP', '£',   'Gibraltar Pound',                           'Gibraltar',                  'GI', FALSE, TRUE),
  ('GMD', 'D',   'Gambian Dalasi',                            'Gambia',                     'GM', FALSE, TRUE),
  ('GNF', 'Fr',  'Guinean Franc',                             'Guinea',                     'GN', FALSE, TRUE),
  ('GTQ', 'Q',   'Guatemalan Quetzal',                        'Guatemala',                  'GT', FALSE, TRUE),
  ('GYD', 'G$',  'Guyanese Dollar',                           'Guyana',                     'GY', FALSE, TRUE),
  -- H
  ('HKD', 'HK$', 'Hong Kong Dollar',                          'Hong Kong',                  'HK', FALSE, TRUE),
  ('HNL', 'L',   'Honduran Lempira',                          'Honduras',                   'HN', FALSE, TRUE),
  ('HRK', 'kn',  'Croatian Kuna',                             'Croatia',                    'HR', FALSE, TRUE),
  ('HTG', 'G',   'Haitian Gourde',                            'Haiti',                      'HT', FALSE, TRUE),
  ('HUF', 'Ft',  'Hungarian Forint',                          'Hungary',                    'HU', FALSE, TRUE),
  -- I
  ('IDR', 'Rp',  'Indonesian Rupiah',                         'Indonesia',                  'ID', FALSE, TRUE),
  ('ILS', '₪',   'Israeli New Shekel',                        'Israel',                     'IL', FALSE, TRUE),
  ('INR', '₹',   'Indian Rupee',                              'India',                      'IN', FALSE, TRUE),
  ('IQD', 'ع.د', 'Iraqi Dinar',                               'Iraq',                       'IQ', FALSE, TRUE),
  ('IRR', '﷼',   'Iranian Rial',                              'Iran',                       'IR', FALSE, TRUE),
  ('ISK', 'kr',  'Icelandic Króna',                           'Iceland',                    'IS', FALSE, TRUE),
  -- J
  ('JMD', 'J$',  'Jamaican Dollar',                           'Jamaica',                    'JM', FALSE, TRUE),
  ('JOD', 'JD',  'Jordanian Dinar',                           'Jordan',                     'JO', FALSE, TRUE),
  ('JPY', '¥',   'Japanese Yen',                              'Japan',                      'JP', FALSE, TRUE),
  -- K
  ('KES', 'KSh', 'Kenyan Shilling',                           'Kenya',                      'KE', FALSE, TRUE),
  ('KGS', 'лв',  'Kyrgyzstani Som',                           'Kyrgyzstan',                 'KG', FALSE, TRUE),
  ('KHR', '៛',   'Cambodian Riel',                            'Cambodia',                   'KH', FALSE, TRUE),
  ('KMF', 'Fr',  'Comorian Franc',                            'Comoros',                    'KM', FALSE, TRUE),
  ('KPW', '₩',   'North Korean Won',                          'North Korea',                'KP', FALSE, TRUE),
  ('KRW', '₩',   'South Korean Won',                          'South Korea',                'KR', FALSE, TRUE),
  ('KWD', 'KD',  'Kuwaiti Dinar',                             'Kuwait',                     'KW', FALSE, TRUE),
  ('KYD', 'CI$', 'Cayman Islands Dollar',                     'Cayman Islands',             'KY', FALSE, TRUE),
  ('KZT', '₸',   'Kazakhstani Tenge',                         'Kazakhstan',                 'KZ', FALSE, TRUE),
  -- L
  ('LAK', '₭',   'Lao Kip',                                   'Laos',                       'LA', FALSE, TRUE),
  ('LBP', 'L£',  'Lebanese Pound',                            'Lebanon',                    'LB', FALSE, TRUE),
  ('LKR', '₨',   'Sri Lankan Rupee',                          'Sri Lanka',                  'LK', FALSE, TRUE),
  ('LRD', 'L$',  'Liberian Dollar',                           'Liberia',                    'LR', FALSE, TRUE),
  ('LSL', 'L',   'Lesotho Loti',                              'Lesotho',                    'LS', FALSE, TRUE),
  ('LYD', 'LD',  'Libyan Dinar',                              'Libya',                      'LY', FALSE, TRUE),
  -- M
  ('MAD', 'MAD', 'Moroccan Dirham',                           'Morocco',                    'MA', FALSE, TRUE),
  ('MDL', 'L',   'Moldovan Leu',                              'Moldova',                    'MD', FALSE, TRUE),
  ('MGA', 'Ar',  'Malagasy Ariary',                           'Madagascar',                 'MG', FALSE, TRUE),
  ('MKD', 'ден', 'Macedonian Denar',                          'North Macedonia',            'MK', FALSE, TRUE),
  ('MMK', 'K',   'Myanmar Kyat',                              'Myanmar',                    'MM', FALSE, TRUE),
  ('MNT', '₮',   'Mongolian Tugrik',                          'Mongolia',                   'MN', FALSE, TRUE),
  ('MOP', 'P',   'Macanese Pataca',                           'Macau',                      'MO', FALSE, TRUE),
  ('MRU', 'UM',  'Mauritanian Ouguiya',                       'Mauritania',                 'MR', FALSE, TRUE),
  ('MUR', '₨',   'Mauritian Rupee',                           'Mauritius',                  'MU', FALSE, TRUE),
  ('MVR', 'Rf',  'Maldivian Rufiyaa',                         'Maldives',                   'MV', FALSE, TRUE),
  ('MWK', 'MK',  'Malawian Kwacha',                           'Malawi',                     'MW', FALSE, TRUE),
  ('MXN', 'Mex$','Mexican Peso',                              'Mexico',                     'MX', FALSE, TRUE),
  ('MYR', 'RM',  'Malaysian Ringgit',                         'Malaysia',                   'MY', FALSE, TRUE),
  ('MZN', 'MT',  'Mozambican Metical',                        'Mozambique',                 'MZ', FALSE, TRUE),
  -- N
  ('NAD', 'N$',  'Namibian Dollar',                           'Namibia',                    'NA', FALSE, TRUE),
  ('NGN', '₦',   'Nigerian Naira',                            'Nigeria',                    'NG', FALSE, TRUE),
  ('NIO', 'C$',  'Nicaraguan Córdoba',                        'Nicaragua',                  'NI', FALSE, TRUE),
  ('NOK', 'kr',  'Norwegian Krone',                           'Norway',                     'NO', FALSE, TRUE),
  ('NPR', '₨',   'Nepalese Rupee',                            'Nepal',                      'NP', FALSE, TRUE),
  ('NZD', 'NZ$', 'New Zealand Dollar',                        'New Zealand',                'NZ', FALSE, TRUE),
  -- O
  ('OMR', 'ر.ع.','Omani Rial',                                'Oman',                       'OM', FALSE, TRUE),
  -- P
  ('PAB', 'B/.',  'Panamanian Balboa',                        'Panama',                     'PA', FALSE, TRUE),
  ('PEN', 'S/.',  'Peruvian Sol',                             'Peru',                       'PE', FALSE, TRUE),
  ('PGK', 'K',   'Papua New Guinean Kina',                    'Papua New Guinea',           'PG', FALSE, TRUE),
  ('PHP', '₱',   'Philippine Peso',                           'Philippines',                'PH', FALSE, TRUE),
  ('PKR', '₨',   'Pakistani Rupee',                           'Pakistan',                   'PK', FALSE, TRUE),
  ('PLN', 'zł',  'Polish Zloty',                              'Poland',                     'PL', FALSE, TRUE),
  ('PYG', 'Gs',  'Paraguayan Guaraní',                        'Paraguay',                   'PY', FALSE, TRUE),
  -- Q
  ('QAR', 'ر.ق', 'Qatari Riyal',                              'Qatar',                      'QA', FALSE, TRUE),
  -- R
  ('RON', 'lei', 'Romanian Leu',                              'Romania',                    'RO', FALSE, TRUE),
  ('RSD', 'din', 'Serbian Dinar',                             'Serbia',                     'RS', FALSE, TRUE),
  ('RUB', '₽',   'Russian Ruble',                             'Russia',                     'RU', FALSE, TRUE),
  ('RWF', 'Fr',  'Rwandan Franc',                             'Rwanda',                     'RW', FALSE, TRUE),
  -- S
  ('SAR', '﷼',   'Saudi Riyal',                               'Saudi Arabia',               'SA', FALSE, TRUE),
  ('SBD', 'SI$', 'Solomon Islands Dollar',                    'Solomon Islands',            'SB', FALSE, TRUE),
  ('SCR', '₨',   'Seychellois Rupee',                         'Seychelles',                 'SC', FALSE, TRUE),
  ('SDG', 'ج.س.','Sudanese Pound',                            'Sudan',                      'SD', FALSE, TRUE),
  ('SEK', 'kr',  'Swedish Krona',                             'Sweden',                     'SE', FALSE, TRUE),
  ('SGD', 'S$',  'Singapore Dollar',                          'Singapore',                  'SG', FALSE, TRUE),
  ('SHP', '£',   'Saint Helena Pound',                        'Saint Helena',               'SH', FALSE, TRUE),
  ('SLL', 'Le',  'Sierra Leonean Leone',                      'Sierra Leone',               'SL', FALSE, TRUE),
  ('SOS', 'Sh',  'Somali Shilling',                           'Somalia',                    'SO', FALSE, TRUE),
  ('SRD', '$',   'Surinamese Dollar',                         'Suriname',                   'SR', FALSE, TRUE),
  ('SSP', '£',   'South Sudanese Pound',                      'South Sudan',                'SS', FALSE, TRUE),
  ('STN', 'Db',  'São Tomé and Príncipe Dobra',               'São Tomé and Príncipe',      'ST', FALSE, TRUE),
  ('SVC', '₡',   'Salvadoran Colón',                          'El Salvador',                'SV', FALSE, TRUE),
  ('SYP', '£',   'Syrian Pound',                              'Syria',                      'SY', FALSE, TRUE),
  ('SZL', 'L',   'Swazi Lilangeni',                           'Eswatini',                   'SZ', FALSE, TRUE),
  -- T
  ('THB', '฿',   'Thai Baht',                                 'Thailand',                   'TH', FALSE, TRUE),
  ('TJS', 'SM',  'Tajikistani Somoni',                        'Tajikistan',                 'TJ', FALSE, TRUE),
  ('TMT', 'T',   'Turkmenistani Manat',                       'Turkmenistan',               'TM', FALSE, TRUE),
  ('TND', 'DT',  'Tunisian Dinar',                            'Tunisia',                    'TN', FALSE, TRUE),
  ('TOP', 'T$',  'Tongan Paʻanga',                            'Tonga',                      'TO', FALSE, TRUE),
  ('TRY', '₺',   'Turkish Lira',                              'Turkey',                     'TR', FALSE, TRUE),
  ('TTD', 'TT$', 'Trinidad and Tobago Dollar',                'Trinidad and Tobago',        'TT', FALSE, TRUE),
  ('TWD', 'NT$', 'New Taiwan Dollar',                         'Taiwan',                     'TW', FALSE, TRUE),
  ('TZS', 'Sh',  'Tanzanian Shilling',                        'Tanzania',                   'TZ', FALSE, TRUE),
  -- U
  ('UAH', '₴',   'Ukrainian Hryvnia',                         'Ukraine',                    'UA', FALSE, TRUE),
  ('UGX', 'Sh',  'Ugandan Shilling',                          'Uganda',                     'UG', FALSE, TRUE),
  ('USD', '$',   'US Dollar',                                  'United States',              'US', TRUE,  TRUE),
  ('UYU', '$U',  'Uruguayan Peso',                            'Uruguay',                    'UY', FALSE, TRUE),
  ('UZS', '֏',   'Uzbekistani Som',                           'Uzbekistan',                 'UZ', FALSE, TRUE),
  -- V
  ('VES', 'Bs.S','Venezuelan Bolívar Soberano',               'Venezuela',                  'VE', FALSE, TRUE),
  ('VND', '₫',   'Vietnamese Dong',                           'Vietnam',                    'VN', FALSE, TRUE),
  ('VUV', 'Vt',  'Vanuatu Vatu',                              'Vanuatu',                    'VU', FALSE, TRUE),
  -- W
  ('WST', 'T',   'Samoan Tālā',                               'Samoa',                      'WS', FALSE, TRUE),
  -- X (Regional / supranational)
  ('XAF', 'Fr',  'Central African CFA Franc',                 'CEMAC Zone',                 'CM', FALSE, TRUE),
  ('XCD', 'EC$', 'East Caribbean Dollar',                     'Eastern Caribbean',          'AG', FALSE, TRUE),
  ('XOF', 'Fr',  'West African CFA Franc',                    'UEMOA Zone',                 'SN', FALSE, TRUE),
  ('XPF', 'Fr',  'CFP Franc',                                 'French Polynesia',           'PF', FALSE, TRUE),
  -- Y
  ('YER', '﷼',   'Yemeni Rial',                               'Yemen',                      'YE', FALSE, TRUE),
  -- Z
  ('ZAR', 'R',   'South African Rand',                        'South Africa',               'ZA', FALSE, TRUE),
  ('ZMW', 'ZK',  'Zambian Kwacha',                            'Zambia',                     'ZM', FALSE, TRUE),
  ('ZWL', '$',   'Zimbabwean Dollar',                         'Zimbabwe',                   'ZW', FALSE, TRUE)

ON CONFLICT (code) DO UPDATE
  SET
    symbol       = EXCLUDED.symbol,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    country_code = EXCLUDED.country_code,
    is_active    = EXCLUDED.is_active,
    updated_at   = NOW();
