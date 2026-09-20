// Run on the original Tech Help page, in its original browser profile.
// Reads one storage key; does not send data or alter localStorage.
(() => {
  const raw = window.localStorage.getItem('ovth-pipeline');
  const packet = { version: 1, origin: location.origin, storageKey: 'ovth-pipeline', capturedAt: new Date().toISOString(), raw };
  const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'PARADIZE-tech-help-browser-export.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
})();
