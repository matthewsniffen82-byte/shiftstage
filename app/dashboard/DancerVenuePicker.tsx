"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./dancer-venue-picker.css";

type VenueOption = { id: string; name: string };

export default function DancerVenuePicker({ venues, value, onChange, disabled = false }: {
  venues: VenueOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [above, setAbove] = useState(false);
  const selected = venues.find(venue => venue.id === value);
  const blocked = disabled || !venues.length;
  const expanded = open && !blocked;
  const active = Math.min(activeIndex, Math.max(venues.length - 1, 0));
  const text = selected?.name || (venues.length ? "Choose approved venue" : "No approved venue affiliations");

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);

  useEffect(() => {
    if (expanded) root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  function choose(index: number) {
    if (blocked || !venues[index]) return;
    onChange(venues[index].id);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function show(index: number) {
    const field = trigger.current?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const panelBottom = root.current?.closest(".shift-panel")?.getBoundingClientRect().bottom ?? visibleBottom;
    const listHeight = Math.min(224, venues.length * 48 + 8, window.innerHeight * 0.4);
    setAbove(Boolean(field && Math.min(visibleBottom, panelBottom) - field.bottom < listHeight + 12 && field.top > listHeight + 12));
    setActiveIndex(index);
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (blocked) return;
    const selectedIndex = Math.max(0, venues.findIndex(venue => venue.id === value));
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      show(event.key === "Home" ? 0 : event.key === "End" ? venues.length - 1
        : !expanded ? selectedIndex : (active + (event.key === "ArrowDown" ? 1 : -1) + venues.length) % venues.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (expanded) choose(active);
      else show(selectedIndex);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const index = venues.findIndex(venue => venue.name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (index >= 0) { event.preventDefault(); show(index); }
    }
  }

  return <div className="dancer-venue-picker" ref={root} onKeyDown={onKeyDown}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span className="dancer-venue-picker-label" id={`${id}-label`}>Approved venue</span>
    <button className="dancer-schedule-control" type="button" role="combobox" ref={trigger}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={`${id}-list`} aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
      disabled={blocked} title={text}
      onClick={() => { if (expanded) setOpen(false); else show(Math.max(0, venues.findIndex(venue => venue.id === value))); }}>
      <span id={`${id}-value`}>{text}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {expanded ? <div className={`dancer-venue-picker-list${above ? " is-above" : ""}`} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
      {venues.map((venue, index) => <button type="button" role="option" tabIndex={-1} key={venue.id}
        id={`${id}-option-${index}`} aria-selected={venue.id === value} data-active={index === active}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{venue.name}</span>
        {venue.id === value ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 12 4 4L19 6" /></svg> : null}
      </button>)}
    </div> : null}
  </div>;
}
