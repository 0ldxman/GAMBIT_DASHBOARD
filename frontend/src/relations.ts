/**
 * Виды связей, которые в ВПИ встречаются чаще всего.
 *
 * Списки открытые: тип связи — свободная строка, мастер вписывает свой. Нужны
 * они для двух вещей — подсказок в поле ввода и того, чтобы знакомый тип сам
 * ставил галочку «родитель → дочерняя»: «состав» почти всегда иерархия, а
 * «союзник» почти всегда взаимен.
 */
export const HIERARCHY_TYPES = ["состав", "член организации", "вассал", "подразделение"];
export const MUTUAL_TYPES = ["союзник", "война", "враг", "торговый партнёр", "нейтралитет"];
export const PRESETS = [...MUTUAL_TYPES, ...HIERARCHY_TYPES];

/** Иерархия ли это по названию: true / false / null, если тип незнакомый. */
export function isHierarchyType(type: string): boolean | null {
  const key = type.trim().toLowerCase();
  if (HIERARCHY_TYPES.includes(key)) return true;
  if (MUTUAL_TYPES.includes(key)) return false;
  return null;
}
