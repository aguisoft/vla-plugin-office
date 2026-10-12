import { describe, it, expect } from 'vitest';
import { configCorreo, armarCorreo, REMITENTE_POR_DEFECTO } from './correo-aviso';

describe('configCorreo', () => {
  const base = { CORREO_HOST: 'email-smtp.us-east-1.amazonaws.com', CORREO_USUARIO: 'AKIA', CORREO_CLAVE: 'x' };
  it('sin host, usuario o clave no hay correo', () => {
    expect(configCorreo({})).toBeNull();
    expect(configCorreo({ ...base, CORREO_CLAVE: '' })).toBeNull();
  });
  it('por defecto: puerto 465 con SSL y el remitente de la oficina', () => {
    expect(configCorreo(base)).toEqual({ host: base.CORREO_HOST, port: 465, secure: true, user: 'AKIA', pass: 'x', from: REMITENTE_POR_DEFECTO });
  });
  it('587 va con STARTTLS salvo que se pida SSL; el SSL explícito manda', () => {
    expect(configCorreo({ ...base, CORREO_PUERTO: '587' })?.secure).toBe(false);
    expect(configCorreo({ ...base, CORREO_PUERTO: 465, CORREO_SSL: 'false' })?.secure).toBe(false);
    expect(configCorreo({ ...base, CORREO_REMITENTE: 'Otra <x@y.com>' })?.from).toBe('Otra <x@y.com>');
  });
});

describe('armarCorreo', () => {
  it('asunto = título; el texto y el botón llevan al sistema', () => {
    const c = armarCorreo({ titulo: 'Solicitud de tu equipo', cuerpo: 'Ana pidió vacaciones del 26 al 30 oct', url: '/dashboard/office?solicitudes=1' }, 'https://system.somosvla.com/');
    expect(c.asunto).toBe('Solicitud de tu equipo');
    expect(c.texto).toContain('Ana pidió vacaciones del 26 al 30 oct');
    expect(c.texto).toContain('https://system.somosvla.com/dashboard/office?solicitudes=1');
    expect(c.html).toContain('href="https://system.somosvla.com/dashboard/office?solicitudes=1"');
  });
  it('escapa el HTML de lo que escribió la persona', () => {
    const c = armarCorreo({ titulo: 'x', cuerpo: 'Motivo: <script>alert(1)</script> & "eso"' }, 'https://s.com');
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;eso&quot;');
  });
  it('sin url abre la oficina', () => {
    expect(armarCorreo({ titulo: 't', cuerpo: '' }, 'https://s.com').texto).toContain('https://s.com/dashboard/office');
  });
});
