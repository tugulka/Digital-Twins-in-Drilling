/**
 * @fileoverview Digital twin **preview** modals (density, rheology, flow, nozzle).
 * Opens from the “Değiştir / Change” strip in `App.jsx`. Does **not** POST targets to the API;
 * all pressures are what-if values computed with {@link computeHydraulicsPsi} using edited inputs
 * plus live telemetry for untouched fields. Remount per `activeChangeParam` via `key` in parent
 * so local form state resets when switching modes.
 */

import React, { useState } from 'react';
import { computeHydraulicsPsi, computeSystemVolumeM3 } from './hydraulics';

/** Specific gravity of calcite weighting agent (for kg/ton mud recipe estimate). */
const CALCITE_SG = 2.7;
/** Specific gravity of barite weighting agent. */
const BARITE_SG = 4.2;

/**
 * Normalize user-entered density to specific gravity.
 * @param {string|number} val Raw input
 * @param {'SG'|'lb/gal'|'lb/ft³'} unit Input unit selector
 * @returns {number|null} SG or null if invalid
 */
function densityInputToSg(val, unit) {
  let v = Number(val);
  if (!Number.isFinite(v)) return null;
  if (unit === 'lb/gal') v /= 8.345;
  if (unit === 'lb/ft³') v /= 62.43;
  return v;
}

/**
 * Parse optional numeric field: blank string means “use live / base telemetry”, not zero.
 * @param {string} str
 * @returns {number|null}
 */
