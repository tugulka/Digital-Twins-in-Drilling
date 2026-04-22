/**
 * Drilling digital-twin dashboard: React UI talks to a local FastAPI server that reads
 * SQLite rows written by mock_data_gen.py. Raw sensor fields are stored in SI-friendly
 * bases (e.g. pressure in PSI, flow in L/min); this file converts for display units.
 */
import React, { useState, useEffect } from 'react';
import './index.css';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

/** 1 PSI ≈ 0.0689476 bar (same factor used in convertValue and pump gauge scaling). */
const PSI_TO_BAR = 0.0689476;

const DICTIONARY = {
  TR: {
    app_title: "Sondaj İçin Dijital İkiz Paneli",
    app_subtitle: "Sürekli Reoloji ve Basınç Takip Paneli",
    sys_active: "Sistem Aktif - Canlı Veri Akışı",
    sys_waiting: "Bağlantı Bekleniyor...",
    api_error: "Veri alınamadı: API Sunucusuna ulaşılamıyor.",
    flow_label: "AKIŞ",
    press_label: "BASINÇ",
    temp_label: "SICAKLIK",
    rop_name: "İlerleme Hızı (ROP)",
    level_name: "Tank Seviyesi",
    flow_name: "Akış Hızı",
    pump_name: "Pompa Basıncı",
    standpipe_name: "Standpipe Basıncı",
    temp_name: "Çamur Sıcaklığı",
    yp_name: "Akma Gerilmesi",
    pv_name: "Kıvam İndeksi",
    n_name: "Akış Davranış İndeksi",
    change: "değişim",
    close: "✕ Kapat",
    graph: "Grafiği",
    graph_sub: "Eşzamanlı Operasyon Değişim Analizi",
    live: "Canlı (30s)",
    last5m: "Son 5 dk",
    last30m: "Son 30 dk",
    last1h: "Son 1 saat",
    last24h: "Son 24 saat",
    tank_l: "Uzunluk (m)",
    tank_w: "Genişlik (m)",
    tank_h: "Yükseklik (m)",
    max_press: "Maks. Basınç",
    liner_rad: "Liner Yarıçapı",
    density_label: "YOĞUNLUK",
    density_name: "Çamur Yoğunluğu",
    local_time_label: "YEREL SAAT",
    alarm_influx: "KICK / INFLUX (Kuyu İçi Akış)",
    alarm_loss: "ÇAMUR KAÇAĞI (Mud Loss)",
    alarm_volume: "Anormal Hacim Hareketi",
    alarm_dismiss: "MÜDAHALE ET / SUSTUR",
    alarm_thresh_influx: "Influx Eşiği",
    alarm_thresh_loss: "Kaçak Eşiği",
    alarm_dev: "sapma"
  },
  EN: {
    app_title: "Digital Twins in Drilling Panel",
    app_subtitle: "Continuous Rheology & Pressure Monitoring Panel",
    sys_active: "System Active - Live Data Stream",
    sys_waiting: "Waiting for Connection...",
    api_error: "Data fetch failed: API Server unreachable.",
    flow_label: "FLOW",
    press_label: "PRESSURE",
    temp_label: "TEMP",
    rop_name: "Rate of Penetration (ROP)",
    level_name: "Mud Pit Level",
    flow_name: "Flow Rate",
    pump_name: "Pump Pressure",
    standpipe_name: "Standpipe Pressure",
    temp_name: "Mud Temperature",
    yp_name: "Yield Point",
    pv_name: "Plastic Viscosity",
    n_name: "Flow Behavior Index",
    change: "change",
    close: "✕ Close",
    graph: "Graph",
    graph_sub: "Real-time Operation Variance Analysis",
    live: "Live (30s)",
    last5m: "Last 5 Min",
    last30m: "Last 30 Min",
    last1h: "Last 1 Hour",
    last24h: "Last 24 Hours",
    tank_l: "Length (m)",
    tank_w: "Width (m)",
    tank_h: "Height (m)",
    max_press: "Max Pressure",
    liner_rad: "Liner Radius",
    density_label: "DENSITY",
    density_name: "Mud Density",
    local_time_label: "LOCAL TIME",
    alarm_influx: "KICK / INFLUX",
    alarm_loss: "MUD LOSS",
    alarm_volume: "Abnormal Volume Movement",
    alarm_dismiss: "ACKNOWLEDGE / MUTE",
    alarm_thresh_influx: "Influx Threshold",
    alarm_thresh_loss: "Loss Threshold",
    alarm_dev: "deviation"
  }
};

/** Map API numeric fields to the unit system selected in the settings bar. */
const convertValue = (val, type, units) => {
  if (val === undefined || val === null) return val;
  let v = Number(val);
  switch(type) {
     case 'rop':
       return units.rop === 'ft/h' || units.rop === 'ft/sa' ? v * 3.28084 : v;
     case 'flow':
       if(units.flow.includes('gal')) return v * 0.264172;
       if(units.flow.includes('bbl')) return v / 158.987;
       return v;
     case 'pressure':
       return units.pressure === 'bar' ? v * PSI_TO_BAR : v;
     case 'temp':
       return units.temp === '°F' ? (v * 1.8 + 32) : v;
     case 'density':
       if (units.density === 'lb/gal') return v * 8.345;
       if (units.density === 'lb/ft³') return v * 62.428;
       return v;
     case 'depth':
       return units.depth === 'ft' ? (v * 3.28084) : v;
     default:
       return v;
  }
};

const getSensorsConfig = (units, lang) => {
  const t = DICTIONARY[lang];
  const ropUnit = lang === 'TR' ? units.rop.replace('/h', '/sa') : units.rop;
  const flowUnit = lang === 'TR' ? units.flow.replace('/min', '/dk') : units.flow;

  return [
    { id: 'ROP_m_h', type: 'rop', name: t.rop_name, unit: ropUnit, icon: '⚡' },
    { id: 'Mud_Level_pct', type: 'none', name: t.level_name, unit: '%', icon: '🛢️' },
    { id: 'Flow_Rate_lpm', type: 'flow', name: t.flow_name, unit: flowUnit, icon: '🌊' },
    { id: 'Pump_Press_psi', type: 'pressure', name: t.pump_name, unit: units.pressure, icon: '🔧' },
    { id: 'Standpipe_Press_psi', type: 'pressure', name: t.standpipe_name, unit: units.pressure, icon: '🏗️' },
    { id: 'Mud_Temp_C', type: 'temp', name: t.temp_name, unit: units.temp, icon: '🌡️' },
    { id: 'Yield_Point', type: 'none', name: t.yp_name, unit: 'lbf/100ft²', icon: '💧' },
    { id: 'Plastic_Viscosity', type: 'none', name: t.pv_name, unit: 'cP', icon: '🧪' },
    { id: 'Flow_Behavior_Index', type: 'none', name: t.n_name, unit: 'n', icon: '📊' },
    { id: 'Mud_Density_SG', type: 'density', name: t.density_name, unit: units.density, icon: '⚖️' },
    { id: 'Current_Depth_m', type: 'depth', name: lang === 'TR' ? 'Toplam Derinlik' : 'Total Depth', unit: units.depth, icon: '📏' }
  ];
};

function SensorCard({ sensor, value, previousValue, onClick, t }) {
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (value === previousValue || previousValue === undefined) return;
    let clearFlash;
    const id = setTimeout(() => {
      setChanged(true);
      clearFlash = setTimeout(() => setChanged(false), 500);
    }, 0);
    return () => {
      clearTimeout(id);
      if (clearFlash) clearTimeout(clearFlash);
    };
  }, [value, previousValue]);

  const trend = value > previousValue ? 'trend-up' : value < previousValue ? 'trend-down' : 'trend-neutral';
  const trendIcon = value > previousValue ? '↑' : value < previousValue ? '↓' : '→';
  const diff = typeof value === 'number' && typeof previousValue === 'number' ? Math.abs(value - previousValue).toFixed(2) : '0';

  return (
    <div className="sensor-card" onClick={onClick}>
      <div className="card-header">
        <span className="card-title">{sensor.name}</span>
        <span className="card-icon">{sensor.icon}</span>
      </div>
      <div className={`card-value ${changed ? 'value-changed' : ''}`}>
        {value !== undefined ? value : '--'}
        <span className="card-unit">{sensor.unit}</span>
      </div>
      {previousValue !== undefined && value !== undefined && (
        <div className={`trend-indicator ${trend}`}>
          <span>{trendIcon}</span>
          <span>{diff} {t.change}</span>
        </div>
      )}
    </div>
  );
}

