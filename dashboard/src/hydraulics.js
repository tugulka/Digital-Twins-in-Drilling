/**
 * @fileoverview Client-side drilling hydraulics for the dashboard "digital twin" preview.
 * These routines mirror the physics layer in mock_data_gen.py (YPL model).
 */

function calculate_re_c(n) {
    return (6464 * n) / (Math.pow(1 + 3*n, 2) * Math.pow(2 + n, (2+n)/(1+n)));
}

function hb_pressure_drop_pipe_si(v, d, L, n, tau_0_si, K_si, rho) {
    if (v <= 0 || d <= 0 || L <= 0) return 0.0;
    const term1 = (3*n + 1) / (4*n);
    let K_safe = K_si <= 0 ? 1e-6 : K_si;
    const Re_g = (rho * Math.pow(d, n) * Math.pow(v, 2-n)) / (K_safe * Math.pow(8, n-1) * Math.pow(term1, n));
    const Re_c = calculate_re_c(n);
    
    if (Re_g <= Re_c) {
        return (4 * L / d) * (tau_0_si + K_safe * Math.pow(term1, n) * Math.pow(8*v / d, n));
    } else {
        const a = (1.1025 * Math.pow(n, 0.18)) / 100.0;
        const b = 0.263 * Math.pow(n, 0.033);
        const f = a / Math.max(1e-6, Math.pow(Re_g, b));
        return (2 * f * rho * Math.pow(v, 2) * L) / d;
    }
}

function hb_pressure_drop_annulus_si(v, d_o, d_i, L, n, tau_0_si, K_si, rho) {
    const d_eq = d_o - d_i;
    if (v <= 0 || d_eq <= 0 || L <= 0) return 0.0;
    const term1 = (2*n + 1) / (3*n);
    let K_safe = K_si <= 0 ? 1e-6 : K_si;
    const Re_g = (rho * Math.pow(d_eq, n) * Math.pow(v, 2-n)) / (K_safe * Math.pow(12, n-1) * Math.pow(term1, n));
    const Re_c = calculate_re_c(n);
    
    if (Re_g <= Re_c) {
        return (4 * L / d_eq) * (tau_0_si + K_safe * Math.pow(term1, n) * Math.pow(12*v / d_eq, n));
    } else {
        const a = (1.1025 * Math.pow(n, 0.18)) / 100.0;
        const b = 0.263 * Math.pow(n, 0.033);
        const f = a / Math.max(1e-6, Math.pow(Re_g, b));
        return (2 * f * rho * Math.pow(v, 2) * L) / d_eq;
    }
}

function parseCasings(config) {
  try {
    const c = JSON.parse(config?.casings || '[]');
    return Array.isArray(c) ? c : [];
  } catch { return []; }
}

function depthMToNative(depthM, lengthUnit) {
  const d = Number(depthM);
  if (!Number.isFinite(d) || d < 0) return 0;
  return lengthUnit === 'ft' ? d * 3.28084 : d;
}

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

function pipeGeometryAtMd(mdNative, depthNative, cfg) {
  const dc1L = Number(cfg.dc1_length) || 0;
  const dc2L = Number(cfg.dc2_length) || 0;
  const hwdpL = Number(cfg.hwdp_length) || 0;
  const dpOd = Number(cfg.dp1_od) || 0;
  const dc1Od = Number(cfg.dc1_od) || 0;
  const dc2Od = Number(cfg.dc2_od) || 0;
  const hwdpOd = Number(cfg.hwdp_od) || 0;
  const dpId = Number(cfg.dp1_id) || 0;
  const dc1Id = Number(cfg.dc1_id) || 0;
  const dc2Id = Number(cfg.dc2_id) || 0;
  const hwdpId = Number(cfg.hwdp_id) || 0;

  if (depthNative <= 0) return { od: dpOd, innerId: dpId };
  const topDc2 = depthNative - dc2L;
  const topDc1 = depthNative - dc2L - dc1L;
  const topHwdp = depthNative - dc2L - dc1L - hwdpL;

  if (dc2L > 0 && dc2Od > 0 && mdNative > topDc2) return { od: dc2Od, innerId: dc2Id };
  if (dc1L > 0 && dc1Od > 0 && mdNative > topDc1) return { od: dc1Od, innerId: dc1Id };
  if (hwdpL > 0 && hwdpOd > 0 && mdNative > topHwdp) return { od: hwdpOd, innerId: hwdpId };
  return { od: dpOd, innerId: dpId };
}

