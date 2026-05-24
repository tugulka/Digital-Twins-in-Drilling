# Digital Twins in Drilling

Küçük bir **sondaj dijital ikiz demosu**: Python tabanlı bir simülatör zaman serisi sensör verilerini SQLite’a yazar, **FastAPI** servisi bu verileri HTTP üzerinden sunar ve **React (Vite)** tabanlı bir panel basınç, akış, reoloji ve yapılandırılabilir kuyu/BHA parametrelerini görselleştirir. Arayüz **Türkçe ve İngilizce** etiketleri ve farklı mühendislik birimlerini destekler.

Bu proje, ilk olarak **Google Antigravity** platformunda **Gemini 3.1 Pro** modeliyle vibe coding ile tasarlanmış ve hayata geçirilmiştir. Sonraki aşamalarda, **Cursor** üzerinde **Cursor Composer 2.5** ve **Google Antigravity 2.0** üzerinde **Gemini 3.5 Flash** kullanılarak genişletilmiş ve son haline getirilmiştir. Bu süreçlerde sisteme kuyu telemetri replay (oynatım) doğrulama modu, dinamik veri kaydırma (shifting) algoritmaları, dijital ikiz önizleme paneli, gerçek zamanlı kuyu hidroliği kalibrasyonları ve derinlemesine akademik dokümantasyonlar kazandırılmıştır.

*English Note:* This project was initially created by voice coding on Google Antigravity using Gemini 3.1 Pro first. It was later developed by Cursor Composer 2.5 on Cursor and Gemini 3.5 Flash on Google Antigravity 2.0.

## Mimari

| Bileşen | Rol |
|--------|------|
| `mock_data_gen.py` | Korelasyonlu random walk + hedefe yakınsama; `sim_config` ile BHA/kuyu; **Herschel-Bulkley (API RP 13D)** hidrolik motoru (Boru + Açık Kuyu/Casing Anülüs ayrımlı basınç düşümü); yaklaşık her 2 saniyede bir sensör loglaması, ancak reoloji/çamur özelliklerinde **15 dakikalık sahadaki laboratuvar gerçekliğine uygun gecikmeli güncellemeler**. |
| `replay_mode.py` | Telemetri playback ve doğrulama sistemi. `real_rig_data.csv` dosyasından gerçek kuyu verilerini okur, Herschel-Bulkley modelini kuyu konfigürasyonuna göre çalıştırır, bağıl hatayı hesaplar ve dashboard'da karşılaştırılabilmesi için SQLite'a yazar. |
| `server.py` | FastAPI: son satır, geçmiş (zaman penceresi + downsampling), `GET/POST /api/config` ile BHA/kuyu JSON’u SQLite `sim_config` tablosunda. **Port 8000.** |
| `dashboard/` | Vite + React + Recharts; `http://localhost:8000` API’ye poll eder. |
| `dashboard/src/hydraulics.js` | Önizleme hidroliği: **Herschel-Bulkley (API RP 13D)** formülleri, kuyu sistemi toplam hacim hesaplamaları. Python motoruyla %100 matematiksel paralellik gösterir. |
| `dashboard/src/DigitalTwinPanel.jsx` | “Değiştir” menüsünden açılan dijital ikiz kontrol modalları (yoğunluk, YP/PV, akış, nozzle); tank taşması / kg-ton katı / pompa limiti uyarısı ve parametrik optimizasyon hesapları içerir. |
| `dashboard/src/App.jsx` | Ana UI, birim dönüşümleri, tank alarm mantığı, BHA modalı, dijital ikiz state’i ve real-time grafikler. |
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

### 2) Canlı Simülasyon veya Replay Doğrulama Modu (terminal 1)

* **Canlı Simülasyon Modu (Mock Data):**
  ```bash
  python mock_data_gen.py
  ```
  `sensor_data.db` yapay sensör verileri ile sürekli güncellenir.

* **Replay & Doğrulama Modu (Gerçek Kuyu Verisi):**
  ```bash
  python replay_mode.py
  ```
  `real_rig_data.csv` dosyasındaki gerçek rig telemetrisini 2.0s aralıklarla veritabanına yazar ve fizik motorunun gerçek veriye göre hata oranını hesaplar.
  
