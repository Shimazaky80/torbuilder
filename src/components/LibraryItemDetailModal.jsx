import { X, Tag, Calendar, Users, DollarSign, FileText, FileSpreadsheet, Download } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { libraryItemDetail, detailDocumentHtml } from '../lib/libraryItemDetail';

/* A read-only view of everything a library item can be priced at, across every season at
   once. The directory row deliberately shows a single season, stepped with arrows, because
   the table has room for one figure; this surface is where the whole rate card is read
   without opening (and risking an accidental edit of) the item.

   What is shown is decided by the category, not by which columns happen to hold a number:
   a transfer prints its per-vehicle / per-pax-tier / per-person figure under the basis it
   was loaded with, a meal prints per person, a guide prints per trip. The same model also
   feeds the Word / Excel / PDF export, so the downloaded card matches the screen. */

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700,
  color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '5px',
  padding: '0.12rem 0.45rem', marginRight: '0.35rem', marginBottom: '0.35rem'
};

const headStyle = {
  fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
  color: '#64748b', marginBottom: '0.3rem'
};

const exportBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.74rem', fontWeight: 700,
  color: '#0d7478', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px',
  padding: '0.3rem 0.55rem', cursor: 'pointer'
};

const CHIP_ICONS = { category: Tag, supplier: Users, currency: DollarSign };

const Section = ({ title, children }) => (
  <div style={{ marginTop: '0.7rem' }}>
    <div style={headStyle}>{title}</div>
    {children}
  </div>
);

const Row = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', padding: '0.15rem 0', borderBottom: '1px dashed #eef2f7' }}>
    <span style={{ color: '#64748b' }}>{label}</span>
    <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>{value}</span>
  </div>
);

const downloadBlob = (content, filename, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'library-item';

const LibraryItemDetailModal = ({ item, vehicleTypes = [], onClose }) => {
  const { showToast } = useToast();
  const detail = libraryItemDetail({ item, vehicleTypes });

  const exportAs = (format) => {
    const html = detailDocumentHtml(detail);
    const base = `library-${slug(detail.name)}${detail.identifierCode ? `-${slug(detail.identifierCode)}` : ''}`;
    if (format === 'pdf') {
      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) {
        showToast('Allow pop-ups to export the rate card as PDF', 'warning');
        return;
      }
      printWindow.document.write(html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body>'));
      printWindow.document.close();
      return;
    }
    if (format === 'word') {
      downloadBlob(html, `${base}.doc`, 'application/msword');
      return;
    }
    downloadBlob(html, `${base}.xls`, 'application/vnd.ms-excel');
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1003, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ background: '#fff', borderRadius: '12px', width: 'min(880px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#0f172a' }}>
              {detail.name}{detail.identifierCode ? <span style={{ color: '#0d7478' }}> {'\u2014'} {detail.identifierCode}</span> : ''}
            </h3>
            <div style={{ marginTop: '0.4rem' }}>
              {detail.chips.map((chip) => {
                const Icon = CHIP_ICONS[chip.kind];
                return (
                  <span key={`${chip.kind}-${chip.text}`} style={chipStyle}>
                    {Icon && <Icon size={12} />} {chip.text}
                  </span>
                );
              })}
            </div>
            {detail.facts.length > 0 && (
              <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#475569', marginTop: '0.55rem' }}>
                {detail.facts.map((fact) => (
                  <span key={fact.label}><strong>{fact.label}:</strong> {fact.value}</span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.35rem', flexWrap: 'wrap', flexShrink: 0 }}>
            <button type="button" style={exportBtnStyle} onClick={() => exportAs('word')} title="Export the rate card as Word">
              <FileText size={13} /> Word
            </button>
            <button type="button" style={exportBtnStyle} onClick={() => exportAs('excel')} title="Export the rate card as Excel">
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button type="button" style={exportBtnStyle} onClick={() => exportAs('pdf')} title="Export the rate card as PDF">
              <Download size={13} /> PDF
            </button>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
          </div>
        </div>

        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
          {detail.empty && (
            <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              No rates have been recorded for this item yet. Add a season in the editor and every pricing figure will appear here.
            </div>
          )}

          {detail.seasons.map((season) => (
            <div key={season.key} style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem 0.95rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>{season.title}</div>
                <div>
                  {season.chips.map((chip, index) => (
                    <span key={chip} style={chipStyle}>{index === 0 && <Calendar size={12} />} {chip}</span>
                  ))}
                </div>
              </div>

              {season.sections.map((section) => (
                <Section key={section.key} title={section.title}>
                  {section.note && <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.2rem' }}>{section.note}</div>}
                  {section.rows.map((row, index) => (
                    <Row key={`${row.label}-${index}`} label={row.label} value={row.value} />
                  ))}
                </Section>
              ))}

              {season.notes && (
                <Section title="Notes">
                  <div style={{ fontSize: '0.8rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{season.notes}</div>
                </Section>
              )}
            </div>
          ))}

          {detail.carRental.length > 0 && (
            <Section title="Car rental rates">
              {detail.carRental.map((group) => (
                <div key={group.key} style={{ marginTop: '0.5rem', border: '1px solid #99f6e4', borderRadius: '10px', padding: '0.7rem 0.85rem' }}>
                  <div style={{ fontWeight: 800, color: '#0e7490', fontSize: '0.88rem' }}>{group.title}</div>
                  {group.chips.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.15rem 0 0.35rem' }}>{group.chips.join(' \u00b7 ')}</div>
                  )}
                  {group.rows.map((row, index) => (
                    <Row key={`${row.label}-${index}`} label={row.label} value={row.value} />
                  ))}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryItemDetailModal;
