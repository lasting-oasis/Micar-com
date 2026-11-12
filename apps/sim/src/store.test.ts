import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useGameStore, ORDER_TIMEOUT_MS, accountChanged, raceHandlers } from './store';
import type { RoomView } from './world/race';
import { remotes } from './world/raceNet';
import type { GameState } from './types';

describe('openGarage', () => {
  const withCars = (cars: { id: string; rental?: boolean }[]) =>
    useGameStore.setState({ playerId: 'p1', garageCarId: null, gameState: { players: { p1: { id: 'p1', inventory: cars } } } as unknown as GameState });
  it('never opens on a rental', () => {
    withCars([{ id: 'r1', rental: true }]);
    useGameStore.getState().openGarage('r1');
    expect(useGameStore.getState().garageCarId).toBeNull();
  });
  it('opens on a car of your own', () => {
    withCars([{ id: 'c1' }]);
    useGameStore.getState().openGarage('c1');
    expect(useGameStore.getState().garageCarId).toBe('c1');
  });
  it('the bay opens on the tab asked for, and on Custom when none is', () => {
    withCars([{ id: 'c1' }]);
    useGameStore.getState().openGarage('c1', 'body');
    expect(useGameStore.getState().bayTab).toBe('body');
    useGameStore.getState().openGarage('c1');
    expect(useGameStore.getState().bayTab).toBe('custom');
  });
});

describe('placeOrder', () => {
  const lines = [{ kind: 'repair' as const, repairId: 'f1' }];
  afterEach(() => { vi.useRealTimers(); useGameStore.setState({ socket: null, orderPending: false, lastOrder: null, bayTab: 'custom' }); });
  it('an order is sent once however often it is tapped', () => {
    const sent: unknown[][] = [];
    useGameStore.setState({ socket: { emit: (...a: unknown[]) => { sent.push(a); } } as never, orderPending: false });
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    expect(sent).toEqual([['bay_order', { carId: 'c1', door: 'garage', lines, quote: 250 }]]);
    expect(useGameStore.getState().orderPending).toBe(true);
  });
  it('with no socket nothing is sent and nothing is pending', () => {
    useGameStore.setState({ socket: null, orderPending: false });
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    expect(useGameStore.getState().orderPending).toBe(false);
  });
});

describe('the bay leaves with the player', () => {
  const order = { id: 'o1' } as never;
  const dirty = () => useGameStore.setState({ socket: { emit: () => {}, disconnect: () => {} } as never, lastOrder: order, orderPending: true, bayTab: 'body' });
  const clean = () => { const st = useGameStore.getState(); expect([st.lastOrder, st.orderPending, st.bayTab]).toEqual([null, false, 'custom']); };
  afterEach(() => { useGameStore.setState({ socket: null, lastOrder: null, orderPending: false, bayTab: 'custom' }); });
  it('signOut clears the order, the pending flag and the tab', () => { dirty(); useGameStore.getState().signOut(); clean(); });
  it('disconnect clears the order, the pending flag and the tab', () => { dirty(); useGameStore.getState().disconnect(); clean(); });
});

describe('an unanswered order', () => {
  const lines = [{ kind: 'repair' as const, repairId: 'f1' }];
  const fake = () => useGameStore.setState({ socket: { emit: () => {} } as never, orderPending: false });
  afterEach(() => { vi.useRealTimers(); useGameStore.setState({ socket: null, orderPending: false }); });
  it('gives up after ten seconds', () => {
    vi.useFakeTimers(); fake();
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(ORDER_TIMEOUT_MS - 100);
    expect(useGameStore.getState().orderPending).toBe(true);
    vi.advanceTimersByTime(100);
    expect(useGameStore.getState().orderPending).toBe(false);
  });
  it('the first order\'s timer never clears a later order', () => {
    vi.useFakeTimers(); fake();
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(3000);
    useGameStore.setState({ orderPending: false }); // answered
    vi.advanceTimersByTime(2000);
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(5000); // t = 10s: first timer's moment
    expect(useGameStore.getState().orderPending).toBe(true);
    vi.advanceTimersByTime(5000); // t = 15s
    expect(useGameStore.getState().orderPending).toBe(false);
  });
});

describe('accountChanged', () => {
  it('tells a new account from a reconnect', () => {
    expect(accountChanged(null, undefined)).toBe(false);
    expect(accountChanged(null, { id: 'a' })).toBe(true);
    expect(accountChanged({ id: 'a' }, null)).toBe(true);
    expect(accountChanged({ id: 'a' }, { id: 'a' })).toBe(false);
    expect(accountChanged({ id: 'a' }, { id: 'b' })).toBe(true);
  });
});