*(Not: Tüm sistem bileşenlerini tek tıkla Replay Modunda çalıştırmak için `test_run.bat` dosyasını, Canlı Simülasyon modunda çalıştırmak için `sistemi_baslat.bat` dosyasını çalıştırabilirsiniz).*

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
- **Akıllı Influx / Kick & Kaçak (Mud Loss) Alarmı (Kesinti Takip Sistemi):** Kuyu dibindeki kesinti hacmi ile çamur tankı (mud pit) seviyesindeki değişimleri dinamik olarak karşılaştıran gelişmiş koruyucu alarm sistemi:
  * *Kesinti (Cuttings) Hacim Hesabı:* Matkap çapı ($d_{\text{bit}}$) ve anlık ilerleme hızına (ROP) dayanarak kuyu dibinde oluşan teorik kesinti (kırıntı) hacmini saniyelik olarak hesaplar ($Q_{\text{kesinti}} = \text{ROP} \times \frac{\pi \cdot d_{\text{bit}}^2}{4}$).
  * *Akıllı Algılama:* Matkabın kestiği kesinti hacmi normal şartlarda çamur tankı seviyesinde öngörülebilir bir değişim/düşüş yaratmalıdır.
  * *🚨 Influx (Kick/Kuyu İçi Akış) Alarmı:* Eğer tank seviyesi bu teorik düşüş eğrisinin üzerinde kalır veya yükselirse, yüksek basınçlı formasyon akışkanlarının (gaz/su/petrol) kuyuya sızdığını anında tespit edip kırmızı **🚨 KICK / INFLUX** alarmını tetikler.
  * *🚨 Kaçak (Mud Loss) Alarmı:* Tank seviyesi beklenen kesinti hacmi düşüş eğrisinden çok daha hızlı aşağı iniyorsa, çamurun kuyu içindeki çatlaklara kaçtığını tespit ederek **🚨 MUD LOSS** alarmını tetikler.
- **Birimler:** ROP, akış, basınç, sıcaklık, yoğunluk, derinlik için ayar çubuğundan seçim.

## Proje yapısı (özet)

| Yol | Açıklama |
|-----|----------|
| `sensor_data.db` | SQLite veritabanı (jeneratör, replay ve sunucu tarafından okunur/güncellenir). |
| `mock_data_gen.py` | Canlı simülasyon döngüsü, viskozimetre sapması ve Herschel-Bulkley fizik motoru. |
| `replay_mode.py` | Gerçek kuyu telemetri replay (oynatım) ve bağıl hata doğrulama betiği. |
| `real_rig_data.csv` | Derinliği 250m'ye kaydırılmış ve kalibre edilmiş gerçek rig telemetri veri seti ($<0.3\%$ hata payı). |
| `server.py` | REST API sunucusu (FastAPI). |
| `dashboard/src/App.jsx` | Ana React dashboard uygulaması. |
| `dashboard/src/DigitalTwinPanel.jsx` | Dijital ikiz parametre optimizasyonu kontrol modalları. |
| `dashboard/src/hydraulics.js` | İstemci tarafı API RP 13D Herschel-Bulkley hidrolik motoru. |
| `test_run.bat` | Replay Doğrulama Modunu tüm bileşenleriyle otomatik başlatan bat dosyası. |
| `sistemi_baslat.bat` | Canlı Simülasyon Modunu tüm bileşenleriyle otomatik başlatan bat dosyası. |

## Hidrolik hizalama

`dashboard/src/hydraulics.js` ile `mock_data_gen.py` içindeki **Herschel-Bulkley, Dodge-Metzner, Reynolds türbülans geçişleri ve sistem hacmi algoritmaları** bilinçli olarak paralel tutulur. Python motoru zaman içinde gelişirken, JS motoru anlık kullanıcı ("what-if") senaryoları için hizmet verir. Bir tarafta formül (özellikle `calculate_re_c` ve akış davranışı limitleri) değişince diğeri de eşzamanlı gözden geçirilmelidir.

## Lisans

Bu proje **GNU General Public License v3.0 (GNU GPLv3)** ile lisanslanmıştır.
