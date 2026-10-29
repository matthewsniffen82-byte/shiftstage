import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import feedback from '../public/profile-action-feedback.js';

function surface() {
  const notices = [], timers = new Map(), listeners = new Map();
  let timerId = 0;
  const events = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const win = { ...events, innerWidth: 360, innerHeight: 780,
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const doc = { ...events, defaultView: win, body: { appendChild: node => notices.push(node) },
    createElement: () => ({ style: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect: () => ({ width: 76, height: 28 }),
      remove() { notices.splice(notices.indexOf(this), 1); },
    }),
  };
  const button = { isConnected: true, ownerDocument: doc, getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 300, right: 344, top: 300, bottom: 344, height: 44 }),
  };
  return { button, doc, notices, timers, listeners };
}

test('confirmation sits beside the tapped button, announces the label, and expires after 1.8 seconds', () => {
  const f = surface();
  feedback.show(f.button, 'Following');
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].textContent, 'Following');
  assert.equal(f.notices[0].attributes.role, 'status');
  assert.equal(f.notices[0].style.left, '216px');
  assert.equal(f.notices[0].style.top, '308px');
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 1800);
  timer.fn();
  assert.equal(f.notices.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('a new action replaces the old confirmation; scrolling and explicit dismissal remove it', () => {
  const f = surface();
  feedback.show(f.button, 'Following');
  feedback.show(f.button, 'I’m Going');
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].textContent, 'I’m Going');
  assert.equal(f.timers.size, 1);
  f.listeners.get('scroll')();
  assert.equal(f.notices.length, 0);
  feedback.show(f.button, 'Following');
  feedback.dismiss();
  assert.equal(f.notices.length, 0);
  assert.equal(f.listeners.size, 0);
});

test('closed or hidden profiles get no floating confirmation and edge positions stay on screen', () => {
  const f = surface();
  f.button.isConnected = false;
  feedback.show(f.button, 'Following');
  assert.equal(f.notices.length, 0);
  f.button.isConnected = true;
  f.button.getClientRects = () => [];
  feedback.show(f.button, 'Following');
  assert.equal(f.notices.length, 0);
  f.button.getClientRects = () => [1];
  f.button.getBoundingClientRect = () => ({ left: 4, right: 48, top: 760, bottom: 804, height: 44 });
  feedback.show(f.button, 'I’m Going');
  assert.equal(f.notices[0].style.left, '56px');
  assert.equal(f.notices[0].style.top, '744px');
  feedback.dismiss();
});

function extract(path, start, end) {
  const source = readFileSync(path, 'utf8');
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

for (const action of ['follow', 'going']) for (const selected of [false, true]) for (const succeeds of [false, true]) {
  test(`public profile ${action} ${selected ? 'removal' : 'selection'} ${succeeds ? 'confirms only after saving' : 'never confirms a failed save'}`, async () => {
    let resolve, reject;
    const response = new Promise((yes, no) => { resolve = yes; reject = no; });
    const notices = [], button = {};
    const context = vm.createContext({
      Error, AbortController, mountedRef: { current: true }, savedLoaded: true, dancerId: 'dancer',
      followAbortRef: { current: null }, followInFlightRef: { current: false },
      goingAbortRef: { current: null }, goingInFlightRef: { current: false },
      saved: { following: selected, notificationsEnabled: selected, goingShiftIds: selected ? ['shift'] : [] },
      readBrowserAuthSession: () => ({ account: { id: 'guest' } }),
      setSaved: update => { context.saved = update(context.saved); },
      setStatus() {}, setFollowSaving() {}, setGoingSaving() {}, setFollowerCount() {}, setNotificationCount() {}, setGoingCount() {}, setFollowedBy() {}, offerPushNotifications() {},
      readConfirmedFollowerCount: data => data.followerCount, readConfirmedNotificationCount: () => 1, readConfirmedGoingCount: data => data.goingCount,
      postAction: () => response, postGoingAction: () => response,
      profileActionFeedback: { dismiss() {}, show: (anchor, text) => notices.push({ anchor, text }) },
    });
    const code = extract('app/dancers/[slug]/DancerProfileActions.tsx', '  async function updateFollow(', '  async function postGoingAction(');
    vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const pending = action === 'follow' ? context.updateFollow(button) : context.updateGoing('shift', button);
    assert.equal(notices.length, 0);
    if (succeeds) resolve({ following: !selected, going: !selected, followerCount: 1, goingCount: 1 });
    else reject(new Error('Save failed'));
    await pending;
    assert.equal(notices.length, succeeds ? 1 : 0);
    if (succeeds) {
      assert.equal(notices[0].anchor, button);
      assert.equal(notices[0].text, action === 'follow' ? (selected ? 'Unfollowed' : 'Following') : (selected ? 'Removed' : 'I’m Going'));
    }
  });
}

for (const selected of [false, true]) for (const succeeds of [false, true]) {
  test(`discovery profile going ${selected ? 'removal' : 'selection'} ${succeeds ? 'confirms' : 'reports an error without confirming'}`, async () => {
    let resolve, reject;
    const response = new Promise((yes, no) => { resolve = yes; reject = no; });
    const notices = [], errors = [];
    const button = { dataset: { profile: 'Ty' }, classList: { toggle() {} }, setAttribute() {} };
    const context = vm.createContext({
      window: { MyDancrActionFeedback: { dismiss() {}, show: (anchor, text) => notices.push({ anchor, text }) } },
      document: { getElementById: () => null }, findProfile: () => ({ shiftId: 'shift' }),
      goingTonightSavedByProfile: { Ty: selected }, goingTonightByProfile: {}, tonightInterestCount: () => 2,
      profileActionButtonMarkup: () => '', syncHomeFeedActionButtons() {}, citySelect: { value: 'Las Vegas' },
      recordLiveEvent() {}, postOptionalAuthJson: () => response, showToast: text => errors.push(text),
    });
    vm.runInContext(extract('src/live-shell/app/23-events.js', '    async function saveProfileGoing(', '    profileModal.addEventListener('), context);
    const pending = context.saveProfileGoing(button);
    assert.equal(notices.length, 0);
    if (succeeds) resolve({ going: !selected, goingCount: 2 });
    else reject(new Error('Save failed'));
    await pending;
    assert.equal(notices.length, succeeds ? 1 : 0);
    assert.equal(errors.length, succeeds ? 0 : 1);
    if (succeeds) assert.deepEqual(notices[0], { anchor: button, text: selected ? 'Removed' : 'I’m Going' });
  });
}
