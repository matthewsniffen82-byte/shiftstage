"use client";

import type { KeyboardEvent } from "react";

export default function AdminSectionNav({ id, label, items, selected, onSelect }: {
  id: string;
  label: string;
  items: readonly { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onSelect(items[next].id);
    document.getElementById(`${id}-${items[next].id}-tab`)?.focus();
  }
  return <div className="admin-section-nav" role="tablist" aria-label={label}>
    {items.map((item, index) => <button type="button" role="tab" key={item.id} id={`${id}-${item.id}-tab`}
      aria-controls={`${id}-${item.id}-panel`} aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1}
      onClick={() => onSelect(item.id)} onKeyDown={event => move(event, index)}>{item.label}</button>)}
  </div>;
}
