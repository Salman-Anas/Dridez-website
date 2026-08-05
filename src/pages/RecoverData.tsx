import React, { useState } from 'react';
import {
  ShieldCheck, Mail, Database, Send, CheckCircle,
  FileText, Lock, AlertCircle, RefreshCw, ArrowRight,
  ShieldAlert, Server
} from 'lucide-react';

export const RecoverData: React.FC = () => {
  const [email, setEmail] = useState('');
  const [targetData, setTargetData] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !targetData.trim() || !deletionReason.trim()) {
      setError('Please fill out all required fields before submitting your recovery request.');
      return;
    }
    setError('');
    setIsSubmitting(true);

    // Simulate safe network submission delay
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 1200);
  };

  const handleReset = () => {
    setEmail('');
    setTargetData('');
    setDeletionReason('');
    setSubmitted(false);
    setError('');
  };

  return (
    <div className="recover-page-container">
      {/* Embedded CSS specific to RecoverData page to keep existing app styling untouched */}
      <style>{`
        .recover-page-container {
          max-width: 1150px;
          margin: 0 auto;
          padding: 0.5rem 0 3rem;
          color: var(--text-primary, #0f172a);
        }
        .recover-hero {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 2.5rem;
          padding: 2.25rem 2.5rem;
          background: linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(124, 58, 237, 0.08) 100%);
          border: 1px solid rgba(79, 70, 229, 0.18);
          border-radius: 20px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 10px 30px -10px rgba(79, 70, 229, 0.1);
        }
        .recover-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: #ffffff;
          padding: 0.35rem 0.85rem;
          border-radius: 30px;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          width: fit-content;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
        }
        .recover-hero h1 {
          font-size: 2.2rem;
          font-weight: 800;
          margin: 0;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #1e1b4b 0%, #4f46e5 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .recover-hero p {
          font-size: 1.05rem;
          color: var(--text-secondary, #64748b);
          line-height: 1.6;
          max-width: 760px;
          margin: 0;
        }
        .recover-grid {
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          gap: 2.25rem;
          align-items: flex-start;
        }
        @media (max-width: 960px) {
          .recover-grid {
            grid-template-columns: 1fr;
          }
        }
        .policy-card, .form-card {
          background: var(--surface-color, #ffffff);
          border: 1px solid var(--border-color, #e2e8f0);
          border-radius: 20px;
          padding: 2.25rem;
          box-shadow: 0 12px 35px -15px rgba(15, 23, 42, 0.08);
          position: relative;
        }
        .section-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.75rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border-color, #e2e8f0);
        }
        .section-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4f46e5;
          background: rgba(79, 70, 229, 0.1);
        }
        .section-title h2 {
          font-size: 1.35rem;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary, #0f172a);
        }
        .section-title p {
          font-size: 0.85rem;
          color: var(--text-secondary, #64748b);
          margin: 0.2rem 0 0;
        }
        .steps-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .step-item {
          display: flex;
          gap: 1.25rem;
          align-items: flex-start;
          padding: 1.25rem;
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid var(--border-color, #f1f5f9);
          border-radius: 14px;
          transition: all 0.2s ease;
        }
        .step-item:hover {
          background: rgba(79, 70, 229, 0.03);
          border-color: rgba(79, 70, 229, 0.2);
          transform: translateX(4px);
        }
        .step-num {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: white;
          font-weight: 800;
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 4px 10px rgba(79, 70, 229, 0.25);
        }
        .step-content h3 {
          margin: 0 0 0.4rem;
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary, #0f172a);
        }
        .step-content p {
          margin: 0;
          font-size: 0.88rem;
          line-height: 1.5;
          color: var(--text-secondary, #64748b);
        }
        .policy-callout {
          margin-top: 1.75rem;
          padding: 1.25rem 1.5rem;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.05) 100%);
          border: 1px solid rgba(16, 185, 129, 0.25);
          border-radius: 14px;
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          color: #065f46;
          font-size: 0.88rem;
          line-height: 1.5;
        }
        .form-group {
          margin-bottom: 1.5rem;
        }
        .form-label {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--text-primary, #0f172a);
          margin-bottom: 0.6rem;
        }
        .form-input, .form-textarea, .form-select {
          width: 100%;
          padding: 0.85rem 1rem;
          border: 1.5px solid var(--border-color, #cbd5e1);
          border-radius: 12px;
          background: var(--surface-color, #ffffff);
          color: var(--text-primary, #0f172a);
          font-size: 0.95rem;
          font-family: inherit;
          transition: all 0.2s ease;
          outline: none;
        }
        .form-input:focus, .form-textarea:focus, .form-select:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
        }
        .form-textarea {
          min-height: 110px;
          resize: vertical;
        }
        .btn-submit {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: all 0.25s ease;
          box-shadow: 0 8px 20px -6px rgba(79, 70, 229, 0.4);
          font-family: inherit;
        }
        .btn-submit:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 25px -5px rgba(79, 70, 229, 0.5);
        }
        .btn-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .error-banner {
          padding: 0.85rem 1.15rem;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 10px;
          color: #dc2626;
          font-size: 0.86rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 1.5rem;
        }
        .success-card {
          padding: 3rem 2rem;
          text-align: center;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(5, 150, 105, 0.1));
          border: 1px solid rgba(16, 185, 129, 0.25);
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
        }
        .success-icon-wrap {
          width: 74px;
          height: 74px;
          border-radius: 50%;
          background: #10b981;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4);
          animation: scaleUp 0.35s ease-out;
        }
        @keyframes scaleUp {
          from { transform: scale(0.6); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .success-title {
          font-size: 1.5rem;
          font-weight: 800;
          color: #065f46;
          margin: 0;
        }
        .success-message {
          font-size: 1.05rem;
          color: var(--text-secondary, #475569);
          line-height: 1.6;
          max-width: 440px;
          margin: 0;
          font-weight: 500;
        }
        .btn-reset {
          margin-top: 0.5rem;
          padding: 0.75rem 1.75rem;
          background: #ffffff;
          border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: 30px;
          color: #059669;
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        .btn-reset:hover {
          background: rgba(16, 185, 129, 0.08);
          transform: translateY(-1px);
        }
      `}</style>

      {/* Hero Header Section */}
      <div className="recover-hero">
        <div className="recover-hero-badge">
          <ShieldCheck size={16} /> Data Recovery Policy & Compliance
        </div>
        <h1>Data Recovery Service</h1>
        <p>
          We value your digital footprint and data rights. If you previously requested account termination, deleted historical trip logs, or accidentally archived transaction data, our secure retention vault enables rapid restoration under strict regulatory compliance.
        </p>
      </div>

      <div className="recover-grid">
        {/* Left Column: Policy and Steps */}
        <div className="policy-card">
          <div className="section-header">
            <div className="section-icon">
              <Database size={24} />
            </div>
            <div className="section-title">
              <h2>Recovery Protocol & Policy</h2>
              <p>Follow our automated data restoration steps</p>
            </div>
          </div>

          <div className="steps-list">
            <div className="step-item">
              <div className="step-num">1</div>
              <div className="step-content">
                <h3>Identity Verification</h3>
                <p>
                  Submit the email address associated with your Rider or Driver profile. Our security protocol checks credentials against encrypted database records to verify lawful account ownership.
                </p>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">2</div>
              <div className="step-content">
                <h3>Specify Targeted Records</h3>
                <p>
                  Indicate whether you require complete account restoration, specific ride histories, past tax invoices, vehicle documents, or wallet rating transcripts.
                </p>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">3</div>
              <div className="step-content">
                <h3>Security & Audit Review</h3>
                <p>
                  Our database specialists will cross-examine your deletion reason against fraud-prevention policies and pull authenticated backup snapshots from cold cloud storage.
                </p>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">4</div>
              <div className="step-content">
                <h3>Account Restoration</h3>
                <p>
                  Once validated, your restored data will be reactivated in real-time across your app profile or securely dispatched to your registered email address within 48 to 72 hours.
                </p>
              </div>
            </div>
          </div>

          <div className="policy-callout">
            <Lock size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>90-Day Retention Window:</strong> In accordance with user consumer protection regulations, anonymized backups of closed accounts and ride histories are preserved in secure vault archives for up to 90 days post-deletion before permanent purging.
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Form or Success Banner */}
        <div className="form-card">
          {submitted ? (
            <div className="success-card">
              <div className="success-icon-wrap">
                <CheckCircle size={40} strokeWidth={2.5} />
              </div>
              <h3 className="success-title">Request Submitted</h3>
              <p className="success-message">
                <strong>You will be contacted soon!</strong>
                <br /><br />
                Our data compliance engineering team has received your recovery ticket and initiated secure vault extraction for your email (<strong>{email}</strong>).
              </p>
              <button className="btn-reset" onClick={handleReset}>
                <RefreshCw size={15} /> Submit Another Request
              </button>
            </div>
          ) : (
            <>
              <div className="section-header">
                <div className="section-icon" style={{ color: '#7c3aed', background: 'rgba(124, 58, 237, 0.1)' }}>
                  <Send size={22} />
                </div>
                <div className="section-title">
                  <h2>Data Recovery Form</h2>
                  <p>Submit your details to re-initialize lost records</p>
                </div>
              </div>

              {error && (
                <div className="error-banner">
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label className="form-label">
                    <Mail size={16} style={{ color: '#4f46e5' }} /> Registered Email Address
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="e.g., alex.johnson@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <Server size={16} style={{ color: '#4f46e5' }} /> Data You Want To Recover
                  </label>
                  <select
                    className="form-select"
                    value={targetData}
                    onChange={(e) => setTargetData(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select the category of records to restore...</option>
                    <option value="Full Account & Profile Restoration">Full Account & Profile Restoration</option>
                    <option value="Complete Ride & Trip History">Complete Ride & Trip History</option>
                    <option value="Wallet, Earnings & Transaction Records">Wallet, Earnings & Transaction Records</option>
                    <option value="Driver License & Vehicle Verification Documents">Driver License & Vehicle Verification Documents</option>
                    <option value="Custom / Specific Archive Logs">Custom / Specific Archive Logs (See Reason below)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <FileText size={16} style={{ color: '#4f46e5' }} /> Reason Why It Was Deleted
                  </label>
                  <textarea
                    className="form-textarea"
                    placeholder="Please describe why the account or records were deleted initially (e.g., accidental account deletion, switching phone devices, previous privacy request, or app re-installation)..."
                    value={deletionReason}
                    onChange={(e) => setDeletionReason(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="btn-submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spin" /> Synchronizing Recovery Ticket...
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={18} /> Submit Recovery Request <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