function RheologyCard({ group, latest, previous, onClick, t, units }) {
    const [changed, setChanged] = useState(false);
  
    useEffect(() => {
       const c = group.sensors.some(
         (s) => latest && previous && latest[s.id] !== previous[s.id]
       );
       if (!c) return;
       let clearFlash;
       const id = setTimeout(() => {
         setChanged(true);
         clearFlash = setTimeout(() => setChanged(false), 500);
       }, 0);
       return () => {
         clearTimeout(id);
         if (clearFlash) clearTimeout(clearFlash);
       };
    }, [latest, previous, group.sensors]);
  
    return (
      <div className={`sensor-card ${changed ? 'value-changed' : ''}`} onClick={onClick} style={{ cursor: 'pointer' }}>
        <div className="card-header" style={{ marginBottom: '1.25rem' }}>
          <span className="card-title">{t.app_title.includes('Dijital') ? 'Çamur Reolojisi' : 'Mud Rheology'}</span>
          <span className="card-icon">🧪</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
           {group.sensors.map(s => {
               const valRaw = latest ? latest[s.id] : undefined;
               const prevRaw = previous ? previous[s.id] : undefined;
               
               const val = valRaw !== undefined ? parseFloat(Number(convertValue(valRaw, s.type, units)).toFixed(2)) : undefined;
               const prev = prevRaw !== undefined ? parseFloat(Number(convertValue(prevRaw, s.type, units)).toFixed(2)) : undefined;

               const trendIcon = val > prev ? '↑' : val < prev ? '↓' : '→';
               const trendCol = val > prev ? 'var(--success)' : val < prev ? 'var(--danger)' : 'var(--text-secondary)';
               
               return (
                 <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{s.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                       <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{val !== undefined ? val : '--'}</span>
                       <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.unit}</span>
                       {prev !== undefined && val !== undefined && <span style={{ color: trendCol, fontSize: '0.8rem', width: '12px' }}>{trendIcon}</span>}
                    </div>
                 </div>
               )
           })}
        </div>
      </div>
    );
}

