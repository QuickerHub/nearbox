import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";

interface MenuProps {
  icon: IconName;
  label: string;
  title?: string;
  /** Visually flag the chip (e.g. "完全放开"). */
  tone?: "default" | "warn" | "muted";
  /** Extra class on the panel, e.g. "menu__panel--split" for a fixed head/foot with a scrolling middle. */
  panelClassName?: string;
  children(close: () => void): ReactNode;
}

/**
 * A chip that opens a small panel above itself (desktop) or a bottom sheet
 * (phone). Closes on outside click, Escape, or when an item calls `close`.
 */
export function Menu({ icon, label, title, tone = "default", panelClassName, children }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={`menu${open ? " menu--open" : ""}`} ref={root}>
      <button
        type="button"
        className={`chip-btn chip-btn--${tone}${open ? " chip-btn--open" : ""}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} size={14} />
        <span className="chip-btn__label">{label}</span>
        <Icon name="chevron" size={12} className="chip-btn__chevron" />
      </button>
      {open ? (
        <>
          <div className="menu__backdrop" onClick={close} role="presentation" />
          <div className={panelClassName ? `menu__panel ${panelClassName}` : "menu__panel"} role="menu">
            {children(close)}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  sub,
  on,
  disabled,
  danger,
  plain,
  onClick,
}: {
  icon?: IconName;
  label: ReactNode;
  /** Same-line muted tag, e.g. "Max" or "High Fast". */
  hint?: string;
  sub?: ReactNode;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** No leading icon column — used in compact Cursor-style lists. */
  plain?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className={["menu-item", on ? "menu-item--on" : "", danger ? "menu-item--danger" : "", plain ? "menu-item--plain" : ""].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
    >
      {plain ? null : icon ? <Icon name={icon} size={14} className="menu-item__icon" /> : <span className="menu-item__icon" />}
      <span className="menu-item__text">
        <span className="menu-item__label">
          {label}
          {hint ? <span className="menu-item__hint">{hint}</span> : null}
        </span>
        {sub ? <span className="menu-item__sub">{sub}</span> : null}
      </span>
      {on ? <Icon name="check" size={14} className="menu-item__check" /> : null}
    </button>
  );
}

/** A compact row: label left, current value + chevron right. */
export function MenuNav({
  label,
  value,
  open,
  onClick,
}: {
  label: string;
  value?: string;
  open?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button type="button" className={`menu-nav${open ? " menu-nav--open" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={onClick}>
      <span className="menu-nav__label">{label}</span>
      {value ? <span className="menu-nav__value">{value}</span> : null}
      <Icon name="chevron" size={12} className="menu-nav__chevron" />
    </button>
  );
}

/** Desktop flyout: hover or click the row to open a panel to the side. */
export function MenuFlyout({
  label,
  value,
  panelClassName,
  children,
}: {
  label: string;
  value?: string;
  panelClassName?: string;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ side: "right" | "left"; left: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open || !root.current) {
      setPlace(null);
      return;
    }
    const update = () => {
      const rect = root.current!.getBoundingClientRect();
      const side = window.innerWidth - rect.right < 300 ? "left" : "right";
      setPlace({ side, left: rect.right - 2, right: window.innerWidth - rect.left - 2, bottom: window.innerHeight - rect.bottom });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  return (
    <div
      className={`menu-flyout menu-flyout--${place?.side ?? "right"}${open ? " menu-flyout--open" : ""}`}
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <MenuNav label={label} value={value} open={open} onClick={() => setOpen((current) => !current)} />
      {open && place ? (
        <div
          className={panelClassName ? `menu-flyout__panel ${panelClassName}` : "menu-flyout__panel"}
          role="menu"
          style={place.side === "right" ? { top: "auto", bottom: place.bottom, left: place.left, right: "auto" } : { top: "auto", bottom: place.bottom, left: "auto", right: place.right }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** One-line on/off row (Cursor's Fast toggle). */
export function MenuSwitch({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} className={`menu-switch${on ? " menu-switch--on" : ""}`} disabled={disabled} onClick={onClick}>
      <span className="menu-switch__label">{label}</span>
      <span className="menu-switch__track" aria-hidden />
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }): JSX.Element {
  return <div className="menu__heading">{children}</div>;
}

export function MenuDivider(): JSX.Element {
  return <div className="menu__divider" />;
}
