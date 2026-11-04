import { AbsoluteFill, Audio, Composition, Sequence, continueRender, delayRender, staticFile } from 'remotion';
import { useEffect, useState } from 'react';
import data from './data.json';
import { fontsReady } from './kit';
import { Doors, Intro, LangContext, Ledger, Market, Phone, Pick, Prices, Sheet, Sources, Spanish } from './scenes';
import { FPS, scenesFor, totalFor, type Lang } from './timing';

const parts = { intro: Intro, doors: Doors, pick: Pick, ledger: Ledger, prices: Prices, market: Market, sheet: Sheet, phone: () => <Phone link={data.carLink} />, spanish: Spanish, sources: Sources };

export function Film({ lang }: { lang: Lang }) {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => { fontsReady.then(() => continueRender(handle)); }, [handle]);
  return (
    <LangContext.Provider value={lang}>
    <AbsoluteFill style={{ background: '#15191e' }}>
      <Audio src={staticFile('audio/bed.wav')} volume={1} />
      {scenesFor(lang).map((sc) => {
        const Part = parts[sc.id];
        return (
          <Sequence key={sc.id} from={sc.from} durationInFrames={sc.frames} name={sc.id}>
            <Part />
          </Sequence>
        );
      })}
    </AbsoluteFill>
    </LangContext.Provider>
  );
}

export const Root = () => (
  <>
    <Composition id="explainer" component={Film} defaultProps={{ lang: 'en' as Lang }} calculateMetadata={({ props }) => ({ durationInFrames: totalFor(props.lang) })} durationInFrames={totalFor('en')} fps={FPS} width={1920} height={1080} />
    <Composition id="explainer-es" component={Film} defaultProps={{ lang: 'es' as Lang }} calculateMetadata={({ props }) => ({ durationInFrames: totalFor(props.lang) })} durationInFrames={totalFor('es')} fps={FPS} width={1920} height={1080} />
  </>
);
