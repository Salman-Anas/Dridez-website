import React from 'react';

interface StatCardProps {
  title: string;
  value: number | string | null;
  icon: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color = 'var(--accent-blue)', onClick }) => {
  return (
    <div
      className={`stat-card${onClick ? ' stat-card-link' : ''}`}
      style={{ '--card-color': color } as React.CSSProperties}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="stat-header">
        <h3 className="stat-title">{title}</h3>
        <div className="stat-icon">
          {icon}
        </div>
      </div>
      {value === null ? (
        <div className="loading-pulse"></div>
      ) : (
        <p className="stat-value">{value}</p>
      )}
    </div>
  );
};
