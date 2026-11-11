// The public view: what anyone may be shown of a passport. It is built from the passport's standing (what counts,
// what was withdrawn) and from the part of its stored history its own record supports, and it is the only
// projection meant to leave the owner's device.
import { supportedHistory } from './cards';
import { EVENT_TYPE_LABELS, currentOwner } from './passport';
import type { AttachmentKind, Passport, PublicEvent, PublicPassport, VerifierRegistry } from './types';
import { monthOf } from './util';
import type { Standing } from './verification';
import { eventEvidence, standingOf } from './verification';

/**
 * What anyone may be shown of a passport. It is the only projection meant to leave the owner's device.
 * Left out entirely: the VIN (only whether one is on file), every owner's id, every file's name, id and fingerprint,
 * every note, cost, shop and inspector, the specification's sources, what an attestation said, anything withdrawn,
 * and any stored grade or card edition that claims more than the passport's own attestations support.
 * Blurred: a day becomes its month (for entries, grade snapshots and card editions alike, so a snapshot cannot give
 * away the day of the entry that caused it), and a reading is rounded down to the thousand. A title is shown only
 * when the owner marked that entry public; otherwise the entry carries the plain name of its kind.
 */
export function publicPassport(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): PublicPassport {
  const events: PublicEvent[] = standing.events.map((e) => {
    const attachments: Partial<Record<AttachmentKind, number>> = {};
    for (const a of e.attachments) attachments[a.kind] = (attachments[a.kind] ?? 0) + 1;
    const own = e.type !== 'attestation' && e.visibility === 'public' && e.title !== '';
    return {
      type: e.type, month: monthOf(e.date), title: own ? e.title : EVENT_TYPE_LABELS[e.type], mileage: e.mileage === null ? null : Math.floor(e.mileage / 1000) * 1000, attachments,
      verified: eventEvidence(passport, e.id, registry, asOf, standing) === 'verified', scope: e.type === 'attestation' ? e.attestation.scope : null,
    };
  });
  // Only the history the passport's own record supports is shown: a file cannot claim a level it never earned.
  const history = supportedHistory(passport, registry);
  const owner = currentOwner(passport);
  const since = passport.owners.filter((o) => o.ownerId === owner && o.to === null)[0];
  const id = passport.spec.identity;
  return {
    micarId: passport.micarId,
    createdMonth: monthOf(passport.createdAt),
    identity: { year: id.year, make: id.make, model: id.model, trim: id.trim, bodyClass: id.bodyClass },
    color: passport.color,
    vinOnFile: passport.vin !== '',
    ownerCount: passport.owners.length,
    currentOwnerSince: since ? monthOf(since.from) : monthOf(passport.createdAt),
    events,
    snapshots: history.snapshots.map((s) => ({ month: monthOf(s.asOf), formula: s.formula, overall: s.overall, grade10: s.grade10, tier: s.tier, categories: { ...s.categories }, level: s.level })),
    editions: history.editions.map((e) => ({
      number: e.number, name: e.name, month: monthOf(e.issuedAt), level: e.level, rarity: e.rarity, finish: e.finish, grade10: e.grade10, powerRating: e.powerRating, attributes: { ...e.attributes },
    })),
  };
}
