"""Probe Gemini Live (WebSocket) with Google Search grounding on 3 known cars.
Lists models that support bidiGenerateContent, tries each Live model, and saves
answers, grounding sources and any error/close reason to data/gemini/live-probe.json."""
import asyncio, json, os, urllib.request
import websockets

KEY = os.environ['GEMINI_API_KEY']
B = 'https://generativelanguage.googleapis.com/v1beta'
WS = f'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={KEY}'
CARS = ['2012 Toyota Camry L', '2013 Lexus IS 350 sedan RWD', '2011 Honda Civic DX sedan manual']
ASK = ('Use Google Search. What was the official US base MSRP of the {car} when new, excluding destination? '
       'Answer on one line: MSRP: $<number> | SOURCE: <site>')

with urllib.request.urlopen(f'{B}/models?key={KEY}&pageSize=200', timeout=60) as r:
    models = json.load(r).get('models', [])
live = [m['name'] for m in models if 'bidiGenerateContent' in m.get('supportedGenerationMethods', [])]
out = {'live_models': live, 'tests': []}

async def ask(model, car, modality):
    rec = {'model': model, 'car': car, 'modality': modality, 'text': '', 'transcript': '', 'sources': [], 'error': None}
    setup = {'setup': {'model': model, 'generationConfig': {'responseModalities': [modality]}, 'tools': [{'googleSearch': {}}]}}
    if modality == 'AUDIO':
        setup['setup']['outputAudioTranscription'] = {}
    try:
        async with websockets.connect(WS, max_size=None, open_timeout=30) as ws:
            await ws.send(json.dumps(setup))
            json.loads(await asyncio.wait_for(ws.recv(), 30))  # setupComplete
            await ws.send(json.dumps({'clientContent': {'turns': [{'role': 'user', 'parts': [{'text': ASK.format(car=car)}]}], 'turnComplete': True}}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 90))
                sc = msg.get('serverContent', {})
                for p in sc.get('modelTurn', {}).get('parts', []):
                    rec['text'] += p.get('text', '')
                rec['transcript'] += sc.get('outputTranscription', {}).get('text', '')
                gm = sc.get('groundingMetadata') or msg.get('groundingMetadata') or {}
                rec['sources'] += [c.get('web', {}).get('title') for c in gm.get('groundingChunks', [])]
                if sc.get('turnComplete'):
                    break
    except websockets.exceptions.ConnectionClosed as e:
        rec['error'] = f'closed {e.code}: {e.reason}'[:300]
    except Exception as e:
        rec['error'] = f'{type(e).__name__}: {e}'[:300]
    return rec

async def main():
    for model in [m for m in live if 'live' in m][:4] or live[:3]:
        for modality in ('TEXT', 'AUDIO'):
            r = await ask(model, CARS[0], modality)
            out['tests'].append(r); print(r)
            if not r['error']:
                for car in CARS[1:]:
                    r2 = await ask(model, car, modality); out['tests'].append(r2); print(r2)
                    await asyncio.sleep(5)
                return
            await asyncio.sleep(5)

asyncio.run(main())
json.dump(out, open('data/gemini/live-probe.json', 'w'), indent=1)
