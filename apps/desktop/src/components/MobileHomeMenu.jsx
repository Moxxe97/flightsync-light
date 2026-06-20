// src/components/MobileHomeMenu.jsx
export default function MobileHomeMenu({ sections, onSelect }) {
  return (
    <nav className="mobile-menu" aria-label="Sections">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className="mobile-menu-item"
          onClick={() => onSelect(s.id)}
        >
          <span className="mobile-menu-icon"><s.icon /></span>
          <span className="mobile-menu-text">
            <span className="mobile-menu-label">{s.label}</span>
            {s.subtitle && <span className="mobile-menu-sub">{s.subtitle}</span>}
          </span>
          <span className="mobile-menu-chevron" aria-hidden="true">&#8250;</span>
        </button>
      ))}
    </nav>
  );
}
