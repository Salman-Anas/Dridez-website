import React from 'react';

interface StatCardProps {
  title: string;
  value: number | string | null;
  icon: React.ReactNode;
  color?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color = 'var(--accent-blue)' }) => {
  return (
    <div className="stat-card" style={{ '--card-color': color } as React.CSSProperties}>
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
