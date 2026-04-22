# Digital Twins in Drilling

Küçük bir **sondaj dijital ikiz demosu**: Python tabanlı bir simülatör zaman serisi sensör verilerini SQLite’a yazar, **FastAPI** servisi bu verileri HTTP üzerinden sunar ve **React (Vite)** tabanlı bir panel basınç, akış, reoloji ve yapılandırılabilir kuyu/BHA parametrelerini görselleştirir. Arayüz **Türkçe ve İngilizce** etiketleri ve farklı mühendislik birimlerini destekler.

İlk iskelet ve başlangıç implementasyonunun önemli bir kısmı **Google Antigravity** ile üretilmiştir; bu depoda sonradan eklenen düzeltmeler, dijital ikiz önizleme modülü, hidrolik model hizalaması ve dokümantasyon bulunur.

## Mimari

| Bileşen | Rol |
|--------|------|
| `mock_data_gen.py` | Korelasyonlu random walk + hedefe yakınsama; `sim_config` ile BHA/kuyu; **bit + iç boru + annülüs** basınç düşümü (`_visc_twin`, `_annulus_pressure_psi`); yaklaşık her 2 saniyede `sensor_data` satırı. |
| `server.py` | FastAPI: son satır, geçmiş (zaman penceresi + downsampling), `GET/POST /api/config` ile BHA/kuyu JSON’u SQLite `sim_config` tablosunda. **Port 8000.** |
| `dashboard/` | Vite + React + Recharts; `http://localhost:8000` API’ye poll eder. |
| `dashboard/src/hydraulics.js` | Önizleme hidroliği: `viscTwin`, `computeHydraulicsPsi` — **Python simülatörü ile aynı sabitler/formüller** (özellikle `K_YP_IN_PIPE_TERM`). |
| `dashboard/src/DigitalTwinPanel.jsx` | “Değiştir” menüsünden açılan **salt önizleme** modalları (yoğunluk, YP/PV, akış, nozzle); sunucuya yazmaz; tank taşması / kg-ton katı / pompa limiti uyarısı. |
| `dashboard/src/App.jsx` | Ana UI, birim dönüşümleri, tank alarm mantığı, BHA modalı, dijital ikiz state’i. |
| `extract_pdf.py` | Tek seferlik: projedeki PDF’ten düz metin çıkarıp `pdf_text.txt` üretir. |

## Önkoşullar

- Python 3.10+ (önerilir)
- Node.js 18+ (dashboard için)

## Kurulum ve çalıştırma

Üç süreç birlikte çalışır: veri üretimi → API → ön yüz.

### 1) Python bağımlılıkları

Depo kökünden:

```bash
python -m pip install -r requirements.txt
```

### 2) Veri üretimi (terminal 1)

```bash
python mock_data_gen.py
```

`sensor_data.db` güncellenir; kapatmak için Ctrl+C.

### 3) API sunucusu (terminal 2)

```bash
python server.py
```

API adresi: **http://localhost:8000** (CORS tüm kökenlere açık; geliştirme için).

### 4) Dashboard (terminal 3)

```bash
cd dashboard
npm install
npm run dev
```

Vite genelde **http://localhost:5173** üzerinde açar; tarayıcıda bu adresi kullanın. Uygulama API için **8000** portuna istek atar (`App.jsx` içindeki `fetch` URL’leri).

## Önemli özellikler (güncel)

- **Dijital ikiz önizleme:** Yoğunluk (ajan + hedef birim), reoloji, akış ve nozzle için hedef değer girişi; tahmini pompa / bit / iç boru / annülüs / standpipe basınçları; maksimum pompa basıncı aşım uyarısı.
- **Wellbore & BHA:** Muhafaza profili, drill pipe (otomatik uzunluk), drill collar, bit/nozzle; kaydetme `POST /api/config` ile simülatöre gider.
- **Tank kartı:** Boyutlar ve hacim birimi; kazı hacmi ile tank hızı korelasyonuna dayalı influx/loss alarm eşikleri.
- **Birimler:** ROP, akış, basınç, sıcaklık, yoğunluk, derinlik için ayar çubuğundan seçim.

## Proje yapısı (özet)

| Yol | Açıklama |
|-----|----------|
| `sensor_data.db` | SQLite (jeneratör + sunucu ile oluşur/güncellenir). |
| `mock_data_gen.py` | Simülatör döngüsü ve hidrolik. |
| `server.py` | REST API. |
| `dashboard/src/App.jsx` | Ana React uygulaması. |
| `dashboard/src/DigitalTwinPanel.jsx` | İkiz önizleme modalları. |
| `dashboard/src/hydraulics.js` | İstemci tarafı hidrolik hesapları. |
| `dashboard/mock_data_gen.py` | Boş/yedek; canlı simülasyon kökteki `mock_data_gen.py` ile yapılır. |

## Hidrolik hizalama

`dashboard/src/hydraulics.js` ile `mock_data_gen.py` içindeki **viscTwin / sürtünme / annülüs segmentasyonu** bilinçli olarak paralel tutulur. Bir tarafta formül değişince diğeri de gözden geçirilmelidir.

## Lisans

Bu proje **GNU General Public License v3.0 (GNU GPLv3)** ile lisanslanmıştır.
