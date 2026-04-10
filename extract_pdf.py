import sys
import subprocess
try:
    import pypdf
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pypdf'])
    import pypdf

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
