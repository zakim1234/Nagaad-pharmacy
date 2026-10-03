// Prints the current page at a given page size. @page rules can't be scoped
// by a CSS selector, so we inject one just before printing and remove it
// right after -- other prints on the page stay unaffected.
export function printPage(size = 'A5', margin = '8mm') {
  const style = document.createElement('style');
  style.id = 'dynamic-print-style';
  style.textContent = `@page { size: ${size}; margin: ${margin}; }`;
  document.head.appendChild(style);

  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  window.print();
}
