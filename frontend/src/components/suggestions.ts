import { attrPaths } from "./AttributesEditor";
import type { SuggestionGroup } from "./CodeArea";
import type { ComputedField, ComputedValue } from "../types";

/**
 * Что предлагать в шаблоне описания по правой кнопке.
 *
 * Списком идёт ровно то, что у этой сущности (или типа) реально есть: пути
 * атрибутов, объявленные формулы и особые переменные. Мастеру не нужно помнить
 * ни имена, ни синтаксис двойных скобок.
 */

/** Переменные, которые есть у любой сущности помимо её атрибутов. */
const SPECIAL: { label: string; snippet: string; hint: string }[] = [
  { label: "label", snippet: "{{ label }}", hint: "название сущности" },
  { label: "тип", snippet: "{{ тип }}", hint: "название типа" },
  { label: "лидер", snippet: "{{ лидер }}", hint: "основной игрок" },
  {
    label: "игроки",
    snippet: '{{ игроки | строки("{имя} — {роль}") }}',
    hint: "список с ролями",
  },
  { label: "игроки (сколько)", snippet: "{{ игроки | сколько }}", hint: "число игроков" },
  {
    label: "родители",
    snippet: '{{ родители | строки("{название} ({тип})") }}',
    hint: "во что входит (иерархия)",
  },
  {
    label: "дети",
    snippet: '{{ дети | строки("{название}") }}',
    hint: "что включает (иерархия)",
  },
];

export function buildSuggestions({
  attributes,
  computed,
  values,
  relationTypes = [],
}: {
  attributes: Record<string, unknown>;
  /** Объявленные формулы — типовые и собственные вместе. */
  computed: ComputedField[];
  /** Посчитанные значения: показываем их подсказкой справа в меню. */
  values?: ComputedValue[];
  /** Типы связей проекта: из них собираются `связи.союзник` и т.п. */
  relationTypes?: string[];
}): SuggestionGroup[] {
  const byPath = new Map((values ?? []).map((v) => [v.path, v]));
  const groups: SuggestionGroup[] = [];

  const paths = attrPaths(attributes);
  if (paths.length > 0) {
    groups.push({
      title: "Атрибуты",
      items: paths.map((path) => ({ label: path, snippet: `{{ ${path} }}` })),
    });
  }

  const fields = computed.filter((field) => field.path.trim());
  if (fields.length > 0) {
    groups.push({
      title: "Вычисляемые",
      items: fields.map((field) => ({
        label: field.path,
        snippet: `{{ выч.${field.path} }}`,
        hint: byPath.get(field.path)?.text || field.label,
      })),
    });
    // Ветка целиком: печатает все свои поля с подписями.
    const roots = [...new Set(fields.map((f) => f.path.split(".")[0]))].filter((root) =>
      fields.some((f) => f.path.startsWith(`${root}.`)),
    );
    if (roots.length > 0) {
      groups.push({
        title: "Ветки формул",
        items: roots.map((root) => ({
          label: `${root} — все поля`,
          snippet: `{{ выч.${root} | поля }}`,
        })),
      });
    }
  }

  if (relationTypes.length > 0) {
    groups.push({
      title: "Связи",
      // И взаимные («союзник»), и иерархические: по типу видны и те и другие.
      items: relationTypes.map((type) => ({
        label: type,
        // Тип связи может быть с пробелом («член организации») — берём по ключу.
        snippet: `{{ связи['${type}'] | строки("{название}") }}`,
      })),
    });
  }

  groups.push({ title: "Особые", items: SPECIAL });
  return groups;
}
