interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        background: 'var(--maestro-ink-2)',
        border: '1px solid var(--maestro-ink-3)',
        color: 'var(--fg-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        padding: '10px 16px',
        borderRadius: 'var(--radius-pill)',
        boxShadow: 'var(--shadow-3)',
        animation: 'toastIn var(--dur-base) var(--ease-out)',
        zIndex: 60,
        maxWidth: '88vw',
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
