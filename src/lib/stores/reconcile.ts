// T1.4 — Reconciliación por id: el snapshot de herdr se reemplaza entero cada vez
// que hay un evento, pero la UI no debe remontar nada. `reconcileById` conserva la
// identidad de los objetos que siguen existiendo (y muta sus campos en sitio) y
// solo crea objetos nuevos para las altas.

export interface ReconcileStats {
  /** Claves nuevas. */
  added: number;
  /** Claves que ya no están. */
  removed: number;
  /** Claves que siguen y cambiaron algún campo. */
  changed: number;
  /** Claves que siguen igual. */
  unchanged: number;
  /** true si el orden relativo de las claves que siguen cambió. */
  reordered: boolean;
  /** true si el resultado no es idéntico al array anterior (agregado). */
  dirty: boolean;
}

export interface ReconcileResult<T> {
  items: T[];
  stats: ReconcileStats;
}

export interface ReconcileOptions<T extends object> {
  current: readonly T[];
  next: readonly T[];
  key: (item: T) => string;
  /** Muta `target` con los campos de `source`. Por defecto copia las claves propias. */
  assign?: (target: T, source: T) => void;
  /** ¿Son iguales en contenido? Por defecto compara las claves propias. */
  equals?: (a: T, b: T) => boolean;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Copia las claves propias de `source` sobre `target`, borrando las que sobran. */
export function defaultAssign<T extends object>(target: T, source: T): void {
  const targetRecord = target as Record<string, unknown>;
  const sourceRecord = source as Record<string, unknown>;
  for (const key of Object.keys(sourceRecord)) {
    if (targetRecord[key] !== sourceRecord[key]) targetRecord[key] = sourceRecord[key];
  }
  for (const key of Object.keys(targetRecord)) {
    if (!(key in sourceRecord)) delete targetRecord[key];
  }
}

export function defaultEquals<T extends object>(a: T, b: T): boolean {
  return stableValue(a) === stableValue(b);
}

export function reconcileById<T extends object>(options: ReconcileOptions<T>): ReconcileResult<T> {
  const { current, next, key } = options;
  const assign = options.assign ?? defaultAssign;
  const equals = options.equals ?? defaultEquals;

  const previousByKey = new Map<string, T>();
  for (const item of current) {
    const itemKey = key(item);
    // Con claves repetidas (herdr no las manda) gana la primera, que es la que
    // seguiría pintada en un `{#each}` con key.
    if (!previousByKey.has(itemKey)) previousByKey.set(itemKey, item);
  }

  const items: T[] = [];
  const seen = new Set<string>();
  const orderBefore: string[] = [];
  for (const item of current) {
    const itemKey = key(item);
    if (!seen.has(itemKey)) {
      seen.add(itemKey);
      orderBefore.push(itemKey);
    }
  }

  const stats: ReconcileStats = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    reordered: false,
    dirty: false,
  };

  const orderAfter: string[] = [];
  for (const incoming of next) {
    const incomingKey = key(incoming);
    // Claves repetidas en la entrada: gana la última (herdr nunca las manda).
    const existingIndex = items.findIndex((item) => key(item) === incomingKey);
    const existing = existingIndex === -1 ? previousByKey.get(incomingKey) : items[existingIndex];
    orderAfter.push(incomingKey);

    if (!existing) {
      items.push(incoming);
      stats.added += 1;
      stats.dirty = true;
      continue;
    }
    if (existing === incoming) {
      if (existingIndex === -1) items.push(existing);
      stats.unchanged += 1;
      continue;
    }
    if (equals(existing, incoming)) {
      if (existingIndex === -1) items.push(existing);
      stats.unchanged += 1;
      continue;
    }
    assign(existing, incoming);
    stats.changed += 1;
    stats.dirty = true;
    if (existingIndex === -1) items.push(existing);
  }

  const keysAfter = new Set(orderAfter);
  for (const previousKey of orderBefore) {
    if (!keysAfter.has(previousKey)) stats.removed += 1;
  }
  if (stats.removed > 0) stats.dirty = true;

  const survivorBefore = orderBefore.filter((itemKey) => keysAfter.has(itemKey));
  const survivorAfter = orderAfter.filter((itemKey) => previousByKey.has(itemKey));
  if (survivorBefore.join('\u0000') !== survivorAfter.join('\u0000')) {
    stats.reordered = true;
    stats.dirty = true;
  }

  return { items, stats };
}
