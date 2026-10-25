// Apertura de links del terminal. xterm llama a este handler al activar un link
// (clic normal del provider de URLs y `linkHandler` para los OSC 8).
//
// `appGrabsMouse` lo decide el pool con el MISMO gating que la rueda y el ratón
// sintético (`agentPane`): en un pane con agente detectado el clic normal va a
// la app (la GUI le reenvía el ratón como SGR), así que el link se abre con
// Ctrl+clic (o Cmd+clic), como en la mayoría de terminales. En un pane normal el
// clic abre el link. NO se usa `terminal.modes.mouseTrackingMode`: los DECSET de
// ratón no llegan en los frames del bridge, así que ahí siempre sería 'none'.

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
  appGrabsMouse: boolean,
): void {
  if (appGrabsMouse && !linkModifierPressed(event)) return;
  void openUrl(uri).catch((error: unknown) => {
    console.warn(`[herdr-desk] no se pudo abrir el link ${uri}`, error);
  });
}
