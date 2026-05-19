"""
One-off utility: extract plain text from the bundled project PDF into `pdf_text.txt`.

Usage (from repo root, with the PDF filename unchanged):
    python extract_pdf.py

Dependencies:
    Uses `pypdf`; if missing, installs it into the active interpreter via pip (dev convenience only).
Output:
    Overwrites or creates `pdf_text.txt` with page markers for downstream search / LLM context.
"""
import sys
import subprocess
try:
    import pypdf
except ImportError:
    # Bootstrap: ensure the reader library exists without requiring a manual pip step first.
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pypdf'])
    import pypdf

# Source document is fixed to the project deliverable name (adjust path if file is renamed).
reader = pypdf.PdfReader('Dijital İkizler Yöntemi ile Sürekli Reoloji ve Basınç Takibi - Tolga AKGÖL.pdf')
text = ''
for i, page in enumerate(reader.pages):
    text += f'--- Page {i+1} ---\n'
    try:
        text += page.extract_text() + '\n'
    except Exception as e:
        text += f'Error extracting page: {e}\n'

with open('pdf_text.txt', 'w', encoding='utf-8') as f:
    f.write(text)
print('Extraction complete.')
