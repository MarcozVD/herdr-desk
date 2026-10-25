// Apertura de links del terminal. xterm llama a este handler al activar un link
// (clic normal del provider de URLs y `linkHandler` para los OSC 8).
//
// Si la app del panel tiene mouse tracking activo, el clic normal va a la app
// (xterm le reporta el ratón); para no robarle el gesto, el link se abre con
// Ctrl+clic (o Cmd+clic), como en la mayoría de terminales. Sin mouse tracking,
// el clic normal abre el link.

import { openUrl } from '@tauri-apps/plugin-opener';

/** ¿El evento trae el modificador que fuerza abrir el link? */
export function linkModifierPressed(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * Abre `uri` con el navegador del sistema. El fallo de `openUrl` NO se traga: se
 * registra en consola para poder diagnosticar el scope/capability del plugin
 * opener en la app real (antes quedaba invisible).
 */
export function openTerminalLink(
  event: { ctrlKey: boolean; metaKey: boolean },
  uri: string,
  mouseTracking: boolean,
): void {
  if (mouseTracking && !linkModifierPressed(event)) return;
  void openUrl(uri).catch((error: unknown) => {
    console.warn(`[herdr-desk] no se pudo abrir el link ${uri}`, error);
  });
}
