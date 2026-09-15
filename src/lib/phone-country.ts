/**
 * Inferencia de país a partir del teléfono, para usarse SOLO como respaldo
 * cuando no hay dato explícito.
 *
 * Advertencia de diseño, deliberada y no negociable: **un teléfono dice dónde se
 * compró la SIM, no qué calendario de feriados aplica.** Alguien de Nicaragua que
 * se mudó a la oficina de Costa Rica y conservó su +505 recibiría feriados
 * nicaragüenses estando en Costa Rica — le aparece feriado un día laboral y el
 * cron lo omite. Por eso esto es una *inferencia etiquetada*, no un dato: el
 * consumidor guarda de dónde salió el país (`countrySource`) para que RRHH pueda
 * auditar y corregir.
 *
 * Centroamérica sale limpia porque cada código es de un solo país, sin solapes.
 * Nada de rangos ambiguos tipo +1, que cubre Estados Unidos, Canadá y el Caribe:
 * si alguna vez hace falta, va con su propia lógica y no acá.
 */

/** Códigos de un solo país donde VLA tiene o podría tener gente. */
const PREFIX_ISO: Array<[string, string]> = [
  ['506', 'CR'], // Costa Rica
  ['505', 'NI'], // Nicaragua
  ['507', 'PA'], // Panamá
  ['502', 'GT'], // Guatemala
  ['503', 'SV'], // El Salvador
  ['504', 'HN'], // Honduras
  ['501', 'BZ'], // Belice
  ['52',  'MX'], // México
  ['57',  'CO'], // Colombia
  ['58',  'VE'], // Venezuela
  ['593', 'EC'], // Ecuador
  ['51',  'PE'], // Perú
  ['56',  'CL'], // Chile
  ['54',  'AR'], // Argentina
  ['34',  'ES'], // España
];

// Más largo primero: '506' tiene que ganarle a '50' si algún día se agrega uno corto
// que sea prefijo de otro. Se ordena una vez, al cargar el módulo.
const PREFIXES_BY_LENGTH = [...PREFIX_ISO].sort((a, b) => b[0].length - a[0].length);

/** Solo los dígitos. `+506 8888-8888` → `50688888888`. */
export function digitsOf(raw: string): string {
  return (raw ?? '').replace(/\D+/g, '');
}

/**
 * ¿El número viene en formato internacional? Solo confiamos en el prefijo cuando
 * el número lo trae explícito: un local tico de 8 dígitos no tiene nada que leer,
 * y leerle los primeros 3 daría un país inventado.
 */
export function hasInternationalPrefix(raw: string): boolean {
  const s = (raw ?? '').trim();
  if (s.startsWith('+') || s.startsWith('00')) return true;
  // Sin '+' explícito, un número de 10+ dígitos puede traer el código de país
  // pegado. No lo asumimos: es justo el caso que produce adivinanzas silenciosas.
  return false;
}

/**
 * País ISO alpha-2 inferido del teléfono, o `null` si no se puede afirmar.
 *
 * Devuelve `null` —y no una coincidencia aproximada— cuando el número está en
 * formato local o el prefijo no está en la tabla. Un `null` honesto cae al país
 * por defecto, que es visiblemente genérico; un país equivocado no se nota.
 */
export function countryFromPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!hasInternationalPrefix(raw)) return null;

  let digits = digitsOf(raw);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  for (const [prefix, iso] of PREFIXES_BY_LENGTH) {
    if (digits.startsWith(prefix)) return iso;
  }
  return null;
}

export type PhoneShape =
  | 'international'   // trae + o 00 y un prefijo que reconocemos
  | 'international-unknown-prefix'
  | 'local'           // solo dígitos, sin código de país
  | 'empty';

/**
 * Clasifica la *forma* del número sin exponer el número.
 * Es lo que reporta el diagnóstico: sirve para decidir si la inferencia vale la
 * pena, sin volcar teléfonos de empleados en una respuesta HTTP.
 */
export function phoneShape(raw: string | null | undefined): PhoneShape {
  if (!raw || !digitsOf(raw)) return 'empty';
  if (!hasInternationalPrefix(raw)) return 'local';
  return countryFromPhone(raw) ? 'international' : 'international-unknown-prefix';
}

/**
 * Prefijo reconocido, para la distribución del diagnóstico. `null` si no aplica.
 * Nunca devuelve dígitos del número más allá del código de país.
 */
export function prefixOf(raw: string | null | undefined): string | null {
  if (!raw || !hasInternationalPrefix(raw)) return null;
  let digits = digitsOf(raw);
  if (digits.startsWith('00')) digits = digits.slice(2);
  for (const [prefix] of PREFIXES_BY_LENGTH) {
    if (digits.startsWith(prefix)) return `+${prefix}`;
  }
  return null;
}
