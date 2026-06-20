// src/components/MobileSectionHeader.jsx
export default function MobileSectionHeader({ title, onBack }) {
  return (
    <div className="mobile-section-header">
      <button type="button" className="mobile-back-btn" onClick={onBack} aria-label="Retour au menu">
        &#8249;
      </button>
      <span className="mobile-section-title">{title}</span>
    </div>
  );
}
