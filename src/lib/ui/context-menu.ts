// Supresión del menú de contexto NATIVO (WebView2) en toda la app.
//
// El WebView2 ofrece su propio menú en cualquier zona que no lo cancele:
// «Actualizar, Guardar como, Imprimir, Recargar, Inspeccionar…». La GUI tiene sus
// propios menús glass (terminal, paneles, pestañas, espacios), así que el nativo
// sobra en TODA la superficie de la app.
//
// Un único listener en fase de CAPTURA resuelve los huecos:
//   - corre antes que los handlers propios, que siguen recibiendo el evento;
//   - solo hace `preventDefault` (sin `stopPropagation`), de modo que los menús
//     de la app se abren igual (y además ellos ya llaman a preventDefault);
//   - no toca `mousedown`/`mouseup`, así que el pegado con botón central, la
//     selección de texto del terminal y los atajos (Ctrl+C/Ctrl+V) no cambian.

/**
 * Instala la supresión. Devuelve la función para retirarla (tests y desmontaje).
 */
export function suppressNativeContextMenu(target: EventTarget = window): () => void {
  const handler = (event: Event): void => {
    event.preventDefault();
  };
  target.addEventListener('contextmenu', handler, true);
  return () => target.removeEventListener('contextmenu', handler, true);
}
