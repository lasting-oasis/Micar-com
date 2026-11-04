"""Spanish voiceover with Piper's es_MX 'claude' (high) voice through sherpa-onnx 2.0.
sherpa 2.0 ships no phonemizer, so each sentence is phonemized here with espeak-ng (the voice
the model was trained with, es-419) and handed over as codepoints, one sentence at a time."""
import json, re, subprocess, sys, time
import espeakng_loader
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(espeakng_loader.get_library_path()); EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
from phonemizer import phonemize
import sherpa_onnx, soundfile as sf, numpy as np

m = '/home/claude/tts/vits-piper-es_MX-claude-high'
ids = json.load(open(f'{m}/es_MX-claude-high.onnx.json'))['phoneme_id_map']
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f'{m}/es_MX-claude-high.onnx', tokens=f'{m}/tokens.txt', data_dir=f'{m}/espeak-ng-data', noise_scale=0.667, noise_scale_w=0.8, length_scale=1.0), num_threads=4, provider='cpu'), max_num_sentences=1)
tts = sherpa_onnx.OfflineTts(cfg)

def sentences(text):
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+', text) if x.strip()]

def say(text, speed=1.0, pause=0.28):
    out = []
    for sent in sentences(text):
        ps = phonemize([sent], language='es-419', backend='espeak', with_stress=True, preserve_punctuation=True, punctuation_marks=';:,.!?¡¿—…"«»“”', njobs=1, strip=True)[0]
        ps = re.sub(r'\(\w{2}\)', '', ps)
        cps = [[ord(c) for c in ps if c in ids]]
        g = sherpa_onnx.GenerationConfig(); g.phoneme_codepoints = cps; g.sid = 0; g.speed = speed
        a = tts.generate(sent, g)
        out.append(np.array(a.samples, dtype=np.float32)); out.append(np.zeros(int(a.sample_rate * pause), dtype=np.float32))
        sr = a.sample_rate
    return np.concatenate(out), sr

if __name__ == '__main__':
    n = json.load(open('/home/claude/explainer/narration-es.json'))
    durations = {}
    for s in n['scenes']:
        t = time.time()
        wav, sr = say(s['text'], speed=n.get('speed', 1.0))
        raw = f"/home/claude/tts/vo-es-{s['id']}-raw.wav"; sf.write(raw, wav, sr)
        final = f"/home/claude/explainer/public/audio/vo-es-{s['id']}.wav"
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000', '-ac', '1', final], check=True)
        durations[s['id']] = round(float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).decode()), 3)
        print(f"{s['id']:9s} {durations[s['id']]:5.2f}s ({time.time() - t:.1f}s to make)", flush=True)
    json.dump(durations, open('/home/claude/explainer/public/audio/durations-es.json', 'w'), indent=1)
    print('total', round(sum(durations.values()), 1), 's')
