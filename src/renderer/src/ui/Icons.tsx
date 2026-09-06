export function SendIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.4 11.2 20.1 3.6c.7-.3 1.4.4 1.1 1.1l-7.6 16.7c-.3.7-1.3.6-1.5-.2l-1.8-7.1-7.1-1.8c-.8-.2-.9-1.2-.2-1.5Z"
      />
    </svg>
  );
}

export function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

export function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4.2c.4 0 .8.2 1.1.5L13 6h5a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-11Z"
      />
    </svg>
  );
}

export function FileIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 3.5h6.2L19 9.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7 3.5Zm6 1.6V9h3.8L13 5.1Z"
      />
    </svg>
  );
}

export function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 5.5A1.5 1.5 0 0 1 9.5 4h8A1.5 1.5 0 0 1 19 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9.5A1.5 1.5 0 0 1 8 15.5v-10Zm-3 3A1.5 1.5 0 0 1 6.5 7H7v8.5A3 3 0 0 0 10 18.5h6.5v.5A1.5 1.5 0 0 1 15 20.5H6.5A1.5 1.5 0 0 1 5 19V8.5Z"
      />
    </svg>
  );
}

export function RefreshIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5a7 7 0 1 1-6.3 4H8a1 1 0 1 1 0 2H3.8A1.3 1.3 0 0 1 2.5 9.7V5a1 1 0 1 1 2 0v1.7A9 9 0 1 0 12 3a1 1 0 1 1 0 2Z"
      />
    </svg>
  );
}

export function ThemeIcon({ mode }: { mode: "system" | "light" | "dark" }): JSX.Element {
  if (mode === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-4a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 16a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM4 11a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2h1Zm17 0a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1ZM6.05 6.05a1 1 0 0 1 1.4 0l.7.7a1 1 0 0 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4Zm9.9 9.9a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4ZM6.05 17.95a1 1 0 0 1 0-1.4l.7-.7a1 1 0 0 1 1.4 1.4l-.7.7a1 1 0 0 1-1.4 0Zm9.9-9.9a1 1 0 0 1 0-1.4l.7-.7a1 1 0 1 1 1.4 1.4l-.7.7a1 1 0 0 1-1.4 0Z"
        />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.4 13.6A7 7 0 0 1 10 5.1 7 7 0 1 0 18.9 14a7 7 0 0 1-2.5-.4Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 4.5a7.5 7.5 0 1 1 0 15V4.5Zm0-1.5a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
      />
    </svg>
  );
}
