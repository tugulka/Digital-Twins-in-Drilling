/**
 * @fileoverview Client-side drilling hydraulics for the dashboard “digital twin” preview.
 * These routines mirror the physics layer in `mock_data_gen.py` (same K_YP, friction power law,
 * annulus hydraulic diameter). Any intentional change to formulas or units must be kept in sync
 * with the Python simulator to avoid divergent pump-pressure estimates between live data and preview.
 */

/** YP contribution weight inside the empirical viscous term (must match `mock_data_gen.py`). */
export const K_YP_IN_PIPE_TERM = 0.22;

/**
 * Combined viscous proxy used in pipe and annulus friction (not a lab rheometer reading).
 * @param {number} pv Plastic viscosity (cP)
 * @param {number} yp Yield point (lbf/100ft²)
 * @returns {number}
 */
export function viscTwin(pv, yp) {
  return Number(pv) + 5 + K_YP_IN_PIPE_TERM * Number(yp);
}

/**
 * Industry-style empirical pressure loss in circular conduit (simplified Bingham-style proxy).
 * @param {number} lengthFt Segment length in feet
 * @param {number} dEffIn Effective hydraulic diameter in inches (bore ID or annulus gap)
 * @param {number} qGpm Flow rate in US gallons per minute
 * @param {number} viscousTerm Output of {@link viscTwin}
 * @returns {number} Pressure drop in PSI for that segment
 */
function frictionPsi(lengthFt, dEffIn, qGpm, viscousTerm) {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return 0;
  if (!Number.isFinite(dEffIn) || dEffIn <= 0) return 0;
  if (!Number.isFinite(qGpm) || qGpm <= 0) return 0;
  if (!Number.isFinite(viscousTerm) || viscousTerm <= 0) return 0;
  return (lengthFt * viscousTerm * qGpm) / (1500 * dEffIn ** 2.5);
}

/** Parse casing shoe / liner intervals from BHA config JSON string. */
function parseCasings(config) {
  try {
    const c = JSON.parse(config?.casings || '[]');
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}

/** Convert measured depth from meters (API) to native MD used in config (m or ft). */
function depthMToNative(depthM, lengthUnit) {
  const d = Number(depthM);
  if (!Number.isFinite(d) || d < 0) return 0;
  return lengthUnit === 'ft' ? d * 3.28084 : d;
}

/**
 * Inner diameter of the open hole at a given MD: smallest casing ID whose interval contains MD,
 * else open-hole bit diameter.
 */
function holeIdAtMd(mdNative, casings, bitDiameterIn) {
  const candidates = [];
  for (const row of casings) {
    const s = Number(row.start);
    const e = Number(row.end);
    const id = Number(row.id);
    if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(id)) continue;
    const lo = Math.min(s, e);
    const hi = Math.max(s, e);
    if (mdNative >= lo && mdNative < hi) candidates.push(id);
  }
  if (candidates.length === 0) return Number(bitDiameterIn) || 0;
  return Math.min(...candidates);
}

/**
 * OD / ID of the drill string at MD: DC2, DC1, then DP from bottom to top of string.
 * @returns {{ od: number, innerId: number }}
 */
function pipeGeometryAtMd(mdNative, depthNative, cfg) {
  const dc1L = Number(cfg.dc1_length) || 0;
  const dc2L = Number(cfg.dc2_length) || 0;
  const dpOd = Number(cfg.dp1_od) || 0;
  const dc1Od = Number(cfg.dc1_od) || 0;
  const dc2Od = Number(cfg.dc2_od) || 0;
  const dpId = Number(cfg.dp1_id) || 0;
  const dc1Id = Number(cfg.dc1_id) || 0;
  const dc2Id = Number(cfg.dc2_id) || 0;

  if (depthNative <= 0) return { od: dpOd, innerId: dpId };

  const topDc2 = depthNative - dc2L;
  const topDc1 = depthNative - dc2L - dc1L;

  if (dc2L > 0 && dc2Od > 0 && mdNative > topDc2) return { od: dc2Od, innerId: dc2Id };
  if (dc1L > 0 && dc1Od > 0 && mdNative > topDc1) return { od: dc1Od, innerId: dc1Id };
  return { od: dpOd, innerId: dpId };
}

/**
 * Ordered MD breakpoints for annulus integration: surface, shoe depths, BHA segment tops, TD.
 */
