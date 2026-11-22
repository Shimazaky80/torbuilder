/* Document Templates settings.

   A template is a branded source document (PDF or Word) that a company keeps
   alongside its other documents. This module owns the small, testable rules:
   which files may be uploaded, where a tenant's file goes, and how a stored row
   is shaped. The storage bucket is the existing public "contracts" bucket - its
   tenant policy already limits the first path segment to the signed-in
   company's UUID, so no new bucket is needed.

   The layout engine that consumes the default template is a later release.
   Nothing here claims an uploaded file already changes generated documents. */

export const DOCUMENT_TEMPLATE_TYPES = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'voucher', label: 'Voucher' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'travel_document', label: 'Travel document' }
];

export const DOCUMENT_TEMPLATE_MAX_BYTES = 30 * 1024 * 1024;
export const DOCUMENT_TEMPLATE_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
].join(',');

export const DOCUMENT_TEMPLATE_FIELDS = [
  'id',
  'company_id',
  'name',
  'document_type',
  'file_url',
  'file_path',
  'file_name',
  'file_size',
  'mime_type',
  'is_default',
  'is_active',
  'created_at',
  'updated_at'
].join(',');

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx'];

const extensionOf = (name) => {
  const match = String(name || '').match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].slice(1).toLowerCase() : '';
};

export const documentTemplateTypeLabel = (type) => DOCUMENT_TEMPLATE_TYPES.find((entry) => entry.id === type)?.label || 'Document';

export const normalizeDocumentTemplateType = (type) => (
  DOCUMENT_TEMPLATE_TYPES.some((entry) => entry.id === type) ? type : 'itinerary'
);

/* Keep the original name whenever possible, but never let it escape the
   tenant folder. A Windows path, a Unix path, a traversal attempt and punctuation
   all collapse to one safe file name inside the company's own directory. */
export const safeTemplateFileName = (value) => {
  const raw = String(value ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  const extension = extensionOf(raw);
  const stem = extension ? raw.slice(0, raw.length - extension.length - 1) : raw;
  const cleaned = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');
  const suffix = extension ? `.${extension}` : '';
  const maxStem = Math.max(1, 120 - suffix.length);
  const trimmed = cleaned.slice(0, maxStem).replace(/[._-]+$/, '');
  return `${trimmed || 'template'}${suffix}`;
};

export const documentTemplateFileError = (file) => {
  if (!file || typeof file !== 'object') return 'Choose a template document.';
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return 'Only PDF and Word documents (.pdf, .doc, .docx) can be used as templates.';
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return 'That file is empty. Choose a complete template document.';
  if (size > DOCUMENT_TEMPLATE_MAX_BYTES) return 'Template documents must be 30 MB or smaller.';
  return null;
};

export const documentTemplateStoragePath = ({ companyId, fileName, stamp = Date.now() } = {}) => {
  const tenant = String(companyId ?? '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!tenant) throw new Error('Your tenant workspace could not be resolved. Please sign in again.');
  return `${tenant}/document-templates/${stamp}_${safeTemplateFileName(fileName)}`;
};

export const documentTemplateRowPayload = ({ companyId, form = {}, upload = {}, updatedAt = new Date().toISOString() } = {}) => {
  const isDefault = form.isDefault === true;
  return {
    company_id: companyId,
    name: String(form.name ?? '').trim(),
    document_type: normalizeDocumentTemplateType(form.documentType),
    file_url: upload.url || '',
    file_path: upload.path || '',
    file_name: upload.fileName || '',
    file_size: Number(upload.fileSize) || 0,
    mime_type: upload.mimeType || '',
    is_default: isDefault,
    is_active: isDefault || form.isActive !== false,
    updated_at: updatedAt
  };
};

export const normalizeDocumentTemplate = (row) => ({
  ...row,
  name: row?.name || '',
  document_type: normalizeDocumentTemplateType(row?.document_type),
  file_url: row?.file_url || '',
  file_path: row?.file_path || '',
  file_name: row?.file_name || '',
  is_default: row?.is_default === true,
  is_active: row?.is_active !== false
});

/* An operator who has not applied the migration yet still gets the rest of
   Settings. Only the template card reports the missing table. */
export const isDocumentTemplateTableMissing = (error) => {
  if (!error) return false;
  if (['42P01', 'PGRST205'].includes(String(error.code || ''))) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('document_templates')
    && (message.includes('schema cache') || message.includes('does not exist') || message.includes('not found'));
};

export const documentTemplateFileSizeLabel = (bytes) => {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
};
