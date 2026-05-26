// Registro del Service Worker para PWA.
// Cargado con defer desde cada HTML para no bloquear el primer paint.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function(err) {
      // Falla silenciosa: la app igual funciona online sin el SW.
      console.warn('SW no se pudo registrar:', err);
    });
  });
}
