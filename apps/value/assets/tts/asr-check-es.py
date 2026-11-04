import json, re, difflib
import sherpa_onnx, soundfile as sf, numpy as np
from scipy.signal import resample_poly
d = '/home/claude/tts/sherpa-onnx-whisper-base'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f'{d}/base-encoder.int8.onnx', decoder=f'{d}/base-decoder.int8.onnx', tokens=f'{d}/base-tokens.txt', language='es', task='transcribe', num_threads=4)
n = json.load(open('/home/claude/explainer/narration-es.json'))
norm = lambda s: re.sub(r"[^a-záéíóúñü0-9' ]+", ' ', s.lower()).split()
tw = tb = 0
for s in n['scenes']:
    wav, sr = sf.read(f"/home/claude/explainer/public/audio/vo-es-{s['id']}.wav", dtype='float32')
    wav = resample_poly(wav, 16000, sr).astype(np.float32)
    st = rec.create_stream(); st.accept_waveform(16000, wav); rec.decode_stream(st)
    a, b = norm(s['text']), norm(st.result.text)
    sm = difflib.SequenceMatcher(a=a, b=b)
    diffs = [f"{' '.join(a[i1:i2])!r}->{' '.join(b[j1:j2])!r}" for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal']
    tw += len(a); tb += sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal')
    print(f"{s['id']:8s} match {sm.ratio()*100:5.1f}%", ('  diffs: ' + '; '.join(diffs)) if diffs else '  clean')
print(f'word error ~{tb/tw*100:.1f}% (includes Whisper-base mistakes)')
