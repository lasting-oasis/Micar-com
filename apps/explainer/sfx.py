"""Sound cues and a music bed for the explainer, synthesized from scratch at 48 kHz.

Every cue is shaped (attack/decay envelopes, filtering, a short reverb tail) so it reads as a
designed UI sound rather than a raw tone. Levels are set so the voiceover stays in front.
"""
import numpy as np
from scipy import signal
import soundfile as sf

SR = 48000
OUT = '/home/claude/explainer/public/audio/'
rng = np.random.default_rng(7)


def t(seconds):
    return np.arange(int(SR * seconds)) / SR


def env(n, attack=0.005, decay=0.2, curve=4.0):
    """Fast attack, exponential decay."""
    x = np.arange(n) / SR
    a = np.clip(x / max(attack, 1e-4), 0, 1)
    d = np.exp(-curve * x / max(decay, 1e-3))
    return a * d


def lowpass(x, hz, order=4):
    b, a = signal.butter(order, hz / (SR / 2), 'low')
    return signal.lfilter(b, a, x)


def highpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2), 'high')
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


def reverb(x, seconds=0.35, mix=0.18):
    """A small, soft room: exponentially decaying noise as the impulse."""
    ir = rng.standard_normal(int(SR * seconds)) * np.exp(-6 * np.arange(int(SR * seconds)) / (SR * seconds))
    ir = lowpass(ir, 6000)
    ir /= np.abs(ir).sum() / 8
    wet = signal.fftconvolve(x, ir)
    dry = np.pad(x, (0, len(wet) - len(x)))
    return dry * (1 - mix) + wet * mix


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def fade_out(x, seconds=0.02):
    n = min(len(x), int(SR * seconds))
    x[-n:] *= np.linspace(1, 0, n)
    return x


def write(name, x, gain_db):
    y = norm(x) * 10 ** (gain_db / 20)
    y = fade_out(y.astype(np.float64))
    sf.write(OUT + name, y.astype(np.float32), SR)
    print(f'{name:16s} {len(y) / SR:5.2f}s  peak {gain_db:+.0f} dB')


# ---- Cues ------------------------------------------------------------------------------------

# Paint stroke: a breathy noise sweep that opens up, for the headline painting on.
def paint():
    n = int(SR * 0.9)
    noise = rng.standard_normal(n)
    sweep = np.array([bandpass(noise, 300, 900)[: n], bandpass(noise, 900, 3500)[: n]])
    mixv = np.linspace(0, 1, n) ** 1.5
    x = sweep[0] * (1 - mixv) + sweep[1] * mixv
    x *= np.sin(np.linspace(0, np.pi, n)) ** 0.7
    return reverb(x, 0.4, 0.25)


# Whoosh: a fast air movement for scene changes.
def whoosh():
    n = int(SR * 0.55)
    noise = rng.standard_normal(n)
    x = bandpass(noise, 200, 2500)
    shape = np.exp(-((np.arange(n) / n - 0.35) ** 2) / 0.03)
    x = x * shape
    # a little pitch rise: modulate with a slow sine
    x *= 1 + 0.3 * np.sin(np.linspace(0, np.pi, n))
    return reverb(x, 0.3, 0.2)


# Tick: a short, dry click with a bit of body, for list lines appearing.
def tick():
    n = int(SR * 0.09)
    x = rng.standard_normal(n) * env(n, 0.001, 0.012, 5)
    x = bandpass(x, 1800, 6000)
    body = np.sin(2 * np.pi * 1100 * t(0.09)) * env(n, 0.001, 0.02, 5) * 0.5
    return reverb(x + body, 0.15, 0.1)


# Pop: a soft downward chirp, for check marks and stars.
def pop(f0=720, f1=330, dur=0.12):
    n = int(SR * dur)
    freq = f0 * (f1 / f0) ** (np.arange(n) / n)
    ph = np.cumsum(2 * np.pi * freq / SR)
    x = np.sin(ph) * env(n, 0.002, 0.05, 4)
    return reverb(x, 0.2, 0.15)


# Rise: a short riser under a number counting up.
def rise(dur=0.9):
    n = int(SR * dur)
    freq = 180 * (2.4 ** (np.arange(n) / n))
    ph = np.cumsum(2 * np.pi * freq / SR)
    tone = 0.6 * np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    noise = bandpass(rng.standard_normal(n), 800, 5000) * 0.35
    x = (tone + noise) * (np.linspace(0, 1, n) ** 2) * np.hanning(n * 2)[n:] ** 0.3
    x = lowpass(x, 5000)
    return reverb(x, 0.3, 0.2)


