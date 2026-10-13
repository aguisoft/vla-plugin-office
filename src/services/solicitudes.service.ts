import type { PluginContext } from '@vla/plugin-sdk';
import { validateAbsenceInput, findOverlap, type AbsenceInput, type AbsenceWindow } from '../lib/absence-validation';
import { absenceBounds } from '../lib/absence-bounds';
import type { ValidationError } from '../lib/status-rules';
import {
  valeMientrasPendiente, estadoInicial, puedeResolver, transicion,
  type EstadoSolicitud, type Accion,
} from '../lib/solicitudes';
import { nombresPorUsuario } from '../lib/user-names';
import type { AbsenceService } from './absence.service';

/**
 * Solicitudes de ausencia con aprobación (ver lib/solicitudes.ts y el spec
 * 2026-10-07-solicitudes-ausencias-design.md). La AbsenceRecord del core sigue
 * siendo lo que hace que alguien «esté ausente»; acá vive el ciclo.
 *
 * SQL con fechas como texto ISO y sin `ANY()`: `ctx.query` no tipa parámetros.
 */

export interface Solicitud {
  id: string;
  userId: string;
  tipo: string;
  startAt: string;
  endAt: string;
  justificacion: string | null;
  estado: EstadoSolicitud;
  absenceId: string | null;
  resueltaPor: string | null;
  resueltaEn: string | null;
  motivoResolucion: string | null;
  creadaPor: string;
  creadaEn: string;
  /** Nombre de quien la pidió (bandeja) y de quien la resolvió. */
  nombre?: string | null;
  nombreResolvio?: string | null;
}

interface Fila {
  id: string; user_id: string; tipo: string; start_at: Date | string; end_at: Date | string;
  justificacion: string | null; estado: EstadoSolicitud; absence_id: string | null;
  resuelta_por: string | null; resuelta_en: Date | string | null; motivo_resolucion: string | null;
  creada_por: string; creada_en: Date | string;
}

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

function aSolicitud(f: Fila): Solicitud {
  return {
    id: f.id, userId: f.user_id, tipo: f.tipo, startAt: iso(f.start_at)!, endAt: iso(f.end_at)!,
    justificacion: f.justificacion, estado: f.estado, absenceId: f.absence_id,
    resueltaPor: f.resuelta_por, resueltaEn: iso(f.resuelta_en), motivoResolucion: f.motivo_resolucion,
    creadaPor: f.creada_por, creadaEn: iso(f.creada_en)!,
  };
}

const COLUMNAS = `id, user_id, tipo, start_at, end_at, justificacion, estado, absence_id,
  resuelta_por, resuelta_en, motivo_resolucion, creada_por, creada_en`;

/** A quién se avisa y qué. La implementación (en vivo + Bitrix) la pone el plugin. */
export interface AvisosSolicitud {
  nueva(s: Solicitud, aprobadorId: string | null): Promise<void>;
  resuelta(s: Solicitud, porId: string): Promise<void>;
  /** RRHH la cargó por la persona: nace aprobada y la persona se entera por acá. */
  cargada?(s: Solicitud, porId: string): Promise<void>;
}

export interface Organigrama {
  managerOf(userId: string): Promise<string | null>;
  managedUserIds(viewerId: string): Promise<Set<string>>;
}

export type CrearResultado =
  | { ok: true; solicitud: Solicitud; aprobadorId: string | null; idAdjuntos: string }
  | { ok: false; errors: ValidationError[] }
  | { ok: false; conflict: AbsenceWindow };

export type ResolverResultado =
  | { ok: true; solicitud: Solicitud }
  | { ok: false; status: 403 | 404 | 409 | 400; message: string };

