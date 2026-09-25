// Strings de la GUI, en español y centralizados (decisión D3 del plan).

export const es = {
  app: {
    name: 'herdr',
    session: 'Sesión',
    sessionUnknown: 'sesión',
    version: 'herdr {version} · protocolo {protocol}',
  },
  connection: {
    connecting: 'conectando…',
    online: 'en línea',
    offline: 'desconectado',
    offlineDetail: 'sin conexión con el servidor herdr',
    latency: '{ms} ms',
    startServer: 'Iniciar servidor',
  },
  titlebar: {
    palette: 'Buscar…',
    minimize: 'Minimizar',
    maximize: 'Maximizar',
    restore: 'Restaurar',
    close: 'Cerrar',
  },
  palette: {
    title: 'Paleta de acciones',
    comingSoon: 'La paleta de acciones llega en F2. Aquí vivirá Ctrl+Shift+P.',
    close: 'Cerrar la paleta',
  },
  sidebar: {
    workspaces: 'Espacios',
    agents: 'Agentes',
    noWorkspaces: 'Sin espacios. Crea uno con Ctrl+B … (F1)',
    noAgents: 'Sin agentes activos',
    emptyState: 'Esperando al servidor…',
    panesCount: '{n} paneles',
  },
  statusbar: {
    pane: 'panel',
    cwd: 'cwd',
    scroll: 'scroll {offset}/{max}',
    frames: 'frames {n}',
    noPane: 'sin panel enfocado',
  },
  agentStatus: {
    idle: 'inactivo',
    working: 'trabajando',
    blocked: 'bloqueado',
    done: 'listo',
    unknown: 'desconocido',
  },
  terminal: {
    closed: 'La terminal se desconectó ({reason}).',
    retake: 'Retomar control',
    reconnecting: 'Reconectando…',
    connecting: 'Conectando terminal…',
    controlledByOther: 'Controlado por otra conexión',
    noPane: 'No hay ningún panel enfocado en esta sesión.',
  },
  errors: {
    // Anexo C del plan.
    not_found: 'Ya no existe (se cerró o cambió de id). Actualicé la vista.',
    invalid_params: 'Datos inválidos: {message}',
    agent_blocked: 'El agente está esperando tu respuesta. Revísalo antes de enviar otro prompt.',
    agent_prompt_stalled: 'El agente no reaccionó en 5 s. Comprueba que esté listo.',
    stream_conflict: 'Otra conexión ya controla esa capa.',
    popup_not_open: 'No hay ningún popup abierto.',
    transport: 'No hay conexión con el servidor herdr (sesión {session}). ¿Está corriendo?',
    timeout: 'herdr no respondió a tiempo ({method}).',
    bridge_closed: 'La terminal se desconectó ({reason}).',
    bridge_exit: 'La terminal se cerró inesperadamente.',
    unsupported: 'Esta versión de herdr no soporta «{method}».',
    unknown: 'Error inesperado: {message}',
  },
} as const;

export type Strings = typeof es;
