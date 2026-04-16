# Digital Twins in Drilling ()

Küçük bir **sondaj dijital ikiz demosu**: Python tabanlı bir simülatör zaman serisi sensör verilerini SQLite'a yazar, **FastAPI** servisi bu verileri HTTP üzerinden sunar ve **React (Vite)** tabanlı bir panel basınç, akış, reoloji ve yapılandırılabilir kuyu/BHA parametrelerini görselleştirir. Arayüz **Türkçe ve İngilizce** etiketleri ve farklı mühendislik birimlerini destekler.

İlk iskelet ve başlangıç implementasyonunun önemli bir kısmı **Google Antigravity** ile üretilmiştir; bu depoda sonradan eklenen düzeltmeler ve dokümantasyonlar bulunabilir.

## Mimari

| Bileşen | Rol |
|--------|------|
| `mock_data_gen.py` | Korelasyonlu random walk + basitleştirilmiş hidrolik hesaplar; yaklaşık her 2 saniyede bir `sensor_data.db` içine yeni satır ekler. |
| `server.py` | REST API: son satır, geçmiş veri serisi (uzun aralıklarda kaba downsampling), simülatör ayarlarını okuma/yazma. |
| `dashboard/` | Vite + React + Recharts; API'yi periyodik olarak çağırır ve kartlar, pompa göstergesi, tank seviyesi ile modalları render eder. |

## Önkoşullar

- Python 3.10+ (önerilir)
- Node.js 18+ (dashboard için)

## Kurulum

### 1. Python bağımlılıkları

Depo kök dizininden:

```bash
python -m pip install -r requirements.txt
```

### 2. Veri üretimini başlatın (terminal 1)

```bash
python mock_data_gen.py
```

Veritabanının sürekli güncellenmesi için bu süreci açık bırakın.

### 3. API sunucusunu başlatın (terminal 2)

```bash
python server.py
```

API, **http://localhost:8000** adresinde çalışır (`server.py` içindeki `uvicorn.run` satırına bakabilirsiniz).

### 4. Dashboard'u başlatın (terminal 3)

```bash
cd dashboard
npm install
npm run dev
```

Vite'ın terminale yazdığı URL'yi açın (genellikle **http://localhost:5173**). Frontend, `http://localhost:8000` adresini çağıracak şekilde yapılandırılmıştır.

## Opsiyonel: PDF metin çıkarımı

`extract_pdf.py`, `pypdf` kullanarak makale PDF'inden metni `pdf_text.txt` dosyasına çıkarır (gerekirse script içindeki PDF dosya adını değiştirin).

## Proje yapısı

- `sensor_data.db` — SQLite veritabanı dosyası (jeneratör veya sunucu çalışınca oluşur).
- `dashboard/src/App.jsx` — Ana arayüz, birim dönüşümleri ve API polling akışı.

## Lisans

Bu proje **GNU General Public License v3.0 (GNU GPLv3)** ile lisanslanmıştır.