function TankCard({ sensor, value, previousValue, bhaConfig, latest, onClick, t }) {
  // --- UI States ---
  const [changed, setChanged] = useState(false); // Triggers visual flash on value change
  const [showSettings, setShowSettings] = useState(false);
  const [dimUnit, setDimUnit] = useState('m'); // Base unit for tank dimensions
  const [volUnit, setVolUnit] = useState('m³'); // Selected unit for volume display

  // --- Configuration States ---
  const [dim, setDim] = useState({ length: 12, width: 3.5, height: 2.5 }); // Tank dimensions
  const [alarmThresholdInflux, setAlarmThresholdInflux] = useState(1.0);
  const [alarmThresholdLoss, setAlarmThresholdLoss] = useState(1.0);
  const [influxAlarmSet, setInfluxAlarmSet] = useState(false);
  const [lossAlarmSet, setLossAlarmSet] = useState(false);
  const [activeAlarmType, setActiveAlarmType] = useState(null); // 'influx', 'loss', or null
  const [isAlarmMuted, setIsAlarmMuted] = useState(false); // User overrides alarm pop-up
  const [lastAlarmTime, setLastAlarmTime] = useState(0); // Tracks cooldown

  // --- Internal Data History ---
  // Rather than relying on the graph's chartData (which breaks if not selected), 
  // the Tank internally buffers past values and timestamps to find reliable rate-of-change.
  const [localHistory, setLocalHistory] = useState([]);

  // Track changes to create a brief flash effect, making the UI feel dynamic.
  useEffect(() => {
    if (value === previousValue || previousValue === undefined) return;
    let clearFlash;
    const id = setTimeout(() => {
      setChanged(true);
      clearFlash = setTimeout(() => setChanged(false), 500);
    }, 0);

    // Buffer the current value and current time to establish mathematical rate
    setLocalHistory(prev => {
        const now = Date.now();
        // Discard data older than recent buffer window to maintain memory efficiency 
        // We keep up to 10 instances representing ~20 seconds of real-time server activity.
        const updated = [...prev, { val: Number(value), time: now }];
        if (updated.length > 8) updated.shift();
        return updated;
    });

    return () => {
      clearTimeout(id);
      if (clearFlash) clearTimeout(clearFlash);
    };
  }, [value, previousValue]);

  const pct = value !== undefined ? Number(value) : 0;
  
  const toMeters = (val, maxUnit) => {
    if (maxUnit === 'cm') return val / 100;
    if (maxUnit === 'ft') return val * 0.3048;
    return val;
  };
  const volFromM3 = (m3, targetVolUnit) => {
    if (targetVolUnit === 'gal') return m3 * 264.172;
    if (targetVolUnit === 'bbl') return m3 * 6.28981;
    return m3;
  };

  // Geometry calculation for the Tank's total and active capacities
  const totalVolumeM3 = toMeters(dim.length, dimUnit) * toMeters(dim.width, dimUnit) * toMeters(dim.height, dimUnit);
  const totalVolume = volFromM3(totalVolumeM3, volUnit);
  const currentVolume = totalVolume * (pct / 100);

  // --- Real-time Derivative Engine ---
  let rateStr = '--';
  let isGain = false;
  let isLoss = false;
  let currentRate = 0;

  if (localHistory.length >= 4) {
      // Fetch the oldest record in the buffer to create a stable slope
      const startRecord = localHistory[0];
      const endRecord = localHistory[localHistory.length - 1];
      const dtHours = (endRecord.time - startRecord.time) / 1000 / 3600;

      if (dtHours > 0) {
          const oldVol = totalVolume * (startRecord.val / 100);
          const newVol = totalVolume * (endRecord.val / 100);
          currentRate = (newVol - oldVol) / dtHours;
          
          isGain = currentRate > 0.05;
          isLoss = currentRate < -0.05;
          rateStr = `${currentRate > 0 ? '+' : ''}${currentRate.toFixed(1)} ${volUnit}/h`;
      }
  }

  // --- Physics Correlation Engine ---
  // The system checks if the tank volume flux matches rock displacement (Drilled Volume).
  // Formula: D_hole = ROP * Area of Bit. 
  useEffect(() => {
      // Ensure we have active drilling velocity and dimensional metrics
      if (!bhaConfig || !latest || latest.ROP_m_h === undefined || localHistory.length < 4) return;
      
      const rop_m_h = Number(latest.ROP_m_h);
      const bit_diameter_in = Number(bhaConfig.bit_diameter);
      
      // Calculate Hole cross-sectional Area (A = pi * r^2). Conversion: inch -> meters
      const bit_radius_m = (bit_diameter_in * 0.0254) / 2;
      const hole_area_m2 = Math.PI * Math.pow(bit_radius_m, 2);
      
      // Calculate Expected Volumetric Flow (in m^3/h)
      // Since drilling naturally displaces soil, the Mud Pit fundamentally LOSES mud 
      // equal to the magnitude of the hole generated (Expected Negative Value).
      const expectedRockLoss_m3_h = -(rop_m_h * hole_area_m2);
      
      // Cast the M^3 result into the specific active volume unit (bbl, gal) to maintain 1:1 scale mathematically
      const expectedDisplacementUnit_h = volFromM3(expectedRockLoss_m3_h, volUnit);
      
      // Real rate vs expected loss
      const difference = currentRate - expectedDisplacementUnit_h;
      
      let nextAlarmType = null;
      if (influxAlarmSet && difference > alarmThresholdInflux) {
          nextAlarmType = 'influx';
      } else if (lossAlarmSet && difference < -alarmThresholdLoss) {
          nextAlarmType = 'loss';
      }
      
      const now = Date.now();
      const canTriggerNewAlarm = (now - lastAlarmTime) >= 60000;

      if (nextAlarmType) {
          if (activeAlarmType !== nextAlarmType) {
              if (canTriggerNewAlarm) {
                  setActiveAlarmType(nextAlarmType);
                  setLastAlarmTime(now);
                  setIsAlarmMuted(false);
              } else if (activeAlarmType !== null) {
                  setActiveAlarmType(null);
                  setIsAlarmMuted(false);
              }
          }
      } else {
          setActiveAlarmType(null);
          setIsAlarmMuted(false); // Reset mute layer returning to safety
      }
  }, [currentRate, bhaConfig, latest, volUnit, alarmThresholdInflux, alarmThresholdLoss, influxAlarmSet, lossAlarmSet, isAlarmMuted, activeAlarmType, lastAlarmTime, localHistory.length]);

  // Utility to handle alarm dismissal popup
  const handleAcknowledgeAlarm = (e) => {
      e.stopPropagation();
      setActiveAlarmType(null);
      setIsAlarmMuted(true);
  };

  const isAlarmActive = activeAlarmType !== null;

  return (
    <div className="sensor-card">
      <div className="card-header" style={{ marginBottom: '1rem' }} onClick={onClick}>
        <span className="card-title">{sensor.name}</span>
        <button 
           onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }} 
           style={{ background: 'none', border:'none', fontSize: '1.25rem', cursor:'pointer', filter:'grayscale(10%)', transition:'transform 0.2s', transform: showSettings ? 'rotate(90deg)' : 'none'}}
           title="Settings"
        >
           ⚙️
        </button>
      </div>

      <div className="tank-container" style={{ position: 'relative' }}>
         {(() => {
           const alarmColor = activeAlarmType === 'influx' ? '#f59e0b' : 'var(--danger)';
           const alarmRgba = activeAlarmType === 'influx' ? 'rgba(245, 158, 11, 0.6)' : 'rgba(239, 68, 68, 0.6)';
           const alarmTitle = activeAlarmType === 'influx' ? t.alarm_influx : (activeAlarmType === 'loss' ? t.alarm_loss : '');
           return (
             <React.Fragment>
             <div className={`tank-visual-wrapper ${changed ? 'value-changed' : ''}`} onClick={onClick} style={{ borderColor: isAlarmActive ? alarmColor : 'var(--panel-border)', boxShadow: isAlarmActive ? `0 0 15px ${alarmRgba}` : 'none', transition: 'all 0.3s' }}>
                <div className="tank-level" style={{ height: `${pct}%`, background: isAlarmActive ? alarmRgba : 'rgba(56, 189, 248, 0.4)' }} />
                <div className="tank-level-text" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span>{pct.toFixed(1)}%</span>
                  {rateStr && (
                      <span style={{ fontSize: '0.85rem', marginTop: '0.3rem', color: isGain ? '#10b981' : (isLoss ? '#ef4444' : '#9ca3af'), textShadow: '1px 1px 2px #000' }}>
                         {rateStr}
                      </span>
                  )}
                </div>
             </div>
             
             {/* Render a critical alert badge covering the tank if alarm is deployed */}
             {isAlarmActive && (
                 <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', zIndex: 10 }}>
                    <span style={{ color: alarmColor, fontWeight: 'bold', fontSize: '1.2rem', animation: 'pulse 1s infinite', textAlign: 'center' }}>{alarmTitle}</span>
                    <span style={{ color: '#fff', fontSize: '0.8rem', textAlign: 'center', margin: '0.5rem' }}>{t.alarm_volume}</span>
                    <button onClick={handleAcknowledgeAlarm} style={{ background: 'var(--warning)', border: 'none', color: '#000', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginTop: '0.5rem', textAlign: 'center' }}>{t.alarm_dismiss}</button>
                 </div>
             )}
             </React.Fragment>
           );
         })()}
        
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', padding: '0 0.2rem' }}>
           <span>{currentVolume.toFixed(1)} {volUnit}</span>
           <span>{totalVolume.toFixed(1)} {volUnit}</span>
        </div>

        {/* Tank Detailed Configuration & Alarm Bounds */}
        {showSettings && (
          <div className="tank-settings-panel" onClick={(e) => e.stopPropagation()}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', marginBottom: '0.8rem' }}>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select value={dimUnit} onChange={e=>setDimUnit(e.target.value)} className="setting-dropdown" style={{ padding: '0.2rem', fontSize: '0.8rem' }}>
                        <option value="m">m</option>
                        <option value="cm">cm</option>
                        <option value="ft">ft</option>
                    </select>
                 </div>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select value={volUnit} onChange={e=>setVolUnit(e.target.value)} className="setting-dropdown" style={{ padding: '0.2rem', fontSize: '0.8rem' }}>
                        <option value="m³">m³</option>
                        <option value="gal">gal</option>
                        <option value="bbl">bbl</option>
                    </select>
                 </div>
             </div>
             
             <div className="tank-dimensions" style={{ marginBottom: '1rem' }}>
                 <input type="number" step="0.1" value={dim.length} onChange={e => setDim({...dim, length: Number(e.target.value)})} title={t.tank_l} /> 
                 <span className="tank-dim-x">x</span>
                 <input type="number" step="0.1" value={dim.width} onChange={e => setDim({...dim, width: Number(e.target.value)})} title={t.tank_w} />
                 <span className="tank-dim-x">x</span>
                 <input type="number" step="0.1" value={dim.height} onChange={e => setDim({...dim, height: Number(e.target.value)})} title={t.tank_h}/>
             </div>

             <div style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                     <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 'bold' }}>{t.alarm_thresh_influx || 'Influx'}</div>
                     <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                         <input type="number" step="0.5" disabled={influxAlarmSet} value={alarmThresholdInflux} onChange={e => setAlarmThresholdInflux(Number(e.target.value))} style={{ width: '3.5rem', padding: '0.2rem', background: influxAlarmSet ? 'rgba(255,255,255,0.1)' : 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: influxAlarmSet ? '#9ca3af' : '#fff', fontSize: '0.8rem' }} />
                         <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{volUnit}/h</span>
                         <button onClick={(e) => { e.stopPropagation(); setInfluxAlarmSet(!influxAlarmSet); }} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: influxAlarmSet ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: influxAlarmSet ? 'var(--danger)' : 'var(--success)', border: 'none', borderRadius: '4px', cursor: 'pointer', outline: 'none' }}>
                            {influxAlarmSet ? 'Kapat / Off' : 'Ayarla / Set'}
                         </button>
                     </div>
                 </div>
                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                     <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 'bold' }}>{t.alarm_thresh_loss || 'Loss'}</div>
                     <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                         <input type="number" step="0.5" disabled={lossAlarmSet} value={alarmThresholdLoss} onChange={e => setAlarmThresholdLoss(Number(e.target.value))} style={{ width: '3.5rem', padding: '0.2rem', background: lossAlarmSet ? 'rgba(255,255,255,0.1)' : 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: lossAlarmSet ? '#9ca3af' : '#fff', fontSize: '0.8rem' }} />
                         <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{volUnit}/h</span>
                         <button onClick={(e) => { e.stopPropagation(); setLossAlarmSet(!lossAlarmSet); }} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: lossAlarmSet ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: lossAlarmSet ? 'var(--danger)' : 'var(--success)', border: 'none', borderRadius: '4px', cursor: 'pointer', outline: 'none' }}>
                            {lossAlarmSet ? 'Kapat / Off' : 'Ayarla / Set'}
                         </button>
                     </div>
                 </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pump pressure with a semi-circular gauge. `value` is already converted for display
 * (PSI or bar). The scale maximum is stored canonically in PSI so the needle ratio
 * stays correct when the user switches units without duplicating state in an effect.
 */