function parseOptionalNumber(str) {
  const s = String(str ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Convert tank dimension from cm or ft to meters for volume math. */
function toMetersTank(val, maxUnit) {
  if (maxUnit === 'cm') return val / 100;
  if (maxUnit === 'ft') return val * 0.3048;
  return val;
}

/** Display overflow volume in user-selected pit unit. */
function volFromM3Twin(m3, targetVolUnit) {
  if (targetVolUnit === 'gal') return m3 * 264.172;
  if (targetVolUnit === 'bbl') return m3 * 6.28981;
  return m3;
}

/**
 * @param {object} props
 * @param {'density'|'yp'|'flow'|'nozzle'} props.activeChangeParam Which scenario tab is active
 * @param {() => void} props.onClose Close handler (overlay click or button)
 * @param {object} props.t Localized strings from `DICTIONARY[lang]`
 * @param {object} props.units Current display unit bundle (density, pressure, …)
 * @param {object|null} props.globalLatest Last `/api/latest-data` row (base PV, flow, depth, …)
 * @param {object} props.bhaConfig Casing + string + bit fields (shared with Wellbore modal)
 * @param {{length:number,width:number,height:number}} props.tankDim Pit dimensions for overflow estimate
 * @param {string} props.tankDimUnit 'm' | 'cm' | 'ft'
 * @param {string} props.tankVolUnit 'm³' | 'gal' | 'bbl'
 * @param {number} props.maxPumpPressurePsi User-set trip / pump limit (PSI) from `App` state
 * @param {(psi:number)=>number} props.toDisplayPressure Convert PSI to selected pressure unit for labels
 */
export function DigitalTwinPanel({
  activeChangeParam, onClose, t, units, globalLatest, bhaConfig,
  tankDim, tankDimUnit, tankVolUnit, maxPumpPressurePsi, toDisplayPressure,
}) {
  const [agent, setAgent] = useState('barite');
  
  // --- Form States: Initialized lazily with LIVE telemetry data so user can use up/down spinners directly ---
  const [targetDensityStr, setTargetDensityStr] = useState(() => globalLatest?.Mud_Density_SG != null ? String(Number(globalLatest.Mud_Density_SG).toFixed(2)) : '1.2');
  const [densityUnit, setDensityUnit] = useState(() => units.density);
  const [t600Str, setT600Str] = useState(() => String(Number(globalLatest?.theta_600 || 60).toFixed(1)));
  const [t300Str, setT300Str] = useState(() => String(Number(globalLatest?.theta_300 || 40).toFixed(1)));
  const [t200Str, setT200Str] = useState(() => String(Number(globalLatest?.theta_200 || 30).toFixed(1)));
  const [t100Str, setT100Str] = useState(() => String(Number(globalLatest?.theta_100 || 20).toFixed(1)));
  const [t6Str, setT6Str] = useState(() => String(Number(globalLatest?.theta_6 || 6).toFixed(1)));
  const [t3Str, setT3Str] = useState(() => String(Number(globalLatest?.theta_3 || 5).toFixed(1)));
  const [targetFlowStr, setTargetFlowStr] = useState(() => String(Number(globalLatest?.Flow_Rate_lpm || 2000).toFixed(0)));
  const [targetNozzleStr, setTargetNozzleStr] = useState(() => String(Number(bhaConfig?.bit_nozzle_size || 12).toFixed(0)));

  // --- Live telemetry used as defaults when preview fields are left empty ---
  const depthM = globalLatest?.Current_Depth_m != null ? Number(globalLatest.Current_Depth_m) : 0;
  const baseFlow = globalLatest?.Flow_Rate_lpm != null ? Number(globalLatest.Flow_Rate_lpm) : 0;
  const baseT600 = globalLatest?.theta_600 || 60;
  const baseT300 = globalLatest?.theta_300 || 40;
  const baseT200 = globalLatest?.theta_200 || 30;
  const baseT100 = globalLatest?.theta_100 || 20;
  const baseT6 = globalLatest?.theta_6 || 6;
  const baseT3 = globalLatest?.theta_3 || 5;

  const p_t600 = activeChangeParam === 'rheology' ? parseOptionalNumber(t600Str) : null;
  const p_t300 = activeChangeParam === 'rheology' ? parseOptionalNumber(t300Str) : null;
  const p_t200 = activeChangeParam === 'rheology' ? parseOptionalNumber(t200Str) : null;
  const p_t100 = activeChangeParam === 'rheology' ? parseOptionalNumber(t100Str) : null;
  const p_t6 = activeChangeParam === 'rheology' ? parseOptionalNumber(t6Str) : null;
  const p_t3 = activeChangeParam === 'rheology' ? parseOptionalNumber(t3Str) : null;

  const simT600 = p_t600 != null ? p_t600 : baseT600;
  const simT300 = p_t300 != null ? p_t300 : baseT300;
  const simT200 = p_t200 != null ? p_t200 : baseT200;
  const simT100 = p_t100 != null ? p_t100 : baseT100;
  const simT6 = p_t6 != null ? p_t6 : baseT6;
  const simT3 = p_t3 != null ? p_t3 : baseT3;

  let simN = 0.5;
  const num = Math.max(0.1, simT600 - simT3);
  const den = Math.max(0.1, simT300 - simT3);
  if (den > 0) simN = 3.321928 * Math.log10(num / den);
  simN = Math.max(0.01, Math.min(1.0, simN));

  const tau_0_si = simT3 * 0.4788;
  const simK = ((simT300 - simT3) / Math.pow(511, simN)) * 0.4788 * Math.pow(1.703, simN);

  const baseRho = globalLatest?.Mud_Density_SG != null ? Number(globalLatest.Mud_Density_SG) : 1.2;
  const mudPct = globalLatest?.Mud_Level_pct != null ? Number(globalLatest.Mud_Level_pct) : 0;

  const baseNozzle = Number(bhaConfig?.bit_nozzle_size ?? 12);
  const targetFlow = activeChangeParam === 'flow' ? parseOptionalNumber(targetFlowStr) : null;
  // Floor at 100 L/min matches legacy simulator stability (same as previous delta-based UI).
  const simFlow = Math.max(100, targetFlow != null ? targetFlow : baseFlow);
  const targetNozzle = activeChangeParam === 'nozzle' ? parseOptionalNumber(targetNozzleStr) : null;
  const simNozzleSize = Math.max(1, targetNozzle != null ? targetNozzle : baseNozzle);
  const simNozzleQty = Number(bhaConfig?.bit_nozzle_qty ?? 3);
  const targetSg = activeChangeParam === 'density' ? densityInputToSg(targetDensityStr, densityUnit) : null;
  const simDensity = targetSg != null && Number.isFinite(targetSg) ? targetSg : baseRho;

  const hyd = computeHydraulicsPsi({
    densitySg: simDensity, flowLpm: simFlow, k_si: simK, n: simN, tau0_si: tau_0_si, depthM, config: bhaConfig,
    nozzleSizeThirtySeconds: simNozzleSize, nozzleQty: simNozzleQty,
  });
  const pumpPsi = hyd.pumpPsi;
  const pumpOver = pumpPsi > maxPumpPressurePsi;

  // --- Chemical Mass & Overflow Calculations (Density Scenario) ---
  const sgSolid = agent === 'calcite' ? CALCITE_SG : BARITE_SG;
  let totalSolidKg = null; // Total required mass for system
  let overflowVol = null;  // Overflow volume in pits
  
  if (activeChangeParam === 'density' && targetSg != null && Number.isFinite(targetSg)) {
    const rho1 = baseRho * 1000;  // Initial density (kg/m^3)
    const rho2 = targetSg * 1000; // Target density (kg/m^3)
    const rhoS = sgSolid * 1000;  // Solid agent density (kg/m^3)
    
    if (rho2 > rho1 && rho2 < rhoS) {
      // 1. Calculate Active Tank Volume (Surface)
      const totalTankM3 = toMetersTank(tankDim.length, tankDimUnit) * toMetersTank(tankDim.width, tankDimUnit) * toMetersTank(tankDim.height, tankDimUnit);
      const curTankM3 = totalTankM3 * (mudPct / 100);
      
      // 2. Calculate Subsurface Wellbore Volume
      const wellboreM3 = computeSystemVolumeM3(depthM, bhaConfig);
      
      // 3. Total System Volume
      const totalSystemM3 = curTankM3 + wellboreM3;
      
      // 4. Required Mass of Solid (Formula derived from Volume Balance: V_1 + M_s/rho_s = V_2)
      totalSolidKg = totalSystemM3 * (rho2 - rho1) * rhoS / (rhoS - rho2);
      
      // 5. Overflow estimation: How much fluid displacement will push over pit capacity
      const dV_total = totalSolidKg / rhoS; // Volume added by solids
      const cap = totalTankM3 - curTankM3;  // Freeboard space in tanks
      overflowVol = Math.max(0, dV_total - cap);
    }
  }

  
  const title = activeChangeParam === 'density' ? t.twin_density_title : activeChangeParam === 'rheology' ? t.twin_rheo_title : activeChangeParam === 'nozzle' ? t.twin_nozzle_title : t.twin_flow_title;
  const rs = { display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' };
  const vs = { color: 'var(--text-primary)', fontWeight: 'bold' };

  const chemName = agent === 'calcite' ? t.twin_calcite : t.twin_barite;
  const rawChemLabel = t.twin_total_system_chem || 'Total System Chemical Req.';
  const chemLabel = rawChemLabel.replace('Kimyasal', chemName).replace('Chemical', chemName);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '520px', padding: '1.5rem', textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose}>{t.close}</button>
        <h2 style={{ marginBottom: '0.5rem', color: 'var(--warning)' }}>🎛️ {title}</h2>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{t.twin_note}</p>
        {/* Mode: target mud weight + weighting agent */}
        {activeChangeParam === 'density' && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.6rem', fontSize: '0.85rem' }}>{t.twin_agent}</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className={agent === 'calcite' ? 'lang-btn active' : 'lang-btn'} onClick={() => setAgent('calcite')}>{t.twin_calcite}</button>
              <button type="button" className={agent === 'barite' ? 'lang-btn active' : 'lang-btn'} onClick={() => setAgent('barite')}>{t.twin_barite}</button>
            </div>
            <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input type="number" step="0.01" value={targetDensityStr} onChange={(e) => setTargetDensityStr(e.target.value)} placeholder={t.twin_target_density} style={{ flex: 1, minWidth: '120px', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }} />
              <select value={densityUnit} onChange={(e) => setDensityUnit(e.target.value)} className="setting-dropdown" style={{ padding: '0.5rem' }}>
                <option value="SG">SG</option><option value="lb/gal">lb/gal</option><option value="lb/ft³">lb/ft³</option>
              </select>
            </div>
            {totalSolidKg != null && Number.isFinite(totalSolidKg) && (
              <div style={{ marginTop: '0.6rem', fontSize: '0.85rem' }}>
                <p style={{ color: 'var(--accent-color)', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  {chemLabel}:{' '}
                  <span>{(totalSolidKg / 1000).toFixed(1)} Ton</span>
                </p>
                {agent === 'calcite' && targetSg > 1.25 && (
                   <p style={{ marginTop: '0.5rem', color: 'var(--warning)', fontWeight: 'bold' }}>⚠️ İstediğiniz yoğunluğa ulaşamayabilirsiniz.</p>
                )}
                {agent === 'barite' && targetSg > 1.50 && (
                   <p style={{ marginTop: '0.5rem', color: 'var(--warning)', fontWeight: 'bold' }}>⚠️ İstediğiniz yoğunluğa ulaşamayabilirsiniz.</p>
                )}
              </div>
            )}
            {overflowVol != null && overflowVol > 0 && <p style={{ marginTop: '0.4rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{t.twin_overflow}: {volFromM3Twin(overflowVol, tankVolUnit).toFixed(2)} {tankVolUnit}</p>}
          </div>
        )}
        {/* Mode: viscometer targets */}
        {activeChangeParam === 'rheology' && (
          <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            {[['θ_600', t600Str, setT600Str, baseT600], ['θ_300', t300Str, setT300Str, baseT300], 
              ['θ_200', t200Str, setT200Str, baseT200], ['θ_100', t100Str, setT100Str, baseT100], 
              ['θ_6', t6Str, setT6Str, baseT6], ['θ_3', t3Str, setT3Str, baseT3]].map(([label, val, setVal, baseVal]) => (
              <label key={label} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {label}
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                  placeholder={`${baseVal.toFixed(1)}`}
                  style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </label>
            ))}
          </div>
        )}
        {/* Mode: target flow L/min */}
        {activeChangeParam === 'flow' && (
          <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t.twin_target_flow}
            <input
              type="number"
              step="1"
              min="0"
              value={targetFlowStr}
              onChange={(e) => setTargetFlowStr(e.target.value)}
              placeholder={`${Number.isFinite(baseFlow) ? String(Math.round(baseFlow)) : '—'}`}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </label>
        )}
        {/* Mode: jet nozzle size in 1/32 in */}
        {activeChangeParam === 'nozzle' && (
          <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t.twin_target_nozzle}
            <input
              type="number"
              step="1"
              min="1"
              value={targetNozzleStr}
              onChange={(e) => setTargetNozzleStr(e.target.value)}
              placeholder={`${Number.isFinite(baseNozzle) ? String(Math.round(baseNozzle)) : '12'}`}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </label>
        )}
        {/* One-line pump summary (same total as breakdown below) */}
        <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--bg-dark)', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t.twin_est_pump_blurb}</span>{' '}
          <strong style={{ fontSize: '0.95rem', color: pumpOver ? 'var(--danger)' : 'var(--accent-color)' }}>{toDisplayPressure(pumpPsi)} {units.pressure}</strong>
        </div>
        {/* Hydraulic breakdown in display pressure units */}
        <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '0.8rem' }}>
          <div style={rs}><span>{t.twin_k_used || 'K (calc)'}</span><span style={vs}>{simK.toFixed(3)}</span></div>
          <div style={rs}><span>{t.twin_n_used || 'n (calc)'}</span><span style={vs}>{simN.toFixed(3)}</span></div>
          <div style={rs}>
            <span>{t.twin_surface}</span>
            <span style={vs}>{toDisplayPressure(hyd.surfacePsi)}</span>
          </div>
          <div style={rs}><span>{t.twin_drill_string || t.twin_inner}</span><span style={vs}>{toDisplayPressure(hyd.innerPipePsi)}</span></div>
          <div style={rs}><span>{t.twin_bit}</span><span style={vs}>{toDisplayPressure(hyd.bitPsi)}</span></div>
          <div style={rs}><span>{t.twin_annulus_open || 'Anülüs (Açık Kuyu)'}</span><span style={vs}>{toDisplayPressure(hyd.annulusOpenPsi)}</span></div>
          <div style={rs}><span>{t.twin_annulus_cased || 'Anülüs (Casing)'}</span><span style={vs}>{toDisplayPressure(hyd.annulusCasedPsi)}</span></div>
          <div style={rs}>
            <span>{t.twin_standpipe}</span>
            <span style={vs}>{toDisplayPressure(hyd.standpipePsi)}</span>
          </div>
          <div style={{ ...rs, marginTop: '0.5rem' }}>
            <span>{t.twin_total}</span>
            <span style={{ ...vs, color: 'var(--accent-color)' }}>
              {toDisplayPressure(pumpPsi)} {units.pressure}
            </span>
          </div>
        </div>
        {pumpOver && <div style={{ marginTop: '1rem', padding: '0.6rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.85rem' }}>{t.twin_pump_warn} ({toDisplayPressure(pumpPsi - maxPumpPressurePsi)} {units.pressure})</div>}
        <div style={{ marginTop: '1.2rem', textAlign: 'right' }}><button type="button" onClick={onClose} style={{ background: 'var(--accent-color)', border: 'none', color: '#000', padding: '0.5rem 1.2rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{t.twin_close}</button></div>
      </div>
    </div>
  );
}
