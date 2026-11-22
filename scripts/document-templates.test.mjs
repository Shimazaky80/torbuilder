import {
  DOCUMENT_TEMPLATE_MAX_BYTES,
  DOCUMENT_TEMPLATE_TYPES,
  documentTemplateFileError,
  documentTemplateFileSizeLabel,
  documentTemplateRowPayload,
  documentTemplateStoragePath,
  documentTemplateTypeLabel,
  isDocumentTemplateTableMissing,
  normalizeDocumentTemplate,
  normalizeDocumentTemplateType,
  safeTemplateFileName
} from '../src/lib/documentTemplates.js';

let failures = 0;
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(stable(actual)) === JSON.stringify(stable(expected));
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(stable(actual))}, expected ${JSON.stringify(stable(expected))}`);
};

console.log('\n--- Running Document Templates Verification Tests ---\n');

check('the four document types are offered', DOCUMENT_TEMPLATE_TYPES.map((entry) => entry.id), ['itinerary', 'voucher', 'invoice', 'travel_document']);
check('type labels read as spoken', DOCUMENT_TEMPLATE_TYPES.map((entry) => entry.label), ['Itinerary', 'Voucher', 'Invoice', 'Travel document']);
check('an unknown type falls back to itinerary', normalizeDocumentTemplateType('Passport'), 'itinerary');
check('an unknown type still has a readable label', documentTemplateTypeLabel('Passport'), 'Document');

check('a PDF is accepted', documentTemplateFileError({ name: 'Brand.pdf', size: 1024 }), null);
check('a Word document is accepted', documentTemplateFileError({ name: 'Brand.docx', size: 1024 }), null);
check('an old Word document is accepted', documentTemplateFileError({ name: 'Brand.doc', size: 1024 }), null);
check('a spreadsheet is not a document template', documentTemplateFileError({ name: 'Brand.xlsx', size: 1024 }), 'Only PDF and Word documents (.pdf, .doc, .docx) can be used as templates.');
check('no file is rejected', documentTemplateFileError(null), 'Choose a template document.');
check('an empty file is rejected', documentTemplateFileError({ name: 'Brand.pdf', size: 0 }), 'That file is empty. Choose a complete template document.');
check('a file over the limit is rejected', documentTemplateFileError({ name: 'Brand.pdf', size: DOCUMENT_TEMPLATE_MAX_BYTES + 1 }), 'Template documents must be 30 MB or smaller.');
check('the limit is inclusive', documentTemplateFileError({ name: 'Brand.pdf', size: DOCUMENT_TEMPLATE_MAX_BYTES }), null);

check('a name keeps its extension', safeTemplateFileName('Company Itinerary.docx'), 'Company_Itinerary.docx');
check('a Windows path cannot leave the tenant folder', safeTemplateFileName('C:\\secret\\Brand.pdf'), 'Brand.pdf');
check('a Unix traversal cannot leave the tenant folder', safeTemplateFileName('../../Brand.pdf'), 'Brand.pdf');
check('punctuation is collapsed into the file name', safeTemplateFileName('Brand & Co (2026).pdf'), 'Brand_Co_2026.pdf');
check('a nameless upload still gets a usable file name', safeTemplateFileName(''), 'template');
check('a long name cannot overflow the storage path', safeTemplateFileName(`${'x'.repeat(200)}.pdf`).length, 120);

check('the storage path starts with the company folder', documentTemplateStoragePath({ companyId: 'tenant-1', fileName: 'Brand.pdf', stamp: 123 }), 'tenant-1/document-templates/123_Brand.pdf');
check('a bad tenant fails closed', (() => {
  try { documentTemplateStoragePath({ companyId: '', fileName: 'Brand.pdf' }); return 'no error'; }
  catch (error) { return error.message; }
})(), 'Your tenant workspace could not be resolved. Please sign in again.');

const upload = { url: 'https://example.test/brand.pdf', path: 'tenant-1/document-templates/123_Brand.pdf', fileName: 'Brand.pdf', fileSize: 2048, mimeType: 'application/pdf' };
const payload = documentTemplateRowPayload({
  companyId: 'tenant-1',
  form: { name: '  Branded itinerary  ', documentType: 'itinerary', isDefault: true, isActive: false },
  upload,
  updatedAt: '2026-11-22T00:00:00.000Z'
});
check('a row payload carries the tenant and file', payload.company_id, 'tenant-1');
check('a row payload trims the template name', payload.name, 'Branded itinerary');
check('a row payload stores the storage path as well as the URL', [payload.file_url, payload.file_path], [upload.url, upload.path]);
check('a default template is forced active in the payload', [payload.is_default, payload.is_active], [true, true]);

const inactive = documentTemplateRowPayload({ companyId: 'tenant-1', form: { name: 'Old', documentType: 'passport' }, updatedAt: '2026-11-22T00:00:00.000Z' });
check('an unstated active flag stays active', inactive.is_active, true);
check('an unstated default stays off', inactive.is_default, false);
check('an unknown document type cannot reach the database', inactive.document_type, 'itinerary');

check('a stored row is normalised for the card', normalizeDocumentTemplate({
  id: '1', name: 'Voucher', document_type: 'voucher', is_default: 1, is_active: 0
}), {
  id: '1', name: 'Voucher', document_type: 'voucher', file_url: '', file_path: '', file_name: '',
  is_default: false, is_active: true
});
check('a genuine default is kept', normalizeDocumentTemplate({ id: '2', is_default: true, is_active: true }).is_default, true);

check('a missing table is recognised by code', isDocumentTemplateTableMissing({ code: '42P01', message: 'relation does not exist' }), true);
check('a missing PostgREST table is recognised', isDocumentTemplateTableMissing({ code: 'PGRST205', message: 'not in schema cache' }), true);
check('an unrelated error is not hidden', isDocumentTemplateTableMissing({ code: '42501', message: 'permission denied' }), false);

check('small files read in bytes', documentTemplateFileSizeLabel(512), '512 B');
check('kilobytes round to whole numbers', documentTemplateFileSizeLabel(2048), '2 KB');
check('megabytes keep one decimal', documentTemplateFileSizeLabel(2.5 * 1024 * 1024), '2.5 MB');

if (failures) {
  console.error(`\n${failures} document template checks failed.`);
  process.exit(1);
}
console.log('\nAll document template checks passed.');