function PumpCard({ sensor, value, onClick, t, pressureUnit }) {
  const [showSettings, setShowSettings] = useState(false);
  const [maxPressurePsi, setMaxPressurePsi] = useState(5000);
  const [linerRadius, setLinerRadius] = useState(6.0);
  const [lrUnit, setLrUnit] = useState('in');

  const gaugeMax = pressureUnit === 'bar' ? maxPressurePsi * PSI_TO_BAR : maxPressurePsi;
  const maxDisplay = gaugeMax;
  const currentValue = value !== undefined ? Number(value) : 0;
  const pct = gaugeMax > 0 ? Math.min(Math.max(currentValue / gaugeMax, 0), 1) : 0;
  const arcLength = 251.2; 
  const strokeDashoffset = arcLength - (arcLength * pct);

  return (
    <div className="sensor-card">
      <div className="card-header" style={{ marginBottom: '0.5rem' }} onClick={onClick}>
        <span className="card-title">{sensor.name}</span>
        <button 
           onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }} 
           style={{ background: 'none', border:'none', fontSize: '1.25rem', cursor:'pointer', filter:'grayscale(10%)', transition:'transform 0.2s', transform: showSettings ? 'rotate(90deg)' : 'none'}}
           title="Settings"
        >
           ⚙️
        </button>
      </div>

      <div className="pump-container">
         <div onClick={onClick} style={{ cursor: 'pointer', padding: '0.5rem 0' }}>
            <svg width="100%" viewBox="0 0 200 130" style={{display: 'block'}}>
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--panel-border)" strokeWidth="15" strokeLinecap="round" />
              
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--accent-color)" strokeWidth="15" strokeLinecap="round" strokeDasharray={arcLength} strokeDashoffset={strokeDashoffset} style={{transition: 'stroke-dashoffset 0.5s ease-out', filter: 'drop-shadow(0 0 5px var(--accent-glow))'}} />
              
              <text x="100" y="85" textAnchor="middle" fill="var(--text-primary)" fontSize="36" fontWeight="bold">
                {currentValue.toFixed(0)}
              </text>
              <text x="100" y="105" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                {sensor.unit}
              </text>
              
              <text x="20" y="120" textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontWeight="bold">0</text>
              <text x="180" y="120" textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontWeight="bold">{Math.round(maxDisplay)}</text>
            </svg>
         </div>

         {showSettings && (
          <div className="tank-settings-panel" onClick={(e) => e.stopPropagation()}>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{t.max_press}:</label>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <input type="number" step={pressureUnit === 'bar' ? 1 : 100} value={maxDisplay} onChange={e => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        setMaxPressurePsi(pressureUnit === 'bar' ? v / PSI_TO_BAR : v);
                      }} style={{ width: '70px', padding:'0.2rem', background:'rgba(0,0,0,0.3)', border:'1px solid var(--panel-border)', color:'white', borderRadius:'4px', outline:'none', textAlign:'center', fontFamily:'inherit' }} />
                      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{sensor.unit}</span>
                    </div>
                 </div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{t.liner_rad}:</label>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                       <input type="number" step="0.5" value={linerRadius} onChange={e => setLinerRadius(Number(e.target.value))} style={{ width: '50px', padding:'0.2rem', background:'rgba(0,0,0,0.3)', border:'1px solid var(--panel-border)', color:'white', borderRadius:'4px', outline:'none', textAlign:'center', fontFamily:'inherit' }} />
                       <select value={lrUnit} onChange={e=>setLrUnit(e.target.value)} className="setting-dropdown" style={{ padding: '0.2rem', fontSize: '0.75rem' }}>
                           <option value="in">in</option>
                           <option value="cm">cm</option>
                           <option value="mm">mm</option>
                       </select>
                    </div>
                 </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [globalLatest, setGlobalLatest] = useState(null);
  const [globalPrev, setGlobalPrev] = useState(null);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  useEffect(() => {
     const t = setInterval(() => setCurrentTime(new Date()), 1000);
     return () => clearInterval(t);
  }, []);
  
  const [selectedSensor, setSelectedSensor] = useState(null);
  const [activeRheologyTab, setActiveRheologyTab] = useState(0);

  const [showBHAConfig, setShowBHAConfig] = useState(false);
  const [bhaConfig, setBhaConfig] = useState({
      casings: '[{"start": 0, "end": 3000, "id": 8.5}]',
      length_unit: 'm',
      bit_diameter: 6.0, bit_nozzle_size: 12, bit_nozzle_qty: 3,
      dp1_id: 3.826, dp1_od: 4.5, dp1_length: 1500,
      dp2_id: 0, dp2_od: 0, dp2_length: 0,
      dc1_id: 2.50, dc1_od: 4.75, dc1_length: 200,
      dc2_id: 0, dc2_od: 0, dc2_length: 0,
      target_density: null, target_yp: null, target_flow_rate: null
  });

  // Digital Twin Control State
  const [activeChangeParam, setActiveChangeParam] = useState(null); // 'density', 'yp', 'nozzle', 'flow'
  const [changeInputValue, setChangeInputValue] = useState('');
  const [changeInputUnit, setChangeInputUnit] = useState('');

  const [chartData, setChartData] = useState([]);
  const [timeRange, setTimeRange] = useState('live');

  const [lang, setLang] = useState('TR'); 
  const t = DICTIONARY[lang];

  /** Clock: Turkish locale uses 24 h and localized digits/labels; English uses 24 h as well. */
  const formattedLocalTime =
    lang === 'TR'
      ? currentTime.toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      : currentTime.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

  const [units, setUnits] = useState({
    rop: 'm/h',
    flow: 'lt/min',
    pressure: 'PSI',
    temp: '°C',
    density: 'SG',
    depth: 'm'
  });
  const [selectedUnitParam, setSelectedUnitParam] = useState('rop');

  const SENSORS = getSensorsConfig(units, lang);
  const currentDepthValue =
    globalLatest?.Current_Depth_m !== undefined
      ? parseFloat(convertValue(globalLatest.Current_Depth_m, 'depth', units).toFixed(1))
      : null;

  // Define layout structures strictly
  const topSensors = [
    SENSORS.find(s => s.id === 'ROP_m_h'),
    SENSORS.find(s => s.id === 'Flow_Rate_lpm'),
    SENSORS.find(s => s.id === 'Standpipe_Press_psi'),
    SENSORS.find(s => s.id === 'Pump_Press_psi')
  ];

  const bottomSensors = [
    SENSORS.find(s => s.id === 'Mud_Level_pct'),
    SENSORS.find(s => s.id === 'Mud_Temp_C')
  ];

  const rheologyGroup = {
    isGroup: true,
    sensors: [
       SENSORS.find(s => s.id === 'Yield_Point'),
       SENSORS.find(s => s.id === 'Plastic_Viscosity'),
       SENSORS.find(s => s.id === 'Flow_Behavior_Index'),
       SENSORS.find(s => s.id === 'Mud_Density_SG')
    ]
  };

  /** Poll latest row for cards and connection status. */
  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/latest-data');
        if (!response.ok) throw new Error('Network Issue');
        const json = await response.json();
        
        if (!json.error) {
           setGlobalLatest(prev => {
             if (prev && prev.id !== json.id) setGlobalPrev(prev);
             return json;
           });
           setIsConnected(true);
           setError(null);
        }
      } catch {
        setIsConnected(false);
        setError(t.api_error);
      }
    };
    fetchLatest(); 
    const interval = setInterval(fetchLatest, 1000); 
    return () => clearInterval(interval);
  }, [t.api_error]);

  useEffect(() => {
     fetch('http://localhost:8000/api/config')
       .then(res => res.json())
       .then(data => { if (data.casings) setBhaConfig(data); })
       .catch(err => console.log(err));
  }, []);

  /** When a sensor modal is open, load history for the chart (live bucket vs time windows). */
  useEffect(() => {
    if (!selectedSensor) return;

    const fetchChart = async () => {
      try {
        let url = 'http://localhost:8000/api/history?limit=30';
        if (timeRange === '5m') url = 'http://localhost:8000/api/history?minutes=5';
        if (timeRange === '30m') url = 'http://localhost:8000/api/history?minutes=30';
        if (timeRange === '1h') url = 'http://localhost:8000/api/history?hours=1';
        if (timeRange === '24h') url = 'http://localhost:8000/api/history?hours=24';

        const response = await fetch(url);
        const jsonList = await response.json();
        
        if (jsonList && jsonList.length > 0) {
          const processedList = jsonList.map(item => {
             const timeStr = item.Timestamp ? item.Timestamp.split(' ')[1] : '';
             const displayTime = ['1h', '24h', '30m'].includes(timeRange) ? timeStr.substring(0, 5) : timeStr;
             
             let formattedObj = { ...item, formattedTime: displayTime };
             SENSORS.forEach(s => {
                 formattedObj[s.id] = parseFloat(convertValue(item[s.id], s.type, units).toFixed(2));
             });

             return formattedObj;
          });
          setChartData(processedList);
        }
      } catch (err) {
        console.error("Graph fetch error", err);
      }
    };

    fetchChart();
    let pollInterval = 1000;
    if (timeRange !== 'live') pollInterval = 3000; 
    const interval = setInterval(fetchChart, pollInterval);
    return () => clearInterval(interval);
  }, [selectedSensor, timeRange, units, SENSORS]); 

  // Language state sync for Modals
  useEffect(() => {
    if (selectedSensor) {
        if (selectedSensor.isGroup) {
             const upToDateSensors = selectedSensor.sensors.map(s => SENSORS.find(upS => upS.id === s.id));
             setSelectedSensor({ ...selectedSensor, sensors: upToDateSensors });
        } else {
             const upToDateSensor = SENSORS.find(s => s.id === selectedSensor.id);
             if(upToDateSensor) setSelectedSensor(upToDateSensor);
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, units]);

  return (
    <div className="dashboard-container">
      <header className="dashboard-header" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, background: 'rgba(0,0,0,0.3)', padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.local_time_label}</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-color)' }}>{formattedLocalTime}</span>
        </div>
        
        <div className="lang-toggle" style={{ position: 'absolute', top: 0, right: 0 }}>
            <button className={lang === 'TR' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('TR')}>TR</button>
            <button className={lang === 'EN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('EN')}>EN</button>
        </div>
        
        <h1>{t.app_title}</h1>
        <p>{t.app_subtitle}</p>
        
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <div className="status-badge" style={{ borderColor: isConnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isConnected ? 'var(--success)' : 'var(--danger)', marginTop: 0 }}>
              <div className="status-indicator" style={{ backgroundColor: isConnected ? 'var(--success)' : 'var(--danger)', animationPlayState: isConnected ? 'running' : 'paused', boxShadow: isConnected ? '0 0 10px var(--success)' : '0 0 10px var(--danger)' }} />
              {isConnected ? t.sys_active : t.sys_waiting}
            </div>
            
            <div 
               className="status-badge" 
               style={{ cursor: 'pointer', borderColor: 'rgba(56, 189, 248, 0.4)', background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(139, 92, 246, 0.15))', color: 'var(--accent-color)', marginTop: 0, fontSize: '1.2rem', padding: '0.6rem 2rem', boxShadow: '0 0 15px rgba(56, 189, 248, 0.3)' }}
               onClick={() => { setSelectedSensor(SENSORS.find(s => s.id === 'Current_Depth_m')); setTimeRange('live'); }}
            >
               <span>👇 {lang === 'TR' ? 'TOPLAM DERİNLİK:' : 'TOTAL DEPTH:'}</span>
               <span style={{ marginLeft: '0.8rem', fontWeight: 'bold', fontSize: '2rem', textShadow: '0 0 10px rgba(56, 189, 248, 0.8)' }}>
                  {currentDepthValue !== null
                      ? `${currentDepthValue} ${units.depth}`
                      : `0.0 ${units.depth}`}
               </span>
            </div>
        </div>
      </header>

      {/* SETTINGS PLACARD */}
      <div className="settings-bar">
         <div className="lang-toggle">
            <button className="lang-btn" style={{ background: 'rgba(56, 189, 248, 0.2)', color: 'var(--accent-color)', padding: '0.4rem 1rem' }} onClick={() => setShowBHAConfig(true)}>
               🛢️ {lang === 'TR' ? 'Kuyu Teçhizatı & Sondaj Dizisi' : 'Wellbore & BHA'}
            </button>
         </div>

         <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: 'auto' }}>
             <div style={{ background: 'var(--warning)', color: '#000', padding: '0.4rem 1rem', borderRadius: '15px', fontWeight: 'bold', fontSize: '0.85rem' }}>
                🎛️ {lang === 'TR' ? 'Değiştir' : 'Change'}
             </div>
             <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '6px', overflow: 'hidden' }}>
                 <button className="change-btn" onClick={() => { setActiveChangeParam('density'); setChangeInputUnit('SG'); }}>{lang === 'TR' ? 'Yoğunluk' : 'Density'}</button>
                 <button className="change-btn" onClick={() => { setActiveChangeParam('yp'); setChangeInputUnit('lbf/100ft²'); }}>{lang === 'TR' ? 'YP' : 'YP'}</button>
                 <button className="change-btn" onClick={() => { setActiveChangeParam('nozzle'); setChangeInputUnit('/32'); }}>{lang === 'TR' ? 'Nozzle' : 'Nozzle'}</button>
                 <button className="change-btn" onClick={() => { setActiveChangeParam('flow'); setChangeInputUnit('lpm'); }}>{lang === 'TR' ? 'Akış' : 'Flow'}</button>
             </div>
         </div>

         <style>{`
             .change-btn {
                 background: transparent;
                 border: none;
                 border-right: 1px solid var(--panel-border);
                 color: var(--text-primary);
                 padding: 0.4rem 0.8rem;
                 font-size: 0.8rem;
                 cursor: pointer;
                 transition: background 0.2s;
             }
             .change-btn:last-child {
                 border-right: none;
             }
             .change-btn:hover { background: rgba(56, 189, 248, 0.2); color: var(--accent-color); }
         `}</style>
         
         <div className="setting-item" style={{ background: 'rgba(0,0,0,0.2)', padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
            <label style={{ marginRight: '0.5rem', color: 'var(--accent-color)' }}>{lang === 'TR' ? 'BİRİMLER:' : 'UNITS:'}</label>
            
            <select className="setting-dropdown" style={{ marginRight: '0.5rem' }} value={selectedUnitParam} onChange={e => setSelectedUnitParam(e.target.value)}>
               <option value="rop">{lang === 'TR' ? 'İlerleme (ROP)' : 'Rate of Penetration (ROP)'}</option>
               <option value="flow">{lang === 'TR' ? 'Akış Hızı (Flow)' : 'Flow Rate'}</option>
               <option value="pressure">{lang === 'TR' ? 'Basınç (Pressure)' : 'Pressure'}</option>
               <option value="temp">{lang === 'TR' ? 'Sıcaklık (Temp)' : 'Temperature'}</option>
               <option value="density">{lang === 'TR' ? 'Yoğunluk (Density)' : 'Mud Density'}</option>
               <option value="depth">{lang === 'TR' ? 'Derinlik (Depth)' : 'Total Depth'}</option>
            </select>

            <select className="setting-dropdown" value={units[selectedUnitParam]} onChange={e => setUnits({...units, [selectedUnitParam]: e.target.value})}>
               {selectedUnitParam === 'rop' && (
                   <React.Fragment>
                     <option value="m/h">{lang === 'TR' ? 'm/sa' : 'm/h'}</option>
                     <option value="ft/h">{lang === 'TR' ? 'ft/sa' : 'ft/h'}</option>
                   </React.Fragment>
               )}
               {selectedUnitParam === 'flow' && (
                   <React.Fragment>
                     <option value="lt/min">{lang === 'TR' ? 'lt/dk' : 'lt/min'}</option>
                     <option value="gal/min">{lang === 'TR' ? 'gal/dk' : 'gal/min'}</option>
                     <option value="bbl/min">{lang === 'TR' ? 'bbl/dk' : 'bbl/min'}</option>
                   </React.Fragment>
               )}
               {selectedUnitParam === 'pressure' && (
                   <React.Fragment>
                     <option value="PSI">PSI</option>
                     <option value="bar">bar</option>
                   </React.Fragment>
               )}
               {selectedUnitParam === 'temp' && (
                   <React.Fragment>
                     <option value="°C">°C</option>
                     <option value="°F">°F</option>
                   </React.Fragment>
               )}
               {selectedUnitParam === 'density' && (
                   <React.Fragment>
                     <option value="SG">SG</option>
                     <option value="lb/gal">lb/gal</option>
                     <option value="lb/ft³">lb/ft³</option>
                   </React.Fragment>
               )}
               {selectedUnitParam === 'depth' && (
                   <React.Fragment>
                     <option value="m">m</option>
                     <option value="ft">ft</option>
                   </React.Fragment>
               )}
            </select>
         </div>
      </div>

      {error && <div style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '2rem' }}>{error}</div>}

      {/* TOP ROW */}
      <div className="grid-container" style={{ marginBottom: '1.5rem' }}>
         {topSensors[0] && (
            <SensorCard 
              sensor={topSensors[0]} t={t}
              value={globalLatest ? parseFloat(convertValue(globalLatest[topSensors[0].id], topSensors[0].type, units).toFixed(2)) : undefined} 
              previousValue={globalPrev ? parseFloat(convertValue(globalPrev[topSensors[0].id], topSensors[0].type, units).toFixed(2)) : undefined}
              onClick={() => { setSelectedSensor(topSensors[0]); setTimeRange('live'); }}
            />
         )}
         {topSensors[1] && (
            <SensorCard 
              sensor={topSensors[1]} t={t}
              value={globalLatest ? parseFloat(convertValue(globalLatest[topSensors[1].id], topSensors[1].type, units).toFixed(2)) : undefined} 
              previousValue={globalPrev ? parseFloat(convertValue(globalPrev[topSensors[1].id], topSensors[1].type, units).toFixed(2)) : undefined}
              onClick={() => { setSelectedSensor(topSensors[1]); setTimeRange('live'); }}
            />
         )}
         {topSensors[2] && (
            <SensorCard 
              sensor={topSensors[2]} t={t}
              value={globalLatest ? parseFloat(convertValue(globalLatest[topSensors[2].id], topSensors[2].type, units).toFixed(2)) : undefined} 
              previousValue={globalPrev ? parseFloat(convertValue(globalPrev[topSensors[2].id], topSensors[2].type, units).toFixed(2)) : undefined}
              onClick={() => { setSelectedSensor(topSensors[2]); setTimeRange('live'); }}
            />
         )}
         {topSensors[3] && (
            <PumpCard 
              sensor={topSensors[3]} t={t}
              pressureUnit={units.pressure}
              value={globalLatest ? parseFloat(convertValue(globalLatest[topSensors[3].id], topSensors[3].type, units).toFixed(2)) : undefined} 
              onClick={() => { setSelectedSensor(topSensors[3]); setTimeRange('live'); }}
            />
         )}
      </div>

      {/* BOTTOM ROW */}
      <div className="grid-container">
         {bottomSensors[0] && (
             <TankCard 
                sensor={bottomSensors[0]} t={t}
                value={globalLatest ? globalLatest[bottomSensors[0].id] : undefined} 
                previousValue={globalPrev ? globalPrev[bottomSensors[0].id] : undefined}
                bhaConfig={bhaConfig}
                latest={globalLatest}
                onClick={() => { setSelectedSensor(bottomSensors[0]); setTimeRange('live'); }}
             />
         )}
         {bottomSensors[1] && (
            <SensorCard 
              sensor={bottomSensors[1]} t={t}
              value={globalLatest ? parseFloat(convertValue(globalLatest[bottomSensors[1].id], bottomSensors[1].type, units).toFixed(2)) : undefined} 
              previousValue={globalPrev ? parseFloat(convertValue(globalPrev[bottomSensors[1].id], bottomSensors[1].type, units).toFixed(2)) : undefined}
              onClick={() => { setSelectedSensor(bottomSensors[1]); setTimeRange('live'); }}
            />
         )}
         <RheologyCard 
             group={rheologyGroup} 
             t={t}
             units={units}
             latest={globalLatest}
             previous={globalPrev}
             onClick={() => { setSelectedSensor(rheologyGroup); setActiveRheologyTab(0); setTimeRange('live'); }}
         />
      </div>

      {/* CHART MODAL */}
      {selectedSensor && (() => {
        const activeSensor = selectedSensor.isGroup ? selectedSensor.sensors[activeRheologyTab] : selectedSensor;

        return (
        <div className="modal-overlay" onClick={(e) => { if(e.target.classList.contains('modal-overlay')) setSelectedSensor(null); }}>
          <div className="modal-content">
             <button className="modal-close" onClick={() => setSelectedSensor(null)}>{t.close}</button>
             
             <div className="modal-header" style={{ marginBottom: '1rem' }}>
                <h2>{selectedSensor.isGroup ? '🧪' : activeSensor.icon} {selectedSensor.isGroup ? (t.app_title.includes('Dijital') ? 'Çamur Reolojisi Grafiği' : 'Mud Rheology Graph') : `${activeSensor.name} ${t.graph}`} ({activeSensor.unit})</h2>
                <p>{t.graph_sub}</p>
             </div>

             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                 {/* REOLOGY TABS */}
                 {selectedSensor.isGroup ? (
                   <div className="time-filters" style={{ margin: 0 }}>
                      {selectedSensor.sensors.map((s, idx) => (
                          <button 
                             key={s.id}
                             className={`time-btn ${activeRheologyTab === idx ? 'active' : ''}`}
                             style={{ borderRadius: '4px', padding: '0.4rem 0.8rem', border: activeRheologyTab === idx ? '1px solid var(--accent-color)' : '1px solid var(--panel-border)' }}
                             onClick={() => setActiveRheologyTab(idx)}
                          >
                              {s.name}
                          </button>
                      ))}
                   </div>
                 ) : <div></div>}

                 {/* TIME FILTERS */}
                 <div className="time-filters" style={{ margin: 0 }}>
                    {['live', '5m', '30m', '1h', '24h'].map(range => (
                        <button 
                           key={range}
                           className={`time-btn ${timeRange === range ? 'active' : ''}`}
                           onClick={() => setTimeRange(range)}
                        >
                           {range === 'live' ? t.live :
                            range === '5m' ? t.last5m :
                            range === '30m' ? t.last30m :
                            range === '1h' ? t.last1h : t.last24h}
                        </button>
                    ))}
                 </div>
             </div>
             
             <div style={{ width: '100%', height: '350px' }}>
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 15, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                    <XAxis dataKey="formattedTime" stroke="#94a3b8" fontSize={12} tickMargin={10} />
                    <YAxis stroke="#94a3b8" domain={['auto', 'auto']} fontSize={12} width={60} />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#0b0f19', borderColor: '#38bdf8', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#38bdf8', fontWeight: 'bold' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                    />
                    <Line 
                        type="monotone" 
                        dataKey={activeSensor.id} 
                        name={`${activeSensor.name} (${activeSensor.unit})`}
                        stroke={selectedSensor.isGroup ? "#f59e0b" : "#38bdf8"} 
                        strokeWidth={4} 
                        dot={timeRange === 'live' ? { r: 4, fill: '#0b0f19', stroke: selectedSensor.isGroup ? "#f59e0b" : "#38bdf8", strokeWidth: 2 } : false}
                        activeDot={{ r: 8, fill: selectedSensor.isGroup ? "#f59e0b" : "#38bdf8" }}
                        isAnimationActive={false}
                    />
                  </LineChart>
               </ResponsiveContainer>
             </div>
          </div>
        </div>
        );
      })()}

      {/* DIGITAL TWIN CONTROL MODAL */}
      {activeChangeParam && (() => {
        let title = '';
        let unitOptions = [];
        if (activeChangeParam === 'density') { title = lang==='TR' ? 'Hedef Yoğunluk Belirle' : 'Set Target Density'; unitOptions = ['SG', 'lb/gal', 'lb/ft³']; }
        if (activeChangeParam === 'yp') { title = lang==='TR' ? 'Etkin Akma Sınırı Belirle' : 'Set Target YP'; unitOptions = ['lbf/100ft²', 'Pa']; }
        if (activeChangeParam === 'nozzle') { title = lang==='TR' ? 'Nozzle Boyutu Değiştir' : 'Change Nozzle Size'; unitOptions = ['/32']; }
        if (activeChangeParam === 'flow') { title = lang==='TR' ? 'Akış Hızı Belirle' : 'Set Flow Rate'; unitOptions = ['lpm', 'gpm']; }

        const applyTarget = () => {
            let val = Number(changeInputValue);
            if (activeChangeParam === 'density') {
                if (changeInputUnit === 'lb/gal') val = val / 8.345;
                if (changeInputUnit === 'lb/ft³') val = val / 62.43;
                bhaConfig.target_density = val;
            } else if (activeChangeParam === 'yp') {
                // Sim YP is basically lbf/100ft2 mapping
                if (changeInputUnit === 'Pa') val = val * 0.020885;
                bhaConfig.target_yp = val;
            } else if (activeChangeParam === 'flow') {
                if (changeInputUnit === 'gpm') val = val * 3.78541; // gpm to lpm
                bhaConfig.target_flow_rate = val;
            } else if (activeChangeParam === 'nozzle') {
                bhaConfig.bit_nozzle_size = val;
            }

            fetch('http://localhost:8000/api/config', { 
               method: 'POST', 
               headers: {'Content-Type': 'application/json'},
               body: JSON.stringify(bhaConfig)
            }).then(() => {
               setBhaConfig({...bhaConfig});
               setActiveChangeParam(null);
               setChangeInputValue('');
            });
        };

        const resetTarget = () => {
            if (activeChangeParam === 'density') bhaConfig.target_density = null;
            if (activeChangeParam === 'yp') bhaConfig.target_yp = null;
            if (activeChangeParam === 'flow') bhaConfig.target_flow_rate = null;
            fetch('http://localhost:8000/api/config', { 
               method: 'POST', 
               headers: {'Content-Type': 'application/json'},
               body: JSON.stringify(bhaConfig)
            }).then(() => { setActiveChangeParam(null); setChangeInputValue(''); });
        };

        return (
        <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setActiveChangeParam(null); }}>
             <div className="modal-content" style={{ maxWidth: '450px', padding: '2rem', textAlign: 'center' }}>
                 <h2 style={{ marginBottom: '1rem', color: 'var(--warning)' }}>🎛️ {title}</h2>
                 <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                    {lang === 'TR' ? 'Simülasyon motoru yazdığınız bu rakamı ana hedef noktası (target) olarak kabul edecek ve o noktaya sabitlenecektir.' : 'The simulation engine will gravitate towards and lock onto this new defined target parameter.'}
                 </p>
                 <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem' }}>
                     <input type="number" step="0.1" value={changeInputValue} onChange={(e) => setChangeInputValue(e.target.value)} style={{ flex: 2, padding: '0.8rem', borderRadius: '4px', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '1.2rem', textAlign: 'center' }} placeholder={lang==='TR'?'Değer / Value':"Value"} />
                     <select value={changeInputUnit} onChange={(e) => setChangeInputUnit(e.target.value)} style={{ flex: 1, padding: '0.8rem', borderRadius: '4px', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: 'var(--accent-color)', fontSize: '1rem', cursor: 'pointer' }}>
                         {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                     </select>
                 </div>
                 <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                     {activeChangeParam !== 'nozzle' ? (
                        <button onClick={resetTarget} style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontSize:'0.85rem' }}>
                            ✖ {lang === 'TR' ? 'Otomatik Moda Dön' : 'Reset & Auto'}
                        </button>
                     ) : <div></div>}
                     <div style={{ display: 'flex', gap: '0.5rem' }}>
                         <button onClick={() => setActiveChangeParam(null)} style={{ background: 'transparent', border: '1px solid var(--text-secondary)', color: 'var(--text-secondary)', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontSize:'0.85rem' }}>İptal</button>
                         <button onClick={applyTarget} style={{ background: 'var(--warning)', border: 'none', color: '#000', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize:'0.85rem' }}>Uygula</button>
                     </div>
                 </div>
             </div>
        </div>
        );
      })()}

      {/* BHA & WELLBORE CONFIG MODAL */}
      {showBHAConfig && (() => {
        let parsedCasings = [];
        try { parsedCasings = JSON.parse(bhaConfig.casings); } catch { parsedCasings = []; }
        if (!Array.isArray(parsedCasings)) parsedCasings = [];

        const updateCasing = (idx, field, val) => {
           let copy = [...parsedCasings];
           copy[idx][field] = Number(val);
           setBhaConfig({...bhaConfig, casings: JSON.stringify(copy)});
        };
        const removeCasing = (idx) => {
           let copy = [...parsedCasings];
           copy.splice(idx, 1);
           setBhaConfig({...bhaConfig, casings: JSON.stringify(copy)});
        };
        const addCasing = () => {
           let copy = [...parsedCasings];
           copy.push({start: 0, end: 0, id: 0});
           setBhaConfig({...bhaConfig, casings: JSON.stringify(copy)});
        };

        return (
        <div className="modal-overlay" onClick={(e) => { if(e.target.classList.contains('modal-overlay')) setShowBHAConfig(false); }}>
          <div className="modal-content" style={{ maxWidth: '800px', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
             <div className="modal-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                   <h2>🛢️ {lang === 'TR' ? 'Kuyu Teçhizatı & Sondaj Dizisi' : 'Wellbore & BHA Configuration'}</h2>
                   <p style={{ marginTop: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      {lang === 'TR' ? 'Sürtünme kayıplarını ve hidrostatik verileri oluşturacak fiziksel tasarım.' : 'Physical design establishing friction losses and hydrostatic profiles.'}
                   </p>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--panel-border)' }}>
                        <button onClick={() => setBhaConfig({...bhaConfig, length_unit: 'm'})} style={{ padding: '0.3rem 0.6rem', border: 'none', background: bhaConfig.length_unit === 'm' ? 'var(--accent-color)' : 'transparent', color: bhaConfig.length_unit === 'm' ? '#000' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 'bold' }}>Meter (m)</button>
                        <button onClick={() => setBhaConfig({...bhaConfig, length_unit: 'ft'})} style={{ padding: '0.3rem 0.6rem', border: 'none', background: bhaConfig.length_unit === 'ft' ? 'var(--accent-color)' : 'transparent', color: bhaConfig.length_unit === 'ft' ? '#000' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 'bold' }}>Feet (ft)</button>
                    </div>
                    <button className="modal-close" style={{ position: 'relative', top: 0, right: 0 }} onClick={() => setShowBHAConfig(false)}>{t.close}</button>
                </div>
             </div>

             <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                    <h4 style={{ color: 'var(--accent-color)', marginBottom: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                        {lang === 'TR' ? 'Muhafaza Borusu (Casing) Profili' : 'Casing Profile'}
                        <button onClick={addCasing} style={{ background: 'transparent', border:'1px solid var(--accent-color)', color: 'var(--accent-color)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}>+ {lang === 'TR' ? 'Ekle' : 'Add'}</button>
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                       {parsedCasings.map((c, i) => (
                          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'var(--bg-dark)', padding: '0.5rem', borderRadius: '4px' }}>
                             <div style={{ flex: 1 }}>
                                 <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block' }}>{lang === 'TR' ? 'Başlangıç' : 'Start'} ({bhaConfig.length_unit})</label>
                                 <input type="number" step="10" value={c.start} onChange={e => updateCasing(i, 'start', e.target.value)} style={{ width: '100%', padding: '0.3rem', borderRadius: '4px', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '0.8rem' }} />
                             </div>
                             <div style={{ flex: 1 }}>
                                 <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block' }}>{lang === 'TR' ? 'Bitiş' : 'End'} ({bhaConfig.length_unit})</label>
                                 <input type="number" step="10" value={c.end} onChange={e => updateCasing(i, 'end', e.target.value)} style={{ width: '100%', padding: '0.3rem', borderRadius: '4px', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '0.8rem' }} />
                             </div>
                             <div style={{ flex: 1 }}>
                                 <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block' }}>{lang === 'TR' ? 'Boru' : 'Pipe'} ID (in)</label>
                                 <input type="number" step="0.1" value={c.id} onChange={e => updateCasing(i, 'id', e.target.value)} style={{ width: '100%', padding: '0.3rem', borderRadius: '4px', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '0.8rem' }} />
                             </div>
                             <button onClick={() => removeCasing(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', alignSelf: 'flex-end', marginBottom: '0.3rem' }} title={lang === 'TR' ? 'Sil' : 'Delete'}>✕</button>
                          </div>
                       ))}
                       {parsedCasings.length === 0 && <span style={{fontSize:'0.8rem', color:'var(--text-secondary)'}}>{lang === 'TR' ? 'Tanımlı muhafaza borusu yok.' : 'No casings defined.'}</span>}
                    </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                    <div style={{gridColumn: '1'}}>
                        <h4 style={{ color: 'var(--success)', marginBottom: '0.8rem' }}>Drill Pipe (DP)</h4>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{lang === 'TR' ? 'NOT: Drill Pipe uzunluğu, Anlık Kuyu Derinliği (Current Depth) tespiti yapılarak otomatik hesaplanmaktadır.' : 'NOTE: Drill Pipe length is calculated automatically based on continuous Current Depth tracking.'}</span>
                    </div>
                    {/* DP-1 */}
                    <div style={{ background: 'var(--bg-dark)', padding: '0.5rem', borderRadius: '6px' }}>
                        <h5 style={{ color: 'var(--text-primary)', marginBottom: '0.4rem', borderBottom: '1px solid #333', paddingBottom: '0.2rem' }}>DP Segment 1 (Auto-Length)</h5>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID (in)</label> <input type="number" step="0.001" value={bhaConfig.dp1_id} onChange={e => setBhaConfig({...bhaConfig, dp1_id: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>OD (in)</label> <input type="number" step="0.001" value={bhaConfig.dp1_od} onChange={e => setBhaConfig({...bhaConfig, dp1_od: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                        </div>
                    </div>
                </div>
             </div>

             <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{gridColumn: '1 / span 2'}}>
                        <h4 style={{ color: 'var(--success)', marginBottom: '0.8rem' }}>Drill Collar (DC)</h4>
                    </div>
                    {/* DC-1 */}
                    <div style={{ background: 'var(--bg-dark)', padding: '0.5rem', borderRadius: '6px' }}>
                        <h5 style={{ color: 'var(--text-primary)', marginBottom: '0.4rem', borderBottom: '1px solid #333', paddingBottom: '0.2rem' }}>DC Segment 1</h5>
                        <div><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{lang === 'TR' ? 'Uzunluk' : 'Length'} ({bhaConfig.length_unit})</label> <input type="number" value={bhaConfig.dc1_length} onChange={e => setBhaConfig({...bhaConfig, dc1_length: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', marginBottom: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID (in)</label> <input type="number" step="0.01" value={bhaConfig.dc1_id} onChange={e => setBhaConfig({...bhaConfig, dc1_id: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>OD (in)</label> <input type="number" step="0.01" value={bhaConfig.dc1_od} onChange={e => setBhaConfig({...bhaConfig, dc1_od: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                        </div>
                    </div>
                    {/* DC-2 */}
                    <div style={{ background: 'var(--bg-dark)', padding: '0.5rem', borderRadius: '6px' }}>
                        <h5 style={{ color: 'var(--text-primary)', marginBottom: '0.4rem', borderBottom: '1px solid #333', paddingBottom: '0.2rem' }}>DC Segment 2</h5>
                        <div><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{lang === 'TR' ? 'Uzunluk' : 'Length'} ({bhaConfig.length_unit})</label> <input type="number" value={bhaConfig.dc2_length} onChange={e => setBhaConfig({...bhaConfig, dc2_length: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', marginBottom: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID (in)</label> <input type="number" step="0.01" value={bhaConfig.dc2_id} onChange={e => setBhaConfig({...bhaConfig, dc2_id: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                           <div style={{ flex: 1 }}><label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>OD (in)</label> <input type="number" step="0.01" value={bhaConfig.dc2_od} onChange={e => setBhaConfig({...bhaConfig, dc2_od: Number(e.target.value)})} style={{ width:'100%', padding: '0.3rem', background: 'transparent', border: '1px solid var(--panel-border)', color: '#fff' }} /></div>
                        </div>
                    </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                    <h4 style={{ color: 'var(--warning)', marginBottom: '0.8rem' }}>{lang === 'TR' ? 'Matkap (Bit)' : 'Drill Bit'}</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{lang === 'TR' ? 'Çap' : 'Diameter'} (in)</label>
                            <input type="number" step="0.1" value={bhaConfig.bit_diameter} onChange={e => setBhaConfig({...bhaConfig, bit_diameter: Number(e.target.value)})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{lang === 'TR' ? 'Nozzle Sayısı' : 'Nozzle Quantity'}</label>
                                <input type="number" step="1" value={bhaConfig.bit_nozzle_qty} onChange={e => setBhaConfig({...bhaConfig, bit_nozzle_qty: Number(e.target.value)})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{lang === 'TR' ? 'Nozzle Boyutu' : 'Nozzle Size'} (/32)</label>
                                <input type="number" step="1" value={bhaConfig.bit_nozzle_size} onChange={e => setBhaConfig({...bhaConfig, bit_nozzle_size: Number(e.target.value)})} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-dark)', border: '1px solid var(--panel-border)', color: '#fff' }} />
                            </div>
                        </div>
                    </div>
                </div>
             </div>

             <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                 <button onClick={() => setShowBHAConfig(false)} style={{ padding: '0.6rem 2rem', background: 'transparent', border: '1px solid var(--text-secondary)', color: 'var(--text-secondary)', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{lang === 'TR' ? 'İptal' : 'Cancel'}</button>
                 <button onClick={() => {
                     fetch('http://localhost:8000/api/config', { 
                        method: 'POST', 
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(bhaConfig)
                     }).then(() => setShowBHAConfig(false));
                 }} style={{ padding: '0.6rem 2rem', background: 'var(--accent-color)', border: 'none', color: '#000', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>{lang === 'TR' ? 'Kaydet & Uygula' : 'Save & Apply'}</button>
             </div>
          </div>
        </div>
        );
      })()}

    </div>
  );
}

export default App;
