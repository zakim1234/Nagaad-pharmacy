// Turns a printable document on the page into a PDF and sends it on
// WhatsApp. Where the browser can share files (phones, and Chrome/Edge on
// Windows through the share sheet) the PDF is attached directly; otherwise
// it is downloaded and WhatsApp opens on the person's number, ready for the
// file to be attached. The PDF libraries load only when first used.

const A4 = { portrait: { w: 210, h: 297, px: 794 }, landscape: { w: 297, h: 210, px: 1123 } };
const MARGIN_MM = 10;

// Somali numbers come as "+252 61…", "061…" or "61…"; wa.me needs the
// full international number, digits only.
export function whatsappNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `252${d.slice(1)}`;
  if (d.length <= 9) d = `252${d}`;
  return d;
}

// A copy of the element laid out at A4 width, with screen-only parts
// removed and print-only parts shown.
function printableClone(element, widthPx) {
  const clone = element.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('.no-print, .print\\:hidden').forEach((n) => n.remove());
  for (const n of [clone, ...clone.querySelectorAll('*')]) {
    const cls = n.classList;
    if (!cls) continue;
    if ([...cls].some((c) => /^print:(block|flex|grid|table|inline|inline-block|table-row|table-cell)$/.test(c))) cls.remove('hidden');
    // Wide tables keep a scroll width on screen; on paper they must fit.
    if (cls.contains('overflow-x-auto')) n.style.overflow = 'visible';
    if ([...cls].some((c) => c.startsWith('min-w-'))) n.style.minWidth = '0';
  }
  Object.assign(clone.style, { maxWidth: 'none', width: '100%', margin: '0', border: '0', borderRadius: '0', boxShadow: 'none', opacity: '1' });
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', left: '-10000px', top: '0', width: `${widthPx}px`, padding: '28px', background: '#ffffff', zIndex: '-1' });
  box.appendChild(clone);
  document.body.appendChild(box);
  return box;
}

export async function buildPdf(element, { orientation = 'portrait' } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const page = A4[orientation] || A4.portrait;
  const box = printableClone(element, page.px);
  try {
    await document.fonts?.ready;
    await Promise.all(
      [...box.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))
    );
    const canvas = await html2canvas(box, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const contentW = page.w - MARGIN_MM * 2;
    const contentH = page.h - MARGIN_MM * 2;
    const pxPerMm = canvas.width / contentW;
    const sliceH = Math.floor(contentH * pxPerMm);
    for (let y = 0, i = 0; y < canvas.height; y += sliceH, i += 1) {
      const h = Math.min(sliceH, canvas.height - y);
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (i > 0) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, contentW, h / pxPerMm);
    }
    return pdf.output('blob');
  } finally {
    box.remove();
  }
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Returns 'shared' (attached through the share sheet), 'cancelled', or
// 'downloaded' (saved; WhatsApp opened to attach it).
export async function sendPdfOnWhatsApp(element, { fileName, phone, message = '', orientation } = {}) {
  const blob = await buildPdf(element, { orientation });
  const name = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text: message });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other failure: fall through to download + WhatsApp link.
    }
  }
  download(blob, name);
  const number = whatsappNumber(phone);
  const text = `${message}${message ? '\n' : ''}(${name})`;
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return 'downloaded';
}