function collectBreakpoints(depthNative, casings, bhaLen, dc1L, dc2L) {
  const b = new Set([0, depthNative]);
  for (const row of casings) {
    const s = Number(row.start);
    const e = Number(row.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const lo = Math.min(s, e);
    const hi = Math.max(s, e);
    if (lo > 0 && lo < depthNative) b.add(lo);
    if (hi > 0 && hi < depthNative) b.add(hi);
  }
  const topDc2 = depthNative - dc2L;
  const topDc1 = depthNative - dc2L - dc1L;
  const topBha = depthNative - bhaLen;
  [topDc2, topDc1, topBha].forEach((x) => {
    if (x > 0 && x < depthNative) b.add(x);
  });
  return [...b].sort((a, b2) => a - b2);
}

/** Sum frictional losses inside DP + DCs using inner diameters as hydraulic diameter. */
function innerPipePressurePsi(config, depthM, qGpm, viscousTerm) {
  const lengthUnit = config?.length_unit || 'm';
  const unitMult = lengthUnit === 'm' ? 3.28084 : 1.0;
  const depthNative = depthMToNative(depthM, lengthUnit);

  const dc1L = Number(config.dc1_length) || 0;
  const dc2L = Number(config.dc2_length) || 0;
  const bhaLen = dc1L + dc2L;
  const dynDpL = Math.max(0, depthNative - bhaLen);

  let sum = 0;
  sum += frictionPsi(dynDpL * unitMult, Number(config.dp1_id) || 0, qGpm, viscousTerm);
  sum += frictionPsi(dc1L * unitMult, Number(config.dc1_id) || 0, qGpm, viscousTerm);
  sum += frictionPsi(dc2L * unitMult, Number(config.dc2_id) || 0, qGpm, viscousTerm);
  return sum;
}

/**
 * Annulus losses: integrate along MD; each sub-interval uses D_ann = hole_id − pipe_OD at midpoint.
 */
function annulusPressurePsi(config, depthM, qGpm, viscousTerm, bitDiameterIn) {
  const lengthUnit = config?.length_unit || 'm';
  const unitMult = lengthUnit === 'm' ? 3.28084 : 1.0;
  const depthNative = depthMToNative(depthM, lengthUnit);
  if (depthNative <= 0) return 0;

  const casings = parseCasings(config);
  const dc1L = Number(config.dc1_length) || 0;
  const dc2L = Number(config.dc2_length) || 0;
  const bhaLen = dc1L + dc2L;
  const eps = 0.01;

  const bps = collectBreakpoints(depthNative, casings, bhaLen, dc1L, dc2L);
  let sum = 0;
  for (let i = 0; i < bps.length - 1; i++) {
    const md0 = bps[i];
    const md1 = bps[i + 1];
    const lenNative = md1 - md0;
    if (lenNative <= 0) continue;
    const mid = (md0 + md1) / 2;
    const holeId = holeIdAtMd(mid, casings, bitDiameterIn);
    const { od: pipeOd } = pipeGeometryAtMd(mid, depthNative, config);
    const dAnn = holeId - pipeOd;
    if (!Number.isFinite(dAnn) || dAnn <= eps) continue;
    sum += frictionPsi(lenNative * unitMult, dAnn, qGpm, viscousTerm);
  }
  return sum;
}

/**
 * Full hydraulic snapshot for the twin preview: bit nozzles (TFA), string + annulus friction.
 * @param {object} p
 * @param {number} p.densitySg Mud specific gravity
 * @param {number} p.flowLpm Flow in liters per minute
 * @param {number} p.pv Plastic viscosity (cP)
 * @param {number} p.yp Yield point
 * @param {number} p.depthM Current hole depth (meters) from telemetry
 * @param {object} p.config BHA / casing fields from `bhaConfig` state
 * @param {number} [p.nozzleSizeThirtySeconds] Nozzle diameter in 1/32 inch
 * @param {number} [p.nozzleQty] Number of equal nozzles
 * @returns {{ bitPsi: number, innerPipePsi: number, annulusPsi: number, pumpPsi: number, standpipePsi: number }}
 */
export function computeHydraulicsPsi(p) {
  const {
    densitySg,
    flowLpm,
    pv,
    yp,
    depthM,
    config,
    nozzleSizeThirtySeconds,
    nozzleQty,
  } = p;

  const qGpm = Number(flowLpm) * 0.264172;
  const mwPpg = Number(densitySg) * 8.345;
  const vt = viscTwin(pv, yp);

  if (!config) {
    return {
      bitPsi: 0,
      innerPipePsi: 0,
      annulusPsi: 0,
      pumpPsi: 0,
      standpipePsi: 0,
    };
  }

  const nSize = Number(nozzleSizeThirtySeconds ?? config.bit_nozzle_size ?? 12);
  const nQty = Number(nozzleQty ?? config.bit_nozzle_qty ?? 3);
  const nozzles = Array.from({ length: Math.max(0, nQty) }, () => nSize);
  let tfa = nozzles.reduce((acc, n) => acc + (Math.PI * (n / 32.0) ** 2) / 4, 0);
  if (!Number.isFinite(tfa) || tfa <= 0) tfa = 0.5;

  const bitPsi = (mwPpg * qGpm ** 2) / (10858 * tfa ** 2);
  const innerPipePsi = innerPipePressurePsi(config, depthM, qGpm, vt);
  const bitD = Number(config.bit_diameter) || 8.5;
  const annulusPsi = annulusPressurePsi(config, depthM, qGpm, vt, bitD);
  const pumpPsi = bitPsi + innerPipePsi + annulusPsi;
  const standpipePsi = pumpPsi * 0.95;

  return {
    bitPsi,
    innerPipePsi,
    annulusPsi,
    pumpPsi,
    standpipePsi,
  };
}
