# Round trip: transcribe each voiceover clip with Whisper and diff against the script,
# to catch dropped or garbled words that I can't hear from here.
import json, re, difflib
import sherpa_onnx, soundfile as sf, numpy as np
d = '/home/claude/tts/sherpa-onnx-whisper-base.en'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f'{d}/base.en-encoder.int8.onnx', decoder=f'{d}/base.en-decoder.int8.onnx', tokens=f'{d}/base.en-tokens.txt', num_threads=4)
n = json.load(open('/home/claude/explainer/narration.json'))
norm = lambda s: re.sub(r"[^a-z0-9' ]+", ' ', s.lower().replace('-', ' ')).split()
total_w = total_bad = 0
for s in n['scenes']:
    wav, sr = sf.read(f"/home/claude/explainer/public/audio/vo-{s['id']}.wav", dtype='float32')
    if sr != 16000:
        from scipy.signal import resample_poly
        wav = resample_poly(wav, 16000, sr).astype(np.float32); sr = 16000
    st = rec.create_stream(); st.accept_waveform(sr, wav); rec.decode_stream(st)
    heard = st.result.text
    a, b = norm(s['text']), norm(heard)
    sm = difflib.SequenceMatcher(a=a, b=b)
    diffs = [(tag, ' '.join(a[i1:i2]), ' '.join(b[j1:j2])) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal']
    total_w += len(a); total_bad += sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal')
    print(f"{s['id']:8s} match {sm.ratio()*100:5.1f}%", ('  diffs: ' + '; '.join(f'{x[1]!r}->{x[2]!r}' for x in diffs)) if diffs else '  clean')
print(f'word error ~{total_bad/total_w*100:.1f}% (includes Whisper\'s own mistakes and number formatting)')
