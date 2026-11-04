# Synthesize each narration scene to a 48 kHz mono WAV, loudness-normalized, with the Kokoro model.
import json, subprocess, sys, time
LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
import sherpa_onnx, soundfile as sf
d = '/home/claude/tts/kokoro-multi-lang-v1_0'
n = json.load(open('/home/claude/explainer/narration.json' if LANG == 'en' else f'/home/claude/explainer/narration-{LANG}.json'))
lexicons = f'/home/claude/tts/custom-lexicon.txt,{d}/lexicon-us-en.txt' if LANG == 'en' else f'/home/claude/tts/es-lexicon.txt,/home/claude/tts/custom-lexicon.txt,{d}/lexicon-us-en.txt'
suffix = '' if LANG == 'en' else f'-{LANG}'
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=f'{d}/model.onnx', voices=f'{d}/voices.bin', tokens=f'{d}/tokens.txt', data_dir=f'{d}/espeak-ng-data', dict_dir=f'{d}/dict', lexicon=lexicons, lang='es' if LANG == 'es' else ''),
    num_threads=4, provider='cpu'), max_num_sentences=1)
tts = sherpa_onnx.OfflineTts(cfg)
out = {}
for s in n['scenes']:
    t = time.time()
    a = tts.generate(s['text'], sid=n['voice'], speed=n['speed'])
    raw = f"/home/claude/tts/vo{suffix}-{s['id']}-raw.wav"
    sf.write(raw, a.samples, a.sample_rate)
    # trim silence at both ends, normalize to a consistent loudness, resample to 48 kHz
    final = f"/home/claude/explainer/public/audio/vo{suffix}-{s['id']}.wav"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000', '-ac', '1', final], check=True)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).decode())
    out[s['id']] = round(dur, 3)
    print(f"{s['id']:9s} {dur:5.2f}s  ({time.time()-t:.1f}s to make)", flush=True)
json.dump(out, open(f'/home/claude/explainer/public/audio/durations{suffix}.json', 'w'), indent=1)
print('total', round(sum(out.values()), 1), 's')
