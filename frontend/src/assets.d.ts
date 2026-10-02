/** Vite resuelve las imágenes importadas a su URL final (con el base del plugin). */
declare module '*.png' {
  const url: string;
  export default url;
}
