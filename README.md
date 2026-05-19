# Digital Twins in Drilling

Küçük bir **sondaj dijital ikiz demosu**: Python tabanlı bir simülatör zaman serisi sensör verilerini SQLite’a yazar, **FastAPI** servisi bu verileri HTTP üzerinden sunar ve **React (Vite)** tabanlı bir panel basınç, akış, reoloji ve yapılandırılabilir kuyu/BHA parametrelerini görselleştirir. Arayüz **Türkçe ve İngilizce** etiketleri ve farklı mühendislik birimlerini destekler.

İlk iskelet ve başlangıç implementasyonunun önemli bir kısmı **Google Antigravity** ile üretilmiştir; bu depoda sonradan eklenen düzeltmeler, dijital ikiz önizleme modülü, hidrolik model hizalaması ve dokümantasyon bulunur.

## Mimari

| Bileşen | Rol |
|--------|------|
| `mock_data_gen.py` | Korelasyonlu random walk + hedefe yakınsama; `sim_config` ile BHA/kuyu; **Herschel-Bulkley (API RP 13D)** hidrolik motoru (Boru + Açık Kuyu/Casing Anülüs ayrımlı basınç düşümü); yaklaşık her 2 saniyede bir sensör loglaması, ancak reoloji/çamur özelliklerinde **15 dakikalık sahadaki laboratuvar gerçekliğine uygun gecikmeli güncellemeler**. |
| `server.py` | FastAPI: son satır, geçmiş (zaman penceresi + downsampling), `GET/POST /api/config` ile BHA/kuyu JSON’u SQLite `sim_config` tablosunda. **Port 8000.** |
| `dashboard/` | Vite + React + Recharts; `http://localhost:8000` API’ye poll eder. |
| `dashboard/src/hydraulics.js` | Önizleme hidroliği: **Herschel-Bulkley (API RP 13D)** formülleri, kuyu sistemi toplam hacim hesaplamaları. Python motoruyla %100 matematiksel paralellik gösterir. |
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

- **Dijital ikiz önizleme ("Değiştir" Sekmeleri):** Yoğunluk, Reoloji, Akış ve Nozzle ayarlarını değiştirebilirsiniz. Değişiklikler sunucuya yazılmaz, tarayıcıda izole bir API RP 13D simülasyonu çalıştırılır.
  - *Kimyasal Tahmini:* Yoğunluk artırımında (Kalsit/Barit) **tüm kuyu hacmini** (tanklar + yeraltı annülüs/boru boşlukları) göz önünde bulunduran toplam tonaj hesaplaması.
  - *Fann 35 Reoloji:* K ve n girmek yerine doğrudan vizkozimetrenin okuduğu $\theta_{600}$, $\theta_{300}$, $\dots$, $\theta_{3}$ değerleri girilir. Sistem K ve n'yi hesaplayıp tüm basınç kırılımlarını anında çizer.
  - *Detaylı Basınç Kırılımı:* Yüzey (Surface Line), İç Boru (DP, BHA), Matkap (Bit), Anülüs (Casing içi) ve Anülüs (Açık Kuyu) ayrıntılı hidrolik kırılımları formun hemen altında sunulur.
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

`dashboard/src/hydraulics.js` ile `mock_data_gen.py` içindeki **Herschel-Bulkley, Dodge-Metzner, Reynolds türbülans geçişleri ve sistem hacmi algoritmaları** bilinçli olarak paralel tutulur. Python motoru zaman içinde gelişirken, JS motoru anlık kullanıcı ("what-if") senaryoları için hizmet verir. Bir tarafta formül (özellikle `calculate_re_c` ve akış davranışı limitleri) değişince diğeri de eşzamanlı gözden geçirilmelidir.

## Lisans

Bu proje **GNU General Public License v3.0 (GNU GPLv3)** ile lisanslanmıştır.