# Chime: two partials with a long, clean decay, for the value landing.
def chime(f=880):
    n = int(SR * 1.6)
    tt = t(1.6)
    x = (np.sin(2 * np.pi * f * tt) * np.exp(-3.2 * tt)
         + 0.45 * np.sin(2 * np.pi * f * 2.0 * tt) * np.exp(-5 * tt)
         + 0.25 * np.sin(2 * np.pi * f * 2.99 * tt) * np.exp(-7 * tt)
         + 0.15 * np.sin(2 * np.pi * f * 0.5 * tt) * np.exp(-2.5 * tt))
    x *= env(n, 0.003, 10, 1)
    return reverb(x, 0.6, 0.3)


# Scan: two quick tones, the sound of a QR reader catching the code.
def scan():
    a = np.sin(2 * np.pi * 1245 * t(0.07)) * env(int(SR * 0.07), 0.002, 0.05, 3)
    b = np.sin(2 * np.pi * 1760 * t(0.16)) * env(int(SR * 0.16), 0.002, 0.08, 3)
    gap = np.zeros(int(SR * 0.03))
    return reverb(np.concatenate([a, gap, b]), 0.25, 0.18)


# Flip: a page turn, for the language switch.
def flip():
    n = int(SR * 0.3)
    noise = rng.standard_normal(n)
    x = highpass(bandpass(noise, 1000, 7000), 800)
    shape = np.concatenate([np.linspace(0, 1, n // 5) ** 2, np.exp(-5 * np.arange(n - n // 5) / (n - n // 5))])
    return reverb(x * shape, 0.2, 0.15)


# Print: a short mechanical whir with a click at the end, for the sheet printing.
def printer():
    n = int(SR * 0.7)
    noise = bandpass(rng.standard_normal(n), 400, 2200)
    buzz = np.sign(np.sin(2 * np.pi * 60 * t(0.7))) * 0.3
    x = (noise * 0.7 + buzz) * np.hanning(n) ** 0.5
    click = tick()[: int(SR * 0.09)]
    x = np.concatenate([x, click * 1.2])
    return reverb(x, 0.25, 0.15)


# ---- Music bed -------------------------------------------------------------------------------

def pad_note(freq, dur, detune=0.004):
    """A soft pad: three slightly detuned saws, low-passed, slow attack and release."""
    n = int(SR * dur)
    tt = t(dur)
    x = np.zeros(n)
    for d in (-detune, 0, detune):
        f = freq * (1 + d)
        x += signal.sawtooth(2 * np.pi * f * tt + rng.uniform(0, 6.28)) / 3
    x = lowpass(x, 900)
    att = np.clip(tt / 1.2, 0, 1) ** 1.5
    rel = np.clip((dur - tt) / 1.5, 0, 1) ** 1.5
    return x * att * rel


def bed(total=140.0):
    """Four warm chords, eight seconds each, looping under the whole film."""
    bar = 8.0
    chords = [[146.83, 220.0, 277.18, 329.63],   # D major 7
              [123.47, 185.0, 220.0, 277.18],   # B minor 7
              [98.0, 146.83, 185.0, 246.94],    # G major 7
              [110.0, 164.81, 220.0, 277.18]]   # A sus / add
    x = np.zeros(int(SR * (total + bar)))
    i, pos = 0, 0.0
    while pos < total:
        chord = chords[i % len(chords)]
        note = sum(pad_note(f, bar + 1.5) for f in chord) + 0.5 * pad_note(chord[0] / 2, bar + 1.5)
        start = int(SR * pos)
        x[start: start + len(note)] += note[: len(x) - start]
        pos += bar
        i += 1
    x = x[: int(SR * total)]
    # slow, gentle movement on the filter so it breathes
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * (1 / 16) * t(total))
    x = lowpass(x, 700) * (0.75 + 0.25 * lfo) + lowpass(x, 1800) * 0.25 * lfo
    x = reverb(x, 1.2, 0.35)[: int(SR * total)]
    x[: SR * 3] *= np.linspace(0, 1, SR * 3)
    x[-SR * 4:] *= np.linspace(1, 0, SR * 4)
    return x


write('paint.wav', paint(), -14)
write('whoosh.wav', whoosh(), -16)
write('tick.wav', tick(), -18)
write('pop.wav', pop(), -17)
write('rise.wav', rise(), -17)
write('chime.wav', chime(), -15)
write('scan.wav', scan(), -16)
write('flip.wav', flip(), -16)
write('print.wav', printer(), -17)
write('bed.wav', bed(140.0), -27)
