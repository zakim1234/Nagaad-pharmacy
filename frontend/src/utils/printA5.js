// Prints the current page using an A5 page size. @page rules can't be
// scoped by a CSS selector, so we inject one just before printing and
// remove it right after — regular (report) prints stay unaffected.
export function printA5() {
  const style = document.createElement('style');
  style.id = 'a5-print-style';
  style.textContent = '@page { size: A5; margin: 8mm; }';
  document.head.appendChild(style);

  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  window.print();
}
