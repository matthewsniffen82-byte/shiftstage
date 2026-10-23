"use client";

export default function DancerPhotoBatchChoice({ photos, onKeep, onAdjust, onCancel }: {
  photos: { id: string; previewUrl: string }[]; onKeep: () => void; onAdjust: () => void; onCancel: () => void;
}) {
  return <section className="dancer-photo-batch-choice" aria-label="Review photo crops">
    <strong>{photos.length} photos selected</strong>
    <p>Keep these centered crops, or adjust each photo.</p>
    <div className="dancer-photo-batch-previews">{photos.map((photo, index) => <img key={photo.id}
      src={photo.previewUrl} alt={`Photo ${index + 1}: centered crop`} />)}</div>
    <div className="dancer-upload-actions">
      <button type="button" onClick={onKeep}>Keep all crops</button>
      <button type="button" onClick={onAdjust}>Adjust individually</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}
