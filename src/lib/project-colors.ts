/**
 * Paleta curada de "color de acento por proyecto" (Fase F2, estilo VS Code "Peacock" — le da
 * "sentido de lugar" a cada proyecto en el sidebar/header). NO es un selector de color libre: son
 * 12 colores fijos de la escala default de Tailwind v4 + la opción "sin color" (neutro = `null`,
 * sin dot/borde/badge, el look de siempre).
 *
 * **Fuente de verdad única**: los `id` (`PROJECT_COLOR_IDS`) son el string que se persiste en
 * `projects.color` (columna agregada por `supabase/migrations/20260709200000_project_color.sql`,
 * con un `CHECK` que debe listar EXACTAMENTE estos mismos 12 valores) y el que se manda por la API
 * de sync a un futuro cliente desktop (`D:\Repo\AudioTranscriber`, WPF/.NET — repo separado, no
 * este). Los ids son en inglés, semánticos y estables a propósito (portables entre plataformas);
 * los `label` en español son solo para la UI web.
 *
 * **Convención de clases** (mirror EXACTO de la relación `--accent`/`--accent-subtle`/
 * `--accent-subtle-text` light/dark que ya estableció F0 en `src/app/globals.css` para la marca —
 * ver esa migración de tokens para el precedente): para cada color, light = family-600 sólido /
 * dark = family-400 sólido (dot y borde, mismo peso); badge = fondo pálido family-50 + texto
 * family-700 en light, fondo translúcido family-500 al 18% + texto family-200 en dark. Ese ratio
 * fue el elegido para `--accent`/`--accent-subtle` (indigo: 600/400 sólido, 50/rgb(99 102 241/18%)
 * de fondo, 700/200 de texto) y acá se reproduce igual para las otras 11 familias.
 *
 * Las clases están escritas como strings LITERALES completos (no `` `bg-${family}-600` ``) a
 * propósito: el content scanner de Tailwind v4 solo detecta clases que aparecen como texto
 * literal en el código, no armadas por interpolación en runtime.
 *
 * **Para un dev de desktop que necesite el hex exacto de cada shade**: Tailwind v4 define sus
 * colores en OKLCH (no hex) — los valores de abajo son los que resuelve
 * `node_modules/tailwindcss` (`require("tailwindcss/colors")`) para esta versión, verificados
 * (no adivinados). Convertilos a hex/sRGB con cualquier conversor OKLCH→hex si tu stack los
 * necesita en ese formato:
 *
 * | id      | family  | 600 (light acento/borde/dot)      | 400 (dark acento/borde/dot)        | 50 (light badge bg)                | 500 (dark badge bg @18%)            | 700 (light badge texto)            | 200 (dark badge texto)             |
 * |---------|---------|------------------------------------|-------------------------------------|-------------------------------------|--------------------------------------|--------------------------------------|--------------------------------------|
 * | red     | red     | oklch(57.7% 0.245 27.325)          | oklch(70.4% 0.191 22.216)           | oklch(97.1% 0.013 17.38)            | oklch(63.7% 0.237 25.331)            | oklch(50.5% 0.213 27.518)            | oklch(88.5% 0.062 18.334)            |
 * | orange  | orange  | oklch(64.6% 0.222 41.116)          | oklch(75% 0.183 55.934)             | oklch(98% 0.016 73.684)             | oklch(70.5% 0.213 47.604)            | oklch(55.3% 0.195 38.402)            | oklch(90.1% 0.076 70.697)            |
 * | amber   | amber   | oklch(66.6% 0.179 58.318)          | oklch(82.8% 0.189 84.429)           | oklch(98.7% 0.022 95.277)           | oklch(76.9% 0.188 70.08)             | oklch(55.5% 0.163 48.998)            | oklch(92.4% 0.12 95.746)             |
 * | green   | green   | oklch(62.7% 0.194 149.214)         | oklch(79.2% 0.209 151.711)          | oklch(98.2% 0.018 155.826)          | oklch(72.3% 0.219 149.579)           | oklch(52.7% 0.154 150.069)           | oklch(92.5% 0.084 155.995)           |
 * | teal    | teal    | oklch(60% 0.118 184.704)           | oklch(77.7% 0.152 181.912)          | oklch(98.4% 0.014 180.72)           | oklch(70.4% 0.14 182.503)            | oklch(51.1% 0.096 186.391)           | oklch(91% 0.096 180.426)             |
 * | cyan    | cyan    | oklch(60.9% 0.126 221.723)         | oklch(78.9% 0.154 211.53)           | oklch(98.4% 0.019 200.873)          | oklch(71.5% 0.143 215.221)           | oklch(52% 0.105 223.128)             | oklch(91.7% 0.08 205.041)            |
 * | blue    | blue    | oklch(54.6% 0.245 262.881)         | oklch(70.7% 0.165 254.624)          | oklch(97% 0.014 254.604)            | oklch(62.3% 0.214 259.815)           | oklch(48.8% 0.243 264.376)           | oklch(88.2% 0.059 254.128)           |
 * | indigo  | indigo  | oklch(51.1% 0.262 276.966)         | oklch(67.3% 0.182 276.935)          | oklch(96.2% 0.018 272.314)          | oklch(58.5% 0.233 277.117)           | oklch(45.7% 0.24 277.023)            | oklch(87% 0.065 274.039)             |
 * | violet  | violet  | oklch(54.1% 0.281 293.009)         | oklch(70.2% 0.183 293.541)          | oklch(96.9% 0.016 293.756)          | oklch(60.6% 0.25 292.717)            | oklch(49.1% 0.27 292.581)            | oklch(89.4% 0.057 293.283)           |
 * | purple  | purple  | oklch(55.8% 0.288 302.321)         | oklch(71.4% 0.203 305.504)          | oklch(97.7% 0.014 308.299)          | oklch(62.7% 0.265 303.9)             | oklch(49.6% 0.265 301.924)           | oklch(90.2% 0.063 306.703)           |
 * | pink    | pink    | oklch(59.2% 0.249 0.584)           | oklch(71.8% 0.202 349.761)          | oklch(97.1% 0.014 343.198)          | oklch(65.6% 0.241 354.308)           | oklch(52.5% 0.223 3.958)             | oklch(89.9% 0.061 343.231)           |
 * | rose    | rose    | oklch(58.6% 0.253 17.585)          | oklch(71.2% 0.194 13.428)           | oklch(96.9% 0.015 12.422)           | oklch(64.5% 0.246 16.439)            | oklch(51.4% 0.222 16.935)            | oklch(89.2% 0.058 10.001)            |
 *
 * (500 se incluye porque el fondo del badge en dark es `{family}-500` al 18% de opacidad, no un
 * sólido — ver la clase `badge` de cada entrada más abajo.)
 */

