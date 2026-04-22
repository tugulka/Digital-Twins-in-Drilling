/**
 * @fileoverview Digital twin **preview** modals (density, rheology, flow, nozzle).
 * Opens from the “Değiştir / Change” strip in `App.jsx`. Does **not** POST targets to the API;
 * all pressures are what-if values computed with {@link computeHydraulicsPsi} using edited inputs
 * plus live telemetry for untouched fields. Remount per `activeChangeParam` via `key` in parent
 * so local form state resets when switching modes.
 */

import React, { useState } from 'react';
import { computeHydraulicsPsi, viscTwin } from './hydraulics';

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
  const [targetDensityStr, setTargetDensityStr] = useState('');
  const [densityUnit, setDensityUnit] = useState(() => units.density);
  const [targetPvStr, setTargetPvStr] = useState('');
  const [targetYpStr, setTargetYpStr] = useState('');
  const [targetFlowStr, setTargetFlowStr] = useState('');
  const [targetNozzleStr, setTargetNozzleStr] = useState('');

  // --- Live telemetry used as defaults when preview fields are left empty ---
  const depthM = globalLatest?.Current_Depth_m != null ? Number(globalLatest.Current_Depth_m) : 0;
  const baseFlow = globalLatest?.Flow_Rate_lpm != null ? Number(globalLatest.Flow_Rate_lpm) : 0;
  const basePv = globalLatest?.Plastic_Viscosity != null ? Number(globalLatest.Plastic_Viscosity) : 0;
  const baseYp = globalLatest?.Yield_Point != null ? Number(globalLatest.Yield_Point) : 0;
  const baseRho = globalLatest?.Mud_Density_SG != null ? Number(globalLatest.Mud_Density_SG) : 1.2;
  const mudPct = globalLatest?.Mud_Level_pct != null ? Number(globalLatest.Mud_Level_pct) : 0;

  const baseNozzle = Number(bhaConfig?.bit_nozzle_size ?? 12);
  const targetFlow = activeChangeParam === 'flow' ? parseOptionalNumber(targetFlowStr) : null;
  // Floor at 100 L/min matches legacy simulator stability (same as previous delta-based UI).
  const simFlow = Math.max(100, targetFlow != null ? targetFlow : baseFlow);
  const targetPv = activeChangeParam === 'yp' ? parseOptionalNumber(targetPvStr) : null;
  const targetYp = activeChangeParam === 'yp' ? parseOptionalNumber(targetYpStr) : null;
  const simPv = Math.max(1, targetPv != null ? targetPv : basePv);
  const simYp = Math.max(0, targetYp != null ? targetYp : baseYp);
  const targetNozzle = activeChangeParam === 'nozzle' ? parseOptionalNumber(targetNozzleStr) : null;
  const simNozzleSize = Math.max(1, targetNozzle != null ? targetNozzle : baseNozzle);
  const simNozzleQty = Number(bhaConfig?.bit_nozzle_qty ?? 3);
  const targetSg = activeChangeParam === 'density' ? densityInputToSg(targetDensityStr, densityUnit) : null;
  const simDensity = targetSg != null && Number.isFinite(targetSg) ? targetSg : baseRho;

  const hyd = computeHydraulicsPsi({
    densitySg: simDensity, flowLpm: simFlow, pv: simPv, yp: simYp, depthM, config: bhaConfig,
    nozzleSizeThirtySeconds: simNozzleSize, nozzleQty: simNozzleQty,
  });
  const pumpPsi = hyd.pumpPsi;
  const pumpOver = pumpPsi > maxPumpPressurePsi;

  // --- Density mode: solids loading (kg per metric ton of mud) + pit freeboard overflow (m³) ---
  const sgSolid = agent === 'calcite' ? CALCITE_SG : BARITE_SG;
  let kgPerTon = null;
  let overflowVol = null;
  if (activeChangeParam === 'density' && targetSg != null && Number.isFinite(targetSg)) {
    const rho1 = baseRho * 1000;
    const rho2 = targetSg * 1000;
    const rhoS = sgSolid * 1000;
    if (rho2 > rho1 && rho2 < rhoS) {
      kgPerTon = (1000 * (rho2 - rho1)) / (rhoS - rho2);
      const dV = kgPerTon / rhoS;
      const totalM3 = toMetersTank(tankDim.length, tankDimUnit) * toMetersTank(tankDim.width, tankDimUnit) * toMetersTank(tankDim.height, tankDimUnit);
      const curM3 = totalM3 * (mudPct / 100);
      const cap = totalM3 - curM3;
      overflowVol = Math.max(0, dV - cap);
    }
  }

  const vt = viscTwin(simPv, simYp);
  const title = activeChangeParam === 'density' ? t.twin_density_title : activeChangeParam === 'yp' ? t.twin_rheo_title : activeChangeParam === 'nozzle' ? t.twin_nozzle_title : t.twin_flow_title;
  const rs = { display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' };
  const vs = { color: 'var(--text-primary)', fontWeight: 'bold' };

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
            {kgPerTon != null && Number.isFinite(kgPerTon) && (
              <p style={{ marginTop: '0.6rem', fontSize: '0.85rem' }}>
                {t.twin_kg_per_ton}:{' '}
                <span style={vs}>
                  {kgPerTon.toFixed(1)} {t.twin_unit_kg}
                </span>
              </p>
            )}
            {overflowVol != null && overflowVol > 0 && <p style={{ marginTop: '0.4rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{t.twin_overflow}: {volFromM3Twin(overflowVol, tankVolUnit).toFixed(2)} {tankVolUnit}</p>}
          </div>
        )}
        {/* Mode: absolute PV / YP targets (cP and lbf/100ft²) */}
        {activeChangeParam === 'yp' && (
          <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t.twin_target_pv}
              <input
                type="number"
                step="0.1"
                min="0"
                value={targetPvStr}
                onChange={(e) => setTargetPvStr(e.target.value)}
                placeholder={`${basePv.toFixed(1)}`}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t.twin_target_yp}
              <input
                type="number"
                step="0.1"
                min="0"
                value={targetYpStr}
                onChange={(e) => setTargetYpStr(e.target.value)}
                placeholder={`${baseYp.toFixed(1)}`}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', boxSizing: 'border-box' }}
              />
            </label>
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
          <div style={rs}><span>{t.twin_pv_used}</span><span style={vs}>{simPv.toFixed(1)}</span></div>
          <div style={rs}><span>{t.twin_yp_used}</span><span style={vs}>{simYp.toFixed(1)}</span></div>
          <div style={rs}>
            <span>{t.twin_visc_twin}</span>
            <span style={vs}>{vt.toFixed(2)}</span>
          </div>
          <div style={rs}><span>{t.twin_bit}</span><span style={vs}>{toDisplayPressure(hyd.bitPsi)}</span></div>
          <div style={rs}><span>{t.twin_inner}</span><span style={vs}>{toDisplayPressure(hyd.innerPipePsi)}</span></div>
          <div style={rs}><span>{t.twin_annulus}</span><span style={vs}>{toDisplayPressure(hyd.annulusPsi)}</span></div>
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