function collectBreakpoints(depthNative, casings, bhaLen, dc1L, dc2L, hwdpL) {
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
  const topHwdp = depthNative - dc2L - dc1L - (hwdpL || 0);
  const topBha = depthNative - bhaLen;
  [topDc2, topDc1, topHwdp, topBha].forEach((x) => {
    if (x > 0 && x < depthNative) b.add(x);
  });
  return [...b].sort((a, b2) => a - b2);
}

/**
 * Orchestrates the full hydraulic calculation for the drilling system.
 * 
 * 1. Computes Bit Pressure Drop (TFA based)
 * 2. Computes Inner Pipe Friction (DP, DC1, DC2)
 * 3. Computes Annulus Friction across all casing/open-hole breakpoints
 * 4. Sums all components to find total pump and standpipe pressure
 * 
 * @param {object} p Configuration and telemetry state
 * @returns {object} Breakdown of all pressure losses in PSI
 */
export function computeHydraulicsPsi(p) {
  const { densitySg, flowLpm, n, k_si, tau0_si, depthM, config, nozzleSizeThirtySeconds, nozzleQty } = p;
  const q_lpm = Number(flowLpm);
  const rho_kgm3 = Number(densitySg) * 1000.0; // Convert Specific Gravity to kg/m^3
  const n_val = Number(n);
  const k_val = Number(k_si);
  const tau0_val = Number(tau0_si);

  if (!config) {
    return { bitPsi: 0, innerPipePsi: 0, annulusPsi: 0, pumpPsi: 0, standpipePsi: 0, surfacePsi: 0 };
  }

  const nSize = Number(nozzleSizeThirtySeconds ?? config.bit_nozzle_size ?? 12);
  const nQty = Number(nozzleQty ?? config.bit_nozzle_qty ?? 3);
  const nozzles = Array.from({ length: Math.max(0, nQty) }, () => nSize);
  let tfa = nozzles.reduce((acc, n) => acc + (Math.PI * (n / 32.0) ** 2) / 4, 0);
  if (!Number.isFinite(tfa) || tfa <= 0) tfa = 0.5;

  const qGpm = q_lpm * 0.264172;
  const mwPpg = Number(densitySg) * 8.345;
  const bitPsi = (mwPpg * qGpm ** 2) / (10858 * tfa ** 2);
  const bit_pd_pa = bitPsi / 0.000145038;

  const lengthUnit = config?.length_unit || 'm';
  const unit_to_m = lengthUnit === 'ft' ? 0.3048 : 1.0;
  const depthNative = depthMToNative(depthM, lengthUnit);

  const calc_pd_pipe_si = (length_native, inner_d_in) => {
      const L_m = length_native * unit_to_m;
      const d_m = inner_d_in * 0.0254;
      if (L_m > 0 && d_m > 0) {
          const A_m2 = Math.PI * Math.pow(d_m/2, 2);
          const v = (q_lpm / 60000.0) / Math.max(1e-6, A_m2);
          return hb_pressure_drop_pipe_si(v, d_m, L_m, n_val, tau0_val, k_val, rho_kgm3);
      }
      return 0.0;
  };

  const dc1L = Number(config.dc1_length) || 0;
  const dc2L = Number(config.dc2_length) || 0;
  const hwdpL = Number(config.hwdp_length) || 0;
  const bhaLen = dc1L + dc2L + hwdpL;
  const dynDpL = Math.max(0, depthNative - bhaLen);

  let pipe_pd_pa = 0;
  pipe_pd_pa += calc_pd_pipe_si(dynDpL, Number(config.dp1_id) || 0);
  pipe_pd_pa += calc_pd_pipe_si(hwdpL, Number(config.hwdp_id) || 0);
  pipe_pd_pa += calc_pd_pipe_si(dc1L, Number(config.dc1_id) || 0);
  pipe_pd_pa += calc_pd_pipe_si(dc2L, Number(config.dc2_id) || 0);

  const bitD = Number(config.bit_diameter) || 8.5;
  const casings = parseCasings(config);
  const bps = collectBreakpoints(depthNative, casings, bhaLen, dc1L, dc2L, hwdpL);
  let annulus_open_pa = 0;
  let annulus_cased_pa = 0;
  for (let i = 0; i < bps.length - 1; i++) {
    const md0 = bps[i];
    const md1 = bps[i + 1];
    const lenNative = md1 - md0;
    if (lenNative <= 0) continue;
    const mid = (md0 + md1) / 2;
    const holeId = holeIdAtMd(mid, casings, bitD);
    const { od: pipeOd } = pipeGeometryAtMd(mid, depthNative, config);
    const dAnn = holeId - pipeOd;
    if (!Number.isFinite(dAnn) || dAnn <= 0.01) continue;
    
    const d_o_m = holeId * 0.0254;
    const d_i_m = pipeOd * 0.0254;
    const L_m = lenNative * unit_to_m;
    const A_m2 = Math.PI * (Math.pow(d_o_m/2, 2) - Math.pow(d_i_m/2, 2));
    const v = (q_lpm / 60000.0) / Math.max(1e-6, A_m2);
    const dp = hb_pressure_drop_annulus_si(v, d_o_m, d_i_m, L_m, n_val, tau0_val, k_val, rho_kgm3);
    const isCased = casings.some(row => mid >= Math.min(row.start || 0, row.end || 0) && mid < Math.max(row.start || 0, row.end || 0));
    if (isCased) {
      annulus_cased_pa += dp;
    } else {
      annulus_open_pa += dp;
    }
  }

  const dP_surface_psi = 12.0 * densitySg * Math.pow(q_lpm / 1000.0, 1.86);
  const innerPipePsi = pipe_pd_pa * 0.000145038;
  const annulusOpenPsi = annulus_open_pa * 0.000145038;
  const annulusCasedPsi = annulus_cased_pa * 0.000145038;
  const annulusPsi = annulusOpenPsi + annulusCasedPsi;
  const pumpPsi = dP_surface_psi + bitPsi + innerPipePsi + annulusPsi;
  const standpipePsi = pumpPsi * 0.98;

  return {
    bitPsi,
    innerPipePsi,
    annulusPsi,
    annulusOpenPsi,
    annulusCasedPsi,
    pumpPsi,
    standpipePsi,
    surfacePsi: dP_surface_psi
  };
}

