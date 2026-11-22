/* Browser-side renderer for a merged DOCX used as the PDF base.

   docxtemplater and the label merge produce real Word bytes; docx-preview lays
   those bytes out as HTML. Rendering is done in the app document first and the
   finished markup/styles are copied into the print window. Rendering directly
   into a second window made docx-preview build its nodes in the wrong document,
   which produced a blank print preview for some templates. */

import { ITINERARY_DOCX_MIME_TYPE } from './itineraryTemplateData';

const CLASS_NAME = 'torbuilder-docx';

/* docx-preview injects a grey padded wrapper for on-screen reading. That is
   useful in the app but must not become part of the printed page. */
const PRINT_CSS = `
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .${CLASS_NAME}-wrapper { background: #fff !important; padding: 0 !important; margin: 0 !important; display: block !important; }
  section.${CLASS_NAME} { box-shadow: none !important; margin: 0 !important; }
`;

const offScreenStyle = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';

const waitForImages = (root) => {
  const images = Array.from(root?.querySelectorAll('img') || []);
  return Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
};

/* Kept separate from the popup so the render can be verified without printing.
   The two containers are removed again in `finally`; the app page is untouched. */
export const renderItineraryDocxMarkup = async ({ bytes } = {}) => {
  if (!bytes) throw new Error('The merged Word template could not be read.');

  const bodyContainer = document.createElement('div');
  const styleContainer = document.createElement('div');
  bodyContainer.setAttribute('aria-hidden', 'true');
  styleContainer.setAttribute('aria-hidden', 'true');
  bodyContainer.style.cssText = offScreenStyle;
  styleContainer.style.cssText = offScreenStyle;
  document.body.appendChild(bodyContainer);
  document.body.appendChild(styleContainer);

  try {
    const { renderAsync } = await import('docx-preview');
    const blob = new Blob([bytes], { type: ITINERARY_DOCX_MIME_TYPE });
    await renderAsync(blob, bodyContainer, styleContainer, {
      className: CLASS_NAME,
      inWrapper: true,
      hideWrapperOnPrint: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true
    });

    if (!bodyContainer.innerHTML.trim()) {
      throw new Error('The template rendered as an empty document.');
    }

    return { body: bodyContainer.innerHTML, styles: styleContainer.innerHTML };
  } finally {
    bodyContainer.remove();
    styleContainer.remove();
  }
};

export const openItineraryDocxPrintWindow = async ({ bytes, title = 'Itinerary' } = {}) => {
  /* Open synchronously so the click's pop-up permission is retained while the
     Word layout is rendered asynchronously below. */
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) throw new Error('Please allow pop-ups to export the PDF');

  try {
    const markup = await renderItineraryDocxMarkup({ bytes });
    const safeTitle = String(title || 'Itinerary')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${PRINT_CSS}${markup.styles}</style></head><body>${markup.body}</body></html>`);
    win.document.close();

    await waitForImages(win.document.body);
    await win.document.fonts?.ready;
    win.focus();
    setTimeout(() => win.print(), 300);
  } catch (error) {
    win.close();
    throw error;
  }
};