export class SolicitudesService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly absences: AbsenceService,
    private readonly org: Organigrama,
    private readonly avisos: AvisosSolicitud,
  ) {}

  /** Una solicitud nueva (lo que antes era «registrar una ausencia»). */
  async crear(userId: string, input: AbsenceInput, creadaPor: string, d: { esRrhh: boolean }, tz: string): Promise<CrearResultado> {
    const errors = validateAbsenceInput(input, tz);
    if (errors.length) return { ok: false, errors };
    const { startAt, endAt } = absenceBounds(input.type, input.startAt, input.endAt, tz);

    // Choque con una ausencia vigente o con vacaciones pedidas y sin responder.
    const ocupado = [...await this.absences.listForUser(userId), ...await this.vacacionesPendientes(userId)];
    const clash = findOverlap({ startAt, endAt }, ocupado);
    if (clash) return { ok: false, conflict: clash };

    const jefe = await this.org.managerOf(userId);
    const estado = estadoInicial({
      cargadaPorRrhhParaOtro: creadaPor !== userId && d.esRrhh,
      tieneJefe: !!jefe,
      solicitanteEsRrhh: creadaPor === userId && d.esRrhh,
    });

    let absenceId: string | null = null;
    if (valeMientrasPendiente(input.type) || estado === 'aprobada') {
      const r = await this.absences.create(userId, input, creadaPor, tz);
      if (!r.ok) return r;
      absenceId = r.id;
    }

    const [fila] = await this.ctx.query<Fila>(
      `INSERT INTO office_solicitudes (user_id, tipo, start_at, end_at, justificacion, estado, absence_id,
                                       resuelta_por, resuelta_en, creada_por)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9::timestamptz, $10)
       RETURNING ${COLUMNAS}`,
      [userId, input.type, startAt.toISOString(), endAt.toISOString(), input.justification?.trim() || null,
       estado, absenceId, estado === 'aprobada' ? creadaPor : null,
       estado === 'aprobada' ? new Date().toISOString() : null, creadaPor],
    );
    const s = aSolicitud(fila);
    await this.evento(s.id, 'creada', creadaPor, { estado });
    if (estado === 'pendiente') {
      await this.avisos.nueva(s, jefe).catch(e => this.ctx.logger.warn(`Aviso de solicitud nueva falló: ${e}`));
    } else if (creadaPor !== userId) {
      await this.avisos.cargada?.(s, creadaPor).catch(e => this.ctx.logger.warn(`Aviso de ausencia cargada falló: ${e}`));
    }
    return { ok: true, solicitud: s, aprobadorId: jefe, idAdjuntos: absenceId ?? s.id };
  }

  async mias(userId: string): Promise<Solicitud[]> {
    const filas = await this.ctx.query<Fila>(
      `SELECT ${COLUMNAS} FROM office_solicitudes WHERE user_id = $1 ORDER BY start_at DESC`, [userId]);
    return this.conNombres(filas.map(aSolicitud));
  }

  /**
   * Lo que este viewer tiene para responder: las pendientes de su equipo
   * directo; RRHH, todas las pendientes.
   */
  async bandeja(viewerId: string, esRrhh: boolean): Promise<Solicitud[]> {
    let filas: Fila[];
    if (esRrhh) {
      filas = await this.ctx.query<Fila>(
        `SELECT ${COLUMNAS} FROM office_solicitudes WHERE estado = 'pendiente' AND user_id <> $1 ORDER BY start_at`, [viewerId]);
    } else {
      const equipo = [...await this.org.managedUserIds(viewerId)];
      if (!equipo.length) return [];
      filas = await this.ctx.query<Fila>(
        `SELECT ${COLUMNAS} FROM office_solicitudes
          WHERE estado = 'pendiente' AND user_id IN (${equipo.map((_, i) => `$${i + 1}`).join(', ')})
          ORDER BY start_at`, equipo);
    }
    return this.conNombres(filas.map(aSolicitud));
  }

  async resolver(id: string, viewerId: string, accion: 'aprobar' | 'rechazar', motivo: string, esRrhh: boolean, ahora = new Date()): Promise<ResolverResultado> {
    const s = await this.porId(id);
    if (!s) return { ok: false, status: 404, message: 'Esa solicitud no existe' };
    const esJefeDirecto = (await this.org.managerOf(s.userId)) === viewerId;
    if (!puedeResolver({ viewerId, solicitanteId: s.userId, esJefeDirecto, esRrhh })) {
      return { ok: false, status: 403, message: 'Solo su jefe directo o RRHH pueden responderla' };
    }
    return this.aplicar(s, accion, viewerId, motivo, { esDueno: false, esRrhh }, ahora);
  }

  async cancelar(id: string, viewerId: string, motivo: string, esRrhh: boolean, ahora = new Date()): Promise<ResolverResultado> {
    const s = await this.porId(id);
    if (!s) return { ok: false, status: 404, message: 'Esa solicitud no existe' };
    if (s.userId !== viewerId && !esRrhh) return { ok: false, status: 403, message: 'Solo podés cancelar tus propias solicitudes' };
    return this.aplicar(s, 'cancelar', viewerId, motivo, { esDueno: s.userId === viewerId, esRrhh: esRrhh && s.userId !== viewerId }, ahora);
  }

  /** La solicitud de una AbsenceRecord (para `DELETE /absences/:id`). */
  async idPorAusencia(absenceId: string): Promise<string | null> {
    const [f] = await this.ctx.query<{ id: string }>(`SELECT id FROM office_solicitudes WHERE absence_id = $1`, [absenceId]);
    return f?.id ?? null;
  }

  /** Pendientes creadas hace más de `horas` (para el recordatorio diario). */
  async pendientesViejas(horas: number, ahora = new Date()): Promise<Solicitud[]> {
    const filas = await this.ctx.query<Fila>(
      `SELECT ${COLUMNAS} FROM office_solicitudes WHERE estado = 'pendiente' AND creada_en <= $1::timestamptz`,
      [new Date(ahora.getTime() - horas * 3_600_000).toISOString()]);
    return filas.map(aSolicitud);
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async aplicar(s: Solicitud, accion: Accion, viewerId: string, motivo: string,
    quien: { esDueno: boolean; esRrhh: boolean }, ahora: Date): Promise<ResolverResultado> {
    const t = transicion({
      estado: s.estado, accion, tipo: s.tipo, empezo: new Date(s.startAt) <= ahora,
      tieneAusencia: !!s.absenceId, esDueno: quien.esDueno, esRrhh: quien.esRrhh, motivo,
    });
    if (!t.ok) return { ok: false, status: /motivo|caracteres/.test(t.motivo) ? 400 : 409, message: t.motivo };

    let absenceId = s.absenceId;
    if (t.efecto === 'crear') {
      const ocupado = await this.absences.listForUser(s.userId);
      const clash = findOverlap({ startAt: new Date(s.startAt), endAt: new Date(s.endAt) }, ocupado);
      if (clash) return { ok: false, status: 409, message: 'Ya tiene otra ausencia en esas fechas' };
      const row = await this.ctx.prisma.absenceRecord.create({
        data: {
          userId: s.userId, type: s.tipo as any, startAt: new Date(s.startAt), endAt: new Date(s.endAt),
          justification: s.justificacion, createdBy: s.creadaPor,
        },
      });
      absenceId = (row as any).id as string;
      // Los documentos de unas vacaciones pendientes colgaban de la solicitud.
      await this.ctx.query(`UPDATE office_absence_adjuntos SET absence_id = $1 WHERE absence_id = $2`, [absenceId, s.id]);
      await this.ctx.hooks.doAction('office.absence.created', {
        userId: s.userId, type: s.tipo, startAt: new Date(s.startAt), endAt: new Date(s.endAt),
      });
    } else if (t.efecto === 'quitar' && s.absenceId) {
      await this.ctx.prisma.absenceRecord.delete({ where: { id: s.absenceId } }).catch(() => undefined);
      // Los documentos se quedan, colgando de la solicitud: son parte del registro.
      await this.ctx.query(`UPDATE office_absence_adjuntos SET absence_id = $1 WHERE absence_id = $2`, [s.id, s.absenceId]);
      absenceId = null;
    }

    const [fila] = await this.ctx.query<Fila>(
      `UPDATE office_solicitudes
          SET estado = $2, absence_id = $3, resuelta_por = $4, resuelta_en = $5::timestamptz, motivo_resolucion = $6
        WHERE id = $1 RETURNING ${COLUMNAS}`,
      [s.id, t.nuevo, absenceId, viewerId, ahora.toISOString(), motivo.trim() || null],
    );
    const nueva = aSolicitud(fila);
    await this.evento(s.id, t.nuevo, viewerId, { motivo: motivo.trim() || null, efecto: t.efecto });
    if (accion !== 'cancelar' || viewerId !== s.userId) {
      await this.avisos.resuelta(nueva, viewerId).catch(e => this.ctx.logger.warn(`Aviso de solicitud resuelta falló: ${e}`));
    }
    return { ok: true, solicitud: nueva };
  }

  private async porId(id: string): Promise<Solicitud | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [f] = await this.ctx.query<Fila>(`SELECT ${COLUMNAS} FROM office_solicitudes WHERE id = $1::uuid`, [id]);
    return f ? aSolicitud(f) : null;
  }

  private async vacacionesPendientes(userId: string): Promise<AbsenceWindow[]> {
    const filas = await this.ctx.query<Fila>(
      `SELECT ${COLUMNAS} FROM office_solicitudes WHERE user_id = $1 AND estado = 'pendiente' AND absence_id IS NULL`, [userId]);
    return filas.map(f => ({ type: f.tipo as any, startAt: new Date(f.start_at), endAt: new Date(f.end_at), justification: f.justificacion }));
  }

  private async evento(solicitudId: string, accion: string, userId: string, detalle: unknown): Promise<void> {
    await this.ctx.query(
      `INSERT INTO office_solicitud_eventos (solicitud_id, accion, user_id, detalle) VALUES ($1::uuid, $2, $3, $4::jsonb)`,
      [solicitudId, accion, userId, JSON.stringify(detalle ?? null)]);
  }

  private async conNombres(lista: Solicitud[]): Promise<Solicitud[]> {
    const ids = [...new Set(lista.flatMap(s => [s.userId, s.resueltaPor]).filter((x): x is string => !!x))];
    const nombres = ids.length ? await nombresPorUsuario(this.ctx, ids) : null;
    const n = (id: string | null) => {
      const x = id ? nombres?.get(id) : null;
      return x ? `${x.firstName} ${x.lastName}`.trim() : null;
    };
    return lista.map(s => ({ ...s, nombre: n(s.userId), nombreResolvio: n(s.resueltaPor) }));
  }
}
