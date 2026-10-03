// Prints the current page as an A4 business report. Orientation is chosen
// per report (wide tables print landscape, narrower summaries print
// portrait) by injecting a scoped @page rule right before printing, mirroring
// the approach used for the A5 invoice/receipt so the two never collide.
export function printReport(orientation = 'portrait') {
  const style = document.createElement('style');
  style.id = 'a4-print-style';
  style.textContent = `@page { size: A4 ${orientation}; margin: 14mm 12mm; }`;
  document.head.appendChild(style);

  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  window.print();
}
