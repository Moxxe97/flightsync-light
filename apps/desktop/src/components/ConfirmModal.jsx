// Reusable in-app confirmation modal. Used instead of window.confirm() because
// window.confirm is unreliable across the Tauri WebViews: on the macOS WebView
// (wry) it returns a Promise (truthy) and shows no dialog, so a synchronous
// `if (!confirm())` guard never blocks. A React modal behaves identically on
// desktop and Android.
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  onCancel,
  danger = false,
}) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f1525', border: '1px solid #1e2a45', borderRadius: 14,
          padding: 28, maxWidth: 380, width: '90%', textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 10 }}>
          {title}
        </div>
        {message && (
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24, lineHeight: 1.5 }}>
            {message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '8px 20px', fontSize: 13 }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={danger ? undefined : 'btn btn-primary'}
            style={
              danger
                ? { padding: '8px 20px', fontSize: 13, fontWeight: 600, background: '#dc2626', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer' }
                : { padding: '8px 20px', fontSize: 13, fontWeight: 600 }
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
