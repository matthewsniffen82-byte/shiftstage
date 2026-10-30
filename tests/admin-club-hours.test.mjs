import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as weekly from '../src/lib/dancr/venue-weekly-hours.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/admin/AdminClubHoursFields.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
function fixture(props = {}) {
  const exports = {}, slots = []; let cursor = 0;
  vm.runInNewContext(code, { exports, require: name => name.includes('venue-weekly-hours') ? weekly : name === 'react' ? {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = value; }]; },
  } : require(name) });
  const render = () => { cursor = 0; return exports.default({ opensAt: '20:00:00', closesAt: '04:00:00', busy: false, ...props }); };
  const controls = () => walk(render()).filter(node => node.type === 'input' || node.type === 'select');
  const change = (name, value) => controls().find(node => node.props.name === name).props.onChange({ target: { value, form: null } });
  const week = () => JSON.parse(controls().find(node => node.props.name === 'weeklyHours').props.value);
  return { render, controls, change, week };
}

test('legacy hours populate each selected day, and edits to Friday leave other days unchanged', () => {
  const f = fixture({ openDays: [1, 2, 3, 4, 5, 6] });
  assert.equal(f.week()[0].mode, 'closed');
  f.change('clubHoursCloses5', '06:00');
  assert.equal(f.week()[5].closesAt, '06:00');
  assert.equal(f.week()[4].closesAt, '04:00');
  assert.equal(f.week()[6].closesAt, '04:00');
  assert.deepEqual(f.controls().filter(n => n.type === 'select').map(n => n.props.name), [1,2,3,4,5,6,0].map(n => 'clubHoursMode'+n));
});

test('each day supports Closed and 24 hours and preserves custom times while toggling', () => {
  const f = fixture();
  f.change('clubHoursOpens5', '21:30'); f.change('clubHoursCloses5', '05:15');
  for (const mode of ['24-hours', 'closed']) {
    f.change('clubHoursMode5', mode);
    assert.deepEqual(f.week()[5], { mode });
    assert.equal(f.controls().some(n => n.props.name === 'clubHoursOpens5'), false);
  }
  f.change('clubHoursMode5', 'custom');
  assert.deepEqual(f.week()[5], { mode: 'custom', opensAt: '21:30', closesAt: '05:15' });
});

test('saved weekly hours override legacy values; missing legacy hours start closed', () => {
  const schedule = weekly.legacyVenueWeek('00:00', '00:00', [5]);
  assert.deepEqual(fixture({ weeklyHours: schedule }).week(), schedule);
  for (const value of ['', '25:00']) assert.ok(fixture({ opensAt:value, closesAt:value }).week().every(day=>day.mode==='closed'));
  assert.ok(fixture({ opensAt:'08:30', closesAt:'08:30' }).week().every(day=>day.mode==='24-hours'));
});

test('draft recovery receives the new value immediately and retains incomplete custom hours', () => {
  const changes = [], f = fixture({ onHoursChange: hours => changes.push(hours) });
  f.change('clubHoursMode1', 'closed');
  f.change('clubHoursOpens2', '');
  const draft = changes.at(-1).weeklyHours;
  const restored = fixture({ weeklyHoursDraft: draft });
  assert.equal(restored.week()[1].mode,'closed');
  assert.equal(restored.week()[2].opensAt,'');
  assert.equal(restored.controls().find(n=>n.props.name==='clubHoursOpens2').props.required,true);
  assert.equal(weekly.isVenueWeeklyHours(restored.week()), false);
});

test('saving locks the schedule, and all-closed schedules serialize without inventing hours', () => {
  const busy=fixture({busy:true});
  assert.equal(walk(busy.render()).find(n=>n.type==='fieldset').props.disabled,true);
  assert.ok(busy.controls().filter(n=>n.props.type==='time').every(n=>n.props.readOnly));
  const f=fixture(); for(let day=0;day<7;day++)f.change('clubHoursMode'+day,'closed');
  assert.ok(weekly.isVenueWeeklyHours(f.week()));
  assert.equal(f.controls().find(n=>n.props.name==='opensAt').props.value,'');
  assert.match(renderToStaticMarkup(f.render()),/Weekly club hours/);
  const admin=readFileSync(new URL('../app/admin/AdminClient.tsx',import.meta.url),'utf8');
  assert.match(admin,/onReset=\{\(\) => \{ clearPageDraft\(venueId\); setHoursResetByVenue/);
  assert.match(admin,/venue\.weekly_hours, hoursResetByVenue\[venueId\]/);
});
