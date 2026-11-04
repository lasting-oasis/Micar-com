"""Build a Spanish pronunciation lexicon for Kokoro from the narration, with espeak-ng.

Kokoro's Spanish voices were trained on espeak-ng phonemes (the kokoro package's EspeakG2P),
so each word is phonemized the same way: Latin American Spanish, stress marks kept, tied
diphthongs and affricates mapped to Kokoro's single-character tokens. The result is a
`word p h o n e m e s` file in the format sherpa-onnx reads.
"""
import json, re, sys
import espeakng_loader
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(espeakng_loader.get_library_path())
EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
from phonemizer import phonemize

TOKENS = set(l.split()[0] for l in open('/home/claude/tts/kokoro-multi-lang-v1_0/tokens.txt', encoding='utf8') if l.strip())
# Spanish has five plain vowels; espeak's lax glides (ʊ ɪ) and open ɛ ɔ made the voices stumble
# ("auto" came out as "oro"), and merged diphthongs (W, I...) did too. Plain vowels test best.
E2M = sorted({'d^ʒ': 'ʤ', 't^ʃ': 'ʧ', 'ʲ': '', 'ʊ': 'u', 'ɪ': 'i', 'ɛ': 'e', 'ɔ': 'o'}.items(), key=lambda kv: -len(kv[0]))

def g2p(word: str) -> str:
    ps = phonemize([word], language='es-419', backend='espeak', with_stress=True, preserve_punctuation=False, njobs=1, tie='^', strip=True)[0]
    ps = re.sub(r'\(\w{2}\)', '', ps)   # language-switch tags
    for old, new in E2M: ps = ps.replace(old, new)
    ps = ps.replace('^', '').replace(' ', '')
    return ps

words = set()
for path in sys.argv[1:]:
    n = json.load(open(path))
    for s in n['scenes']:
        for w in re.findall(r"[A-Za-zÁÉÍÓÚÑÜáéíóúñü]+", s['text']):
            words.add(w.lower())
bad = {}
lines = []
for w in sorted(words):
    ps = g2p(w)
    missing = [c for c in ps if c not in TOKENS]
    if missing: bad[w] = (ps, missing)
    lines.append(f"{w} {' '.join(ps)}")
open('/home/claude/tts/es-lexicon.txt', 'w', encoding='utf8').write('\n'.join(lines) + '\n')
print(len(lines), 'words;', 'unknown tokens:', bad if bad else 'none')
for w in ['número', 'cuánto', 'auto', 'código', 'qr', 'concesionarios', 'valuation', 'nexus', 'millaje', 'ventana']:
    print(w, '->', g2p(w))
