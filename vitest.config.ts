import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Se incluye `frontend/src` para los módulos PUROS del frontend
    // (`calendar.ts`): la aritmética de fechas del calendario de feriados es
    // justo donde el corrimiento de zona pasó desapercibido dos veces, y no
    // necesita DOM para probarse. Los componentes .tsx siguen fuera — eso
    // pediría jsdom y no hay ninguno todavía.
    include: ['src/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'frontend/dist/**', 'frontend/node_modules/**'],
  },
});
