// CDP encodedDataLength chunks can overcount unfinished/cancelled media by
// orders of magnitude. Only loadingFinished supplies a final wire-byte total.
export function receiveNetworkData(item, event) {
  if (item) item.receivedBytes = (item.receivedBytes || 0) + event.dataLength;
}

export function finishNetworkRequest(item, event) {
  if (item) Object.assign(item, {
    transferBytes: event.encodedDataLength,
    completed: true,
    durationMs: (event.timestamp - item.start) * 1000,
  });
}

export function summarizeNetworkBytes(requests) {
  const isMedia = item => item.type === 'Media' || /^(video|audio)\//.test(item.mime || '');
  const sum = (items, field) => items.reduce((total, item) => total + (item[field] || 0), 0);
  return {
    completedNonMediaTransferBytes: sum(requests.filter(item => !isMedia(item) && item.completed), 'transferBytes'),
    completedJsTransferBytes: sum(requests.filter(item => item.type === 'Script' && item.completed), 'transferBytes'),
    mediaReceivedBytes: sum(requests.filter(isMedia), 'receivedBytes'),
    completedMediaTransferBytes: sum(requests.filter(item => isMedia(item) && item.completed), 'transferBytes'),
    unfinishedMediaRequests: requests.filter(item => isMedia(item) && !item.completed).length,
  };
}
