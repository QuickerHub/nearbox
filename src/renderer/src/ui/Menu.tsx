import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";

interface MenuProps {
  icon: IconName;
  label: string;
  title?: string;
  /** Visually flag the chip (e.g. "完全放开"). */
  tone?: "default" | "warn" | "muted";
  children(close: () => void): ReactNode;
}

/**
 * A chip that opens a small panel above itself (desktop) or a bottom sheet
 * (phone). Closes on outside click, Escape, or when an item calls `close`.
 */
export function Menu({ icon, label, title, tone = "default", children }: MenuProps): JSX.Element {
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
          <div className="menu__panel" role="menu">
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
  sub,
  on,
  disabled,
  danger,
  onClick,
}: {
  icon?: IconName;
  label: ReactNode;
  sub?: ReactNode;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className={["menu-item", on ? "menu-item--on" : "", danger ? "menu-item--danger" : ""].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={14} className="menu-item__icon" /> : <span className="menu-item__icon" />}
      <span className="menu-item__text">
        <span className="menu-item__label">{label}</span>
        {sub ? <span className="menu-item__sub">{sub}</span> : null}
      </span>
      {on ? <Icon name="check" size={14} className="menu-item__check" /> : null}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }): JSX.Element {
  return <div className="menu__heading">{children}</div>;
}

export function MenuDivider(): JSX.Element {
  return <div className="menu__divider" />;
}
