import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import Button from './ui/Button.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { sendPdfOnWhatsApp } from '../utils/sharePdf.js';

// "WhatsApp PDF": sends the page's printable document (#print-area, or
// `targetId`) as a PDF to `phone` on WhatsApp.
export default function SharePdfButton({ targetId = 'print-area', fileName, phone, message, orientation = 'portrait', label = 'WhatsApp PDF', className = '' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const el = document.getElementById(targetId);
    if (!el) return toast.error('Nothing to send yet.');
    setBusy(true);
    try {
      const result = await sendPdfOnWhatsApp(el, { fileName, phone, message, orientation });
      if (result === 'downloaded') toast.success('PDF downloaded — WhatsApp is opening; attach the file there.');
    } catch {
      toast.error('Could not create the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="secondary" onClick={send} loading={busy} className={className}>
      <MessageCircle className="h-4 w-4 text-emerald-600" /> {label}
    </Button>
  );
}