/** Los 12 ids válidos, en el mismo orden que se muestran en el picker. Única fuente de verdad —
 * el `CHECK` de la migración de `projects.color` debe listar EXACTAMENTE estos mismos valores. */
export const PROJECT_COLOR_IDS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "purple",
  "pink",
  "rose",
] as const;

export type ProjectColorId = (typeof PROJECT_COLOR_IDS)[number];

export type ProjectColorDef = {
  id: ProjectColorId;
  /** Nombre en español para la UI (picker, tooltips). */
  label: string;
  /** Círculo sólido chico (fila del sidebar). */
  dot: string;
  /** Borde izquierdo de acento (fila del sidebar), mismo peso de color que `dot`. */
  border: string;
  /** Fondo + texto de la franja/badge del header. NUNCA usar como fondo full-bleed detrás de
   * texto de cuerpo — está pensado para una franja fina o un badge/pill chico. */
  badge: string;
};

/**
 * Paleta completa. Clases literales (ver nota arriba sobre el content scanner de Tailwind).
 * pink y rose son visualmente parecidos en Tailwind — por eso tienen labels bien distintos
 * ("Rosa" vs "Coral") para que el picker no sea ambiguo.
 */
export const PROJECT_COLORS: readonly ProjectColorDef[] = [
  {
    id: "red",
    label: "Rojo",
    dot: "bg-red-600 dark:bg-red-400",
    border: "border-red-600 dark:border-red-400",
    badge: "bg-red-50 text-red-700 dark:bg-red-400/18 dark:text-red-200",
  },
  {
    id: "orange",
    label: "Naranja",
    dot: "bg-orange-600 dark:bg-orange-400",
    border: "border-orange-600 dark:border-orange-400",
    badge: "bg-orange-50 text-orange-700 dark:bg-orange-400/18 dark:text-orange-200",
  },
  {
    id: "amber",
    label: "Ámbar",
    dot: "bg-amber-600 dark:bg-amber-400",
    border: "border-amber-600 dark:border-amber-400",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-400/18 dark:text-amber-200",
  },
  {
    id: "green",
    label: "Verde",
    dot: "bg-green-600 dark:bg-green-400",
    border: "border-green-600 dark:border-green-400",
    badge: "bg-green-50 text-green-700 dark:bg-green-400/18 dark:text-green-200",
  },
  {
    id: "teal",
    label: "Turquesa",
    dot: "bg-teal-600 dark:bg-teal-400",
    border: "border-teal-600 dark:border-teal-400",
    badge: "bg-teal-50 text-teal-700 dark:bg-teal-400/18 dark:text-teal-200",
  },
  {
    id: "cyan",
    label: "Celeste",
    dot: "bg-cyan-600 dark:bg-cyan-400",
    border: "border-cyan-600 dark:border-cyan-400",
    badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/18 dark:text-cyan-200",
  },
  {
    id: "blue",
    label: "Azul",
    dot: "bg-blue-600 dark:bg-blue-400",
    border: "border-blue-600 dark:border-blue-400",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-400/18 dark:text-blue-200",
  },
  {
    id: "indigo",
    label: "Índigo",
    dot: "bg-indigo-600 dark:bg-indigo-400",
    border: "border-indigo-600 dark:border-indigo-400",
    badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/18 dark:text-indigo-200",
  },
  {
    id: "violet",
    label: "Violeta",
    dot: "bg-violet-600 dark:bg-violet-400",
    border: "border-violet-600 dark:border-violet-400",
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-400/18 dark:text-violet-200",
  },
  {
    id: "purple",
    label: "Púrpura",
    dot: "bg-purple-600 dark:bg-purple-400",
    border: "border-purple-600 dark:border-purple-400",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-400/18 dark:text-purple-200",
  },
  {
    id: "pink",
    label: "Rosa",
    dot: "bg-pink-600 dark:bg-pink-400",
    border: "border-pink-600 dark:border-pink-400",
    badge: "bg-pink-50 text-pink-700 dark:bg-pink-400/18 dark:text-pink-200",
  },
  {
    id: "rose",
    label: "Coral",
    dot: "bg-rose-600 dark:bg-rose-400",
    border: "border-rose-600 dark:border-rose-400",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-400/18 dark:text-rose-200",
  },
];

const PROJECT_COLORS_BY_ID = new Map<ProjectColorId, ProjectColorDef>(PROJECT_COLORS.map((c) => [c.id, c]));

/** Type guard: `true` solo si `value` es exactamente uno de los 12 ids válidos. */
export function isProjectColorId(value: unknown): value is ProjectColorId {
  return typeof value === "string" && PROJECT_COLORS_BY_ID.has(value as ProjectColorId);
}

/**
 * Valida un color propuesto (ej. viniendo de un `FormData` o de un argumento de server action, sin
 * confiar en el tipo) contra la allowlist. Cualquier valor inválido (incluido `null`/`undefined`/
 * string vacío) cae a `null` = "sin color" — nunca a un color por default, porque acá "sin color"
 * ES el default explícito del feature (ver spec F2: siempre incluir la opción neutra).
 */
export function resolveProjectColorId(input: unknown): ProjectColorId | null {
  return isProjectColorId(input) ? input : null;
}

/** Busca la definición completa por id. `null`/id desconocido → `null` (nunca lanza). */
export function getProjectColor(id: string | null | undefined): ProjectColorDef | null {
  if (!id) return null;
  return PROJECT_COLORS_BY_ID.get(id as ProjectColorId) ?? null;
}
