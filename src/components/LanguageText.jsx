import { useState } from 'react';
import { SOURCE_LANGUAGE, languageOf, setLocalizedText, translationOf } from '../lib/i18n';

/* One prose field, in as many languages as the tenant has switched on.

   The English box is always the one on screen: it is the source every document
   falls back to, so hiding it behind a tab would let an operator edit a
   translation and lose the text the untranslated lines still print. The other
   languages sit on a compact strip underneath and only open one at a time.

   A language box deliberately shows what has actually been typed - never the
   English behind it. Showing the fallback would make an empty Portuguese box
   look translated and the operator would leave it alone, and the document would
   print English words to a Portuguese client.

   A tenant with nothing but English gets a plain textarea and no trace of any
   of this. */
export default function LanguageText({
  label,
  field,
  value = '',
  onChange,
  translations,
  onTranslationsChange,
  languages = [SOURCE_LANGUAGE],
  placeholder = '',
  minHeight = '80px',
  rows,
  ariaLabel,
  inputClassName = 'pricing-select',
  style,
  readOnly = false
}) {
  const [open, setOpen] = useState(null);
  const translated = (languages || []).filter((code) => code && code !== SOURCE_LANGUAGE);
  const active = translated.includes(open) ? open : null;
  const row = { [field]: value, text_i18n: translations };
  const editable = Boolean(field) && typeof onTranslationsChange === 'function';
  const inputStyle = { minHeight, fontFamily: 'inherit', padding: '0.75rem', ...style };

  if (!translated.length || !editable) {
    return (
      <textarea
        className={inputClassName}
        style={inputStyle}
        rows={rows}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return (
    <div className="language-text">
      {label ? <label className="language-text-label">{label}</label> : null}
      <textarea
        className={inputClassName}
        style={inputStyle}
        rows={rows}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value ?? ''}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <div className="language-text-tabs" role="group" aria-label="Translations">
        <span className="language-text-source">English (source)</span>
        {translated.map((code) => {
          const filled = Boolean(translationOf(row, field, code));
          return (
            <button
              key={code}
              type="button"
              className={`language-text-tab${active === code ? ' active' : ''}${filled ? ' filled' : ''}`}
              title={languageOf(code).label + (filled ? ' — translated' : ' — prints the English text until translated')}
              onClick={() => setOpen(active === code ? null : code)}
            >
              {code.toUpperCase()}
              <span className={`language-text-dot${filled ? ' on' : ''}`} />
            </button>
          );
        })}
      </div>
      {active ? (
        <div className="language-text-panel">
          <textarea
            className={inputClassName}
            style={inputStyle}
            rows={rows}
            aria-label={ariaLabel ? `${ariaLabel} (${languageOf(active).label})` : undefined}
            readOnly={readOnly}
            placeholder={`${languageOf(active).label} — leave empty and this line prints in English`}
            value={translationOf(row, field, active)}
            onChange={(event) => onTranslationsChange(setLocalizedText(row, field, active, event.target.value))}
          />
        </div>
      ) : null}
    </div>
  );
}
