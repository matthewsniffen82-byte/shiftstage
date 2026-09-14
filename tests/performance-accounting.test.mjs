import assert from 'node:assert/strict';
import test from 'node:test';
import { receiveNetworkData, finishNetworkRequest, summarizeNetworkBytes } from '../scripts/performance/network-accounting.mjs';

test('unfinished and cancelled videos report received payload without inflated CDP wire counts', () => {
  const partial = { type: 'Media', start: 1 };
  receiveNetworkData(partial, { dataLength: 262388, encodedDataLength: 6267307 });
  partial.failure = 'net::ERR_ABORTED';
  const script = { type: 'Script', start: 1 };
  finishNetworkRequest(script, { encodedDataLength: 1234, timestamp: 2 });
  const completed = { type: 'Media', start: 1 };
  receiveNetworkData(completed, { dataLength: 1024, encodedDataLength: 9000 });
  finishNetworkRequest(completed, { encodedDataLength: 1500, timestamp: 2 });
  assert.deepEqual(summarizeNetworkBytes([partial, script, completed]), {
    completedNonMediaTransferBytes: 1234, completedJsTransferBytes: 1234,
    mediaReceivedBytes: 263412, completedMediaTransferBytes: 1500, unfinishedMediaRequests: 1,
  });
  assert.equal(script.durationMs, 1000);
});

test('streaming fetches with video MIME are media; unfinished scripts are not final transfer totals', () => {
  assert.deepEqual(summarizeNetworkBytes([{ type: 'Fetch', mime: 'video/mp4', receivedBytes: 200 }, { type: 'Script', receivedBytes: 900 }]), {
    completedNonMediaTransferBytes: 0, completedJsTransferBytes: 0,
    mediaReceivedBytes: 200, completedMediaTransferBytes: 0, unfinishedMediaRequests: 1,
  });
});
