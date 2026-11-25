// CI runs the physics core's browser smokes with the others (DESIGN.md 13): the production server started once with
// SMOKE=1, then each smoke against it, every one run even when one before it fails, the job failing if any did.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), '../..');
const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const step = ci.slice(ci.indexOf('- name: Strip smoke test'));

describe('the CI smoke step', () => {
  it('runs every core smoke after the others, against the server CI started, keeping the failure', () => {
    expect(step).toMatch(/PORT: 3123/);
    expect(step).toMatch(/SMOKE: '1'/);
    const runs = [...step.matchAll(/BASE=http:\/\/localhost:3123\/ node (e2e\/[\w.-]+\.smoke\.mjs) \|\| status=\$\?/g)].map(m => m[1]);
    expect(runs.slice(0, 3)).toEqual(['e2e/strip.smoke.mjs', 'e2e/sound.smoke.mjs', 'e2e/challenge.smoke.mjs']);
    const core = readdirSync(path.join(process.cwd(), 'e2e')).filter(f => /^core.*\.smoke\.mjs$/.test(f)).map(f => `e2e/${f}`).sort();
    expect(core).toContain('e2e/core.smoke.mjs');
    for (const f of core) {
      expect(runs, f).toContain(f);
      expect(runs.indexOf(f), f).toBeGreaterThan(runs.indexOf('e2e/challenge.smoke.mjs'));
    }
    // core-race.smoke.mjs runs only where it exists (it does here)
    expect(existsSync(path.join(process.cwd(), 'e2e/core-race.smoke.mjs'))).toBe(true);
    expect(step).toMatch(/if \[ -f e2e\/core-race\.smoke\.mjs \]; then BASE=http:\/\/localhost:3123\/ node e2e\/core-race\.smoke\.mjs \|\| status=\$\?; fi/);
    // and the step still ends on the worst status
    expect(step.trimEnd()).toMatch(/exit \$status$/);
  });
});
