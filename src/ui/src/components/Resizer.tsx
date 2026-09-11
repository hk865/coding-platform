import { useCallback, useRef } from 'react';

type Props = {
  orientation?: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onReset?: () => void;
  /** Right-hand panes grow when the handle moves left, so both drag and keys invert. */
  invert?: boolean;
};

/**
 * Keyboard-operable splitter: role=separator with aria values, arrow keys move it,
 * Home/End jump to the limits, double click restores the default.
 */
export function Resizer({ orientation = 'vertical', value, min, max, label, onChange, onCommit, onReset, invert = false }: Props) {
  const dragging = useRef<{ start: number; value: number } | null>(null);
  const clamp = useCallback((next: number) => Math.min(Math.max(Math.round(next), min), Math.max(min, max)), [min, max]);
  const vertical = orientation === 'vertical';

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = vertical ? event.clientX - dragging.current.start : dragging.current.start - event.clientY;
    onChange(clamp(dragging.current.value + delta * (invert ? -1 : 1)));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${Math.round(value)} 像素`}
      className={`resizer ${vertical ? 'resizer-vertical' : 'resizer-horizontal'}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = { start: vertical ? event.clientX : event.clientY, value };
      }}
      onPointerMove={move}
      onPointerUp={event => {
        if (!dragging.current) return;
        move(event);
        dragging.current = null;
        onCommit?.(value);
      }}
      onPointerCancel={() => { dragging.current = null; }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={event => {
        const step = event.shiftKey ? 40 : 10;
        const direction = invert ? -1 : 1;
        const keys: Record<string, number> = vertical
          ? { ArrowLeft: -step * direction, ArrowRight: step * direction }
          : { ArrowUp: -step * direction, ArrowDown: step * direction };
        if (event.key === 'Home') { event.preventDefault(); onChange(min); onCommit?.(min); return; }
        if (event.key === 'End') { event.preventDefault(); onChange(max); onCommit?.(max); return; }
        const delta = keys[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        const next = clamp(value + delta);
        onChange(next);
        onCommit?.(next);
      }}
    />
  );
}