describe('a challenge room', () => {
  const member = (id: string, state: string) => ({ id, name: id.toUpperCase(), slot: 0, state, time: null, score: 0, why: null });
  const view = (over: Record<string, unknown> = {}) => ({ code: 'K7M2QX', eventId: 'royal_drag', car: 'ronin', hostId: 'h', phase: 'open', raceNo: 0,
    members: [member('h', 'waiting'), member('p1', 'waiting')], goAt: null, closesAt: null, last: null, note: null, ...over }) as unknown as RoomView;
  /** a socket that records what is sent; the clock probes (race_time) are the store's own business */
  const stub = () => { const all: unknown[][] = []; return { emit: (...a: unknown[]) => { all.push(a); return true; }, sent: () => all.filter(a => a[0] !== 'race_time'), probes: () => all.filter(a => a[0] === 'race_time').length }; };
  beforeEach(() => { vi.useFakeTimers(); useGameStore.setState({ socket: null, playerId: 'p1', race: null, raceCode: null, raceDenied: null, raceNote: null }); });
  afterEach(() => { vi.useRealTimers(); useGameStore.setState({ socket: null, playerId: null, race: null, raceCode: null, raceDenied: null, raceNote: null }); remotes.clear(); });

  it('the room that arrives is kept, and is the room to come back to', () => {
    const s = stub(), h = raceHandlers(s);
    useGameStore.setState({ raceDenied: 'host' });
    h.race_room(view());
    expect(useGameStore.getState()).toMatchObject({ raceCode: 'K7M2QX', raceDenied: null, raceNote: null });
    expect(useGameStore.getState().race!.members).toHaveLength(2);
    for (const junk of [null, undefined, 'x', {}, { code: 7 }, { code: 'K7M2QX' }]) h.race_room(junk as never); // not a room: ignored
    expect(useGameStore.getState().race!.code).toBe('K7M2QX');
  });
  it('joins the room again on every init', () => {
    const s = stub(), h = raceHandlers(s);
    useGameStore.setState({ raceCode: 'K7M2QX', race: view(), raceNote: 'missed' });
    h.onInit(); // a reconnect: the server knows this socket from nothing
    expect(s.sent()).toEqual([['race_join', { code: 'K7M2QX' }]]);
    expect(useGameStore.getState()).toMatchObject({ race: null, raceNote: null, raceCode: 'K7M2QX' });
    const quiet = stub();
    useGameStore.setState({ raceCode: null });
    raceHandlers(quiet).onInit();
    expect(quiet.sent()).toEqual([]);
  });
  it('a sign-in that swaps this run for a saved one joins the room again; one that keeps the run changes nothing', () => {
    // the server takes the old run out of its room when a saved player replaces it (link_account), and sends no init
    const s = stub(), h = raceHandlers(s);
    useGameStore.setState({ raceCode: 'K7M2QX', race: view(), raceNote: 'missed' });
    h.onLinked({ replaced: false }); // a new account made from this run: still the same player, still in the room
    expect(s.sent()).toEqual([]);
    expect(useGameStore.getState().race!.code).toBe('K7M2QX');
    for (const junk of [null, undefined, {}, { replaced: 'yes' }]) h.onLinked(junk as never);
    expect(s.sent()).toEqual([]);
    h.onLinked({ replaced: true });
    expect(s.sent()).toEqual([['race_join', { code: 'K7M2QX' }]]);
    expect(useGameStore.getState()).toMatchObject({ race: null, raceNote: null, raceCode: 'K7M2QX' });
    const quiet = stub();
    useGameStore.setState({ raceCode: null });
    raceHandlers(quiet).onLinked({ replaced: true }); // in no room: nothing to come back to
    expect(quiet.sent()).toEqual([]);
  });
  it('a gone or full room is forgotten; other refusals keep the room', () => {
    const h = raceHandlers(stub());
    for (const why of ['gone', 'full'] as const) {
      useGameStore.setState({ race: view(), raceCode: 'K7M2QX', raceNote: 'missed' });
      h.race_denied({ why });
      expect(useGameStore.getState()).toMatchObject({ race: null, raceCode: null, raceDenied: why, raceNote: null });
    }
    useGameStore.setState({ race: view(), raceCode: 'K7M2QX' });
    h.race_denied({ why: 'host' });
    expect(useGameStore.getState()).toMatchObject({ raceCode: 'K7M2QX', raceDenied: 'host' });
    expect(useGameStore.getState().race).not.toBeNull();
    for (const junk of [null, undefined, {}, { why: 7 }]) h.race_denied(junk as never); // a refusal with no reason is still a refusal
    expect(useGameStore.getState().raceDenied).toBe('state');
  });
  it('missing a start is said once', () => {
    const h = raceHandlers(stub());
    h.race_room(view({ phase: 'loading', raceNo: 1, members: [member('h', 'loading'), member('p1', 'loading')] }));
    expect(useGameStore.getState().raceNote).toBeNull();
    h.race_room(view({ phase: 'racing', raceNo: 1, goAt: 5000, members: [member('h', 'racing'), member('x', 'racing'), member('p1', 'waiting')] }));
    expect(useGameStore.getState().raceNote).toBe('missed'); // the others went without this page
    h.race_room(view({ phase: 'open', raceNo: 1 }));
    expect(useGameStore.getState().raceNote).toBe('missed'); // still said while the waiting room is up
    h.race_room(view({ phase: 'loading', raceNo: 2, members: [member('h', 'loading'), member('p1', 'loading')] }));
    expect(useGameStore.getState().raceNote).toBeNull();
    // someone who was never in the race missed nothing
    h.race_room(view({ phase: 'racing', raceNo: 2, members: [member('h', 'racing'), member('x', 'racing'), member('p1', 'racing')] }));
    expect(useGameStore.getState().raceNote).toBeNull();
  });
  it('the clock is measured on entering a room and again at each start; the other racers are forgotten between races', () => {
    const s = stub(), h = raceHandlers(s);
    h.race_room(view()); vi.advanceTimersByTime(5000);
    expect(s.probes()).toBe(5);
    h.race_room(view({ members: [member('h', 'waiting'), member('p1', 'waiting'), member('x', 'waiting')] })); vi.advanceTimersByTime(5000);
    expect(s.probes()).toBe(5); // someone joined: nothing to measure
    h.race_pose(['x', 10, 1, 2, .5, 30, 100, 7]);
    expect(remotes.size).toBe(1);
    h.race_room(view({ phase: 'loading', raceNo: 1 })); vi.advanceTimersByTime(5000);
    expect(s.probes()).toBe(10);
    expect(remotes.size).toBe(0);
    h.race_pose(['x', 10, 1, 2, .5, 30, 100, 7]);
    h.race_room(view({ phase: 'racing', raceNo: 1, goAt: 9000 })); vi.advanceTimersByTime(5000);
    expect(s.probes()).toBe(10);
    expect(remotes.size).toBe(1); // the same race: its poses stay
  });
  it('createRace, joinRace, setRace and startRace send what the server reads', () => {
    const s = stub();
    useGameStore.setState({ socket: s as never, raceDenied: 'pick' });
    const st = useGameStore.getState();
    st.createRace('royal_drag', 'ronin'); st.joinRace('K7M2QX'); st.setRace('harbour_gp', 'civet'); st.startRace();
    expect(s.sent()).toEqual([['race_create', { eventId: 'royal_drag', car: 'ronin' }], ['race_join', { code: 'K7M2QX' }], ['race_set', { eventId: 'harbour_gp', car: 'civet' }], ['race_start']]);
    expect(useGameStore.getState()).toMatchObject({ raceCode: 'K7M2QX', raceDenied: null });
  });
  it('joinRace before the player is in only remembers the room: init joins it', () => {
    const s = stub();
    useGameStore.setState({ socket: s as never, playerId: null });
    useGameStore.getState().joinRace('K7M2QX');
    expect(s.sent()).toEqual([]);
    expect(useGameStore.getState().raceCode).toBe('K7M2QX');
  });
  it('leaveRace emits and forgets', () => {
    const s = stub();
    useGameStore.setState({ socket: s as never, race: view(), raceCode: 'K7M2QX', raceDenied: 'host', raceNote: 'missed' });
    raceHandlers(s).race_pose(['x', 10, 1, 2, .5, 30, 100, 7]);
    useGameStore.getState().leaveRace();
    expect(s.sent()).toEqual([['race_leave']]);
    expect(useGameStore.getState()).toMatchObject({ race: null, raceCode: null, raceDenied: null, raceNote: null });
    expect(remotes.size).toBe(0);
  });
});
