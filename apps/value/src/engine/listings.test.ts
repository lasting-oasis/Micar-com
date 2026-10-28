import { describe, expect, it } from 'vitest';
import { describe as summarize, median, parseListingsPage } from './listings';

const marketplace = `
Marketplace
Vehicles · Charlotte, North Carolina · Within 40 miles
$18,500
2021 Buick Enclave Essence
Charlotte, NC
62K miles
$17,900
2021 Buick Enclave Preferred
Concord, NC
71K miles
$21,995
2022 Buick Enclave Avenir
Gastonia, NC
38K miles
$9,800
2016 Buick Enclave Leather
Rock Hill, SC
128K miles
$19,200
2021 Chevrolet Traverse LT
Charlotte, NC
55K miles
$350/mo
Sponsored · Lease a 2026 Enclave
`;

const offerup = `
OfferUp
2021 Buick Enclave Essence AWD
$18,999
Charlotte, NC · 60,210 miles
2020 Buick Enclave Essence
$16,450
Huntersville, NC · 84,000 miles
2021 Buick Enclave Essence AWD
$18,999
Charlotte, NC · 60,210 miles
`;

const cargurus = `
CarGurus
Used 2021 Buick Enclave Essence FWD
Price Drop
$19,998
Was $20,998
Great Deal · $1,203 under
62,345 mi
Charlotte, NC (4 mi away)
Est. $342/mo
Used 2021 Buick Enclave Avenir AWD
$24,490
Fair Deal
41,002 mi
Matthews, NC
Est. $419/mo
Used 2019 Buick Enclave Premium
$15,750
88,120 mi
`;

describe('parseListingsPage', () => {
  it('reads Facebook Marketplace text: price above the title, K miles', () => {
    const r = parseListingsPage(marketplace, { model: 'Enclave', year: 2021 });
    expect(r.source).toBe('Facebook Marketplace');
    expect(r.listings.map((l) => l.price)).toEqual([17900, 18500, 21995]);
    expect(r.listings.find((l) => l.price === 18500)).toMatchObject({ year: 2021, miles: 62000 });
    expect(r.skipped.otherModels).toBe(1); // the Traverse
    expect(r.skipped.otherYears).toBe(1); // the 2016
    expect(r.listings.map((l) => l.price)).not.toContain(350); // $350/mo never qualifies
  });

  it('reads OfferUp text: title above the price, dedupes repeats', () => {
    const r = parseListingsPage(offerup, { model: 'Enclave', year: 2021 });
    expect(r.source).toBe('OfferUp');
    expect(r.listings.map((l) => l.price)).toEqual([16450, 18999]);
    expect(r.listings[1].miles).toBe(60210);
    expect(r.skipped.duplicates).toBe(1);
  });

  it('reads CarGurus text: ignores "Was", "under" and "Est. /mo" figures', () => {
    const r = parseListingsPage(cargurus, { model: 'Enclave', year: 2021 });
    expect(r.listings.map((l) => l.price)).toEqual([15750, 19998, 24490]);
    expect(r.skipped.payments).toBe(2); // 'Was $20,998' and '$1,203 under'; sub-$1,000 payments never qualify
    expect(r.listings.find((l) => l.price === 19998)?.miles).toBe(62345);
  });

  it('does not filter by model when the page never names it', () => {
    const r = parseListingsPage('$12,000 2019 sedan 70,000 miles\n$13,500 2020 sedan 50,000 miles', { model: 'Civic', year: 2020 });
    expect(r.listings).toHaveLength(2);
  });

  it('handles $18.5k style prices and alternative model names', () => {
    const r = parseListingsPage('2022 Kia K4 GT-Line $18.5k 30k mi\n2022 Kia Forte LXS $17,200 41,000 miles', { model: 'Forte / K4', year: 2022 });
    expect(r.listings.map((l) => l.price)).toEqual([17200, 18500]);
    expect(r.listings[1].miles).toBe(30000);
  });

  it('skips tiny and huge numbers and empty input', () => {
    expect(parseListingsPage('$25 $900,000 $1,000,000', {}).listings).toHaveLength(0);
    expect(parseListingsPage('', {}).listings).toHaveLength(0);
  });

  it('reads a stated result total', () => {
    const r = parseListingsPage('47 results\n' + cargurus, { model: 'Enclave', year: 2021 });
    expect(r.resultCount).toBe(47);
    expect(summarize(r, 'Enclave')).toContain('3 listings of 47');
  });

  it('summarizes', () => {
    const r = parseListingsPage(marketplace, { model: 'Enclave', year: 2021 });
    const s = summarize(r, 'Enclave');
    expect(s).toContain('3 listings from Facebook Marketplace');
    expect(s).toContain('median asking $18,500');
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
