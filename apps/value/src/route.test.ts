import { describe, expect, it } from 'vitest'
import { routeFromHash, sectionFromHash } from './route'

describe('routeFromHash', () => {
  it.each(['', '#grade', '#nope'])('%j is the door', (hash) => {
    expect(routeFromHash(hash, '')).toEqual({ view: 'door' })
  })
  it('#/value is the calculator', () => {
    expect(routeFromHash('#/value', '')).toEqual({ view: 'value' })
  })
  it('#/sticker has no code', () => {
    expect(routeFromHash('#/sticker', '').code).toBeUndefined()
    expect(routeFromHash('#/sticker', '').view).toBe('sticker')
  })
  it('#/sticker/abc carries the code', () => {
    expect(routeFromHash('#/sticker/abc', '')).toEqual({ view: 'sticker', code: 'abc' })
  })
  it.each(['#/c/abc', '#/car/abc'])('%s is a car page', (hash) => {
    expect(routeFromHash(hash, '')).toEqual({ view: 'car', code: 'abc' })
  })
  it('#/c has an empty code', () => {
    expect(routeFromHash('#/c', '')).toEqual({ view: 'car', code: '' })
  })
  it('a legacy calculator query opens the calculator', () => {
    expect(routeFromHash('#grade', '?make=Toyota')).toEqual({ view: 'value' })
  })
  it('ignores a query after the route', () => {
    expect(routeFromHash('#/value?x=1', '')).toEqual({ view: 'value' })
  })
  it('works with no document (Node environment)', () => {
    expect(typeof document).toBe('undefined')
  })
})

describe('sectionFromHash', () => {
  it.each([['#grade', 'grade'], ['#keyholder', 'keyholder'], ['#card-2', 'card-2']])('%s -> %s', (hash, id) => {
    expect(sectionFromHash(hash)).toBe(id)
  })
  it.each(['#/value', '#/c/abc', '#', '', '#link=abc', '#%E0'])('%j -> null', (hash) => {
    expect(sectionFromHash(hash)).toBeNull()
  })
})
