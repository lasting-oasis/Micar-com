// The date a form offers for a new entry.
import { useState } from 'react';
import { today as clockDay } from './ids';

/**
 * A form's date field. It offers today until the person picks a day, and "today" is read off the clock each time the
 * form is drawn: a form left open past midnight offers the new day, so an entry made "now" is dated the day it is
 * written. That matters to the odometer log, where a reading dated the day it is written is read differently from
 * one that is back-dated. A day the person picked is kept as picked.
 */
export function useEntryDate(): { today: string; date: string; pick: (day: string) => void } {
  const today = clockDay();
  const [picked, setPicked] = useState<string | null>(null);
  return { today, date: picked ?? today, pick: (day) => setPicked(day === '' ? null : day) };
}