/**
 * Calculates the total fluid volume of the wellbore system (inner pipe + annulus) in cubic meters.
 * Used for estimating total chemical requirement (Calcite/Barite) for the entire drilling system.
 * 
 * @param {number} depthM Current bit depth in meters
 * @param {object} config BHA and Casing configuration object
 * @returns {number} Total wellbore volume (m^3)
 */
export function computeSystemVolumeM3(depthM, config) {
  if (!config) return 0;
  let vol = 0;
  const lengthUnit = config.length_unit || 'm';
  const unit_to_m = lengthUnit === 'ft' ? 0.3048 : 1.0;
  const depthNative = depthMToNative(depthM, lengthUnit);

  const dc1L = Number(config.dc1_length) || 0;
  const dc2L = Number(config.dc2_length) || 0;
  const hwdpL = Number(config.hwdp_length) || 0;
  const bhaLen = dc1L + dc2L + hwdpL;
  const dynDpL = Math.max(0, depthNative - bhaLen);

  const addPipeVol = (lenNat, idIn) => {
    if (lenNat <= 0 || idIn <= 0) return;
    const L = lenNat * unit_to_m;
    const r = (idIn * 0.0254) / 2;
    vol += Math.PI * r * r * L;
  };
  addPipeVol(dynDpL, Number(config.dp1_id) || 0);
  addPipeVol(hwdpL, Number(config.hwdp_id) || 0);
  addPipeVol(dc1L, Number(config.dc1_id) || 0);
  addPipeVol(dc2L, Number(config.dc2_id) || 0);

  const bitD = Number(config.bit_diameter) || 8.5;
  const casings = parseCasings(config);
  const bps = collectBreakpoints(depthNative, casings, bhaLen, dc1L, dc2L, hwdpL);
  for (let i = 0; i < bps.length - 1; i++) {
    const md0 = bps[i];
    const md1 = bps[i + 1];
    const lenNative = md1 - md0;
    if (lenNative <= 0) continue;
    const mid = (md0 + md1) / 2;
    const holeId = holeIdAtMd(mid, casings, bitD);
    const { od: pipeOd } = pipeGeometryAtMd(mid, depthNative, config);
    const dAnn = holeId - pipeOd;
    if (!Number.isFinite(dAnn) || dAnn <= 0) continue;
    const L = lenNative * unit_to_m;
    const rH = (holeId * 0.0254) / 2;
    const rP = (pipeOd * 0.0254) / 2;
    vol += Math.PI * (rH * rH - rP * rP) * L;
  }
  return vol;
}
