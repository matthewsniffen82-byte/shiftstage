import assert from 'node:assert/strict';
import test from 'node:test';
import { safetyIntake, privacyIntake } from '../src/lib/dancr/public-case-intake.ts';
const intimate = { reason:'Nonconsensual intimate image', contactEmail:'synthetic@example.invalid', contentLocation:'Profile URL', requestedAction:'Remove', signature:'Synthetic person', authority:'I am depicted', goodFaith:true };
test('intimate-image intake needs each required field but no account, ID upload or copyright statement', () => {
  for (const key of ['contactEmail','contentLocation','requestedAction','signature','authority','goodFaith']) {
    assert.throws(() => safetyIntake({ ...intimate, [key]:key==='goodFaith'?false:'' }, false), error => error.status===400);
  }
  const result=safetyIntake(intimate,false);
  assert.equal(result.priority,'urgent');
  assert.equal(result.intake.signature,'Synthetic person');
  assert.equal(safetyIntake({...intimate,contentLocation:''},true).case_kind,'safety');
});
test('ordinary safety reports allow anonymous contact and urgent reports keep their priority', () => {
  assert.equal(safetyIntake({reason:'Harassment or abuse'},true).intake.contactEmail,'');
  assert.equal(safetyIntake({reason:'Underage concern',contentLocation:'A profile'},false).priority,'urgent');
  assert.throws(()=>safetyIntake({reason:'Other safety concern'},false));
  assert.throws(()=>safetyIntake({...intimate,contactEmail:'bad-address'},true));
  assert.throws(()=>safetyIntake({...intimate,authority:'a'.repeat(1001)},true));
});
const privacy = {right:'Delete my information',contactEmail:'synthetic@example.invalid',jurisdiction:'California, US',authority:'Myself',details:'Account email synthetic@example.invalid'};
test('privacy intake records the right, jurisdiction and authority without performing a deletion', () => {
  assert.equal(privacyIntake(privacy).verificationStatus,'not_started');
  for (const key of ['right','contactEmail','jurisdiction','authority','details']) assert.throws(()=>privacyIntake({...privacy,[key]:''}));
  assert.throws(()=>privacyIntake({...privacy,right:'arbitrary database command'}));
  assert.equal(privacyIntake({...privacy,right:'Opt out of sale or sharing'}).verificationStatus,'not_required');
  assert.equal(privacyIntake({...privacy,right:'Limit sensitive information use'}).verificationStatus,'not_required');
});
