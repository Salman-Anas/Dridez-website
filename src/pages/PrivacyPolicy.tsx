import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Navigation, Lock, UserCheck, FileText, Database,
  Trash2, Car, User, Search, X, Printer, ArrowLeft,
  CheckCircle2, AlertTriangle, Eye, RefreshCw, Share2, Mail
} from 'lucide-react';
import './PrivacyPolicy.css';

interface PolicySection {
  id: string;
  title: string;
  category: 'location' | 'collection' | 'sharing' | 'rights' | 'security' | 'general';
  audience: 'all' | 'rider' | 'driver' | 'critical';
  icon: React.ReactNode;
  content: React.ReactNode;
}

export const PrivacyPolicy: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');

  // Print policy function for user / regulatory archival
  const handlePrint = () => {
    window.print();
  };

  const sections: PolicySection[] = useMemo(() => [
    {
      id: 'mandatory-location',
      title: 'Mandatory GPS & Background Location Disclosure',
      category: 'location',
      audience: 'critical',
      icon: <Navigation size={24} />,
      content: (
        <>
          <p>
            As a mobile transportation platform connecting Drivers and Riders in real-time, <strong>Dridez</strong> requires explicit access to device GPS and location telemetry. This disclosure explains precisely how, when, and why location data is harvested across our applications in full compliance with Google Play Data Safety and Apple App Store guidelines.
          </p>
          <div className="info-box info-box-warning">
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={20} /> Driver Background Location Tracking
            </h4>
            <p style={{ margin: 0 }}>
              When a Driver toggles their status to <strong>&ldquo;Online / On-Duty&rdquo;</strong> within the Dridez Driver app, we collect background GPS location coordinates even when the app is running in the background, minimized, or when the screen is locked. 
              <br /><br />
              <strong>Why is background location required?</strong> This enables our automated matching engine to continuously route nearby ride requests to active drivers, calculate dynamic fares, generate accurate trip routing graphs, and monitor live journey safety. Background location collection terminates immediately when the Driver toggles their status to <strong>&ldquo;Offline / Off-Duty&rdquo;</strong> or completely exits the application session.
            </p>
          </div>
          <h4>Rider Foreground Location Tracking</h4>
          <p>
            For Riders, Dridez collects GPS location data only when the app is running in the foreground (open and active on screen) during ride request formation, pick-up coordination, and active transit. We do not track Rider location in the background once the trip concludes or the application is closed.
          </p>
          <h4>How to Revoke Location Access</h4>
          <p>
            Both Drivers and Riders can restrict location permissions at any time via their device system settings (e.g., <code>Settings &gt; Privacy &gt; Location Services &gt; Dridez</code>). Please note that revoking GPS access will render core functions—such as booking rides, accepting dispatch requests, and automatic fare computation—inoperable.
          </p>
        </>
      ),
    },
    {
      id: 'info-we-collect',
      title: '1. Information We Collect',
      category: 'collection',
      audience: 'all',
      icon: <Database size={24} />,
      content: (
        <>
          <p>
            To provide safe, reliable, and efficient ride-hailing services, Dridez collects various classifications of information directly from you, through automated mobile telemetry, and from vetted trusted third-party partners.
          </p>
          <h4>A. Personal Information You Provide Directly</h4>
          <ul>
            <li><strong>Account Profile &amp; Registration:</strong> Full name, verified mobile phone number, email address, physical address, profile photographs, and password credentials.</li>
            <li><strong>Financial &amp; Billing Records:</strong> Credit/debit card tokens, mobile wallet identifiers, and payout bank account details (collected and processed via certified PCI-DSS compliant third-party payment gateways).</li>
            <li><strong>Communication Logs:</strong> Customer support tickets, in-app messaging transcripts between Driver and Rider, emergency incident reports, and feedback ratings.</li>
          </ul>
          <div className="info-box info-box-blue">
            <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e3a8a' }}>
              <Car size={20} /> Additional Data Collected from Drivers Only
            </h4>
            <p style={{ margin: 0, fontSize: '0.925rem' }}>
              To ensure platform safety and regulatory compliance, individuals registering as Dridez Drivers must submit verified governmental identification, valid driver&rsquo;s licenses, commercial transit insurance policies, vehicle registration certifications, high-resolution vehicle inspection photographs, and tax identification numbers. Where permitted or legally mandated, we conduct recurring background checks and motor vehicle driving record verifications through accredited licensing authorities.
            </p>
          </div>
          <h4>B. Automated Telemetry &amp; Diagnostic Data</h4>
          <ul>
            <li><strong>Device Specifications:</strong> Hardware model, operating system version, unique device identifiers (UUID, IMEI, advertising IDs), mobile network statistics, screen dimensions, and app language preferences.</li>
            <li><strong>Trip Metrics &amp; Telematics:</strong> Accelerometer data, gyroscopic vectors, braking deceleration patterns, route vectors, and speed variations during active journeys to detect severe vehicular crash events and enforce safe driving standards.</li>
            <li><strong>Connection &amp; Usage Logs:</strong> IP address, timestamped login histories, features accessed, ride booking frequencies, and interaction durations within the app interface.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'how-we-use-data',
      title: '2. How We Use Your Information',
      category: 'collection',
      audience: 'all',
      icon: <FileText size={24} />,
      content: (
        <>
          <p>
            Dridez processes personal identifiable information (PII) exclusively for legitimate operational imperatives, safety enhancements, automated transactional execution, and platform optimization.
          </p>
          <h4>Core Service Fulfillment</h4>
          <ul>
            <li><strong>Ride Pairing &amp; Dispatch:</strong> Utilizing location matrices to match waiting Riders with optimal, nearby available Drivers in real-time.</li>
            <li><strong>Fare Computation &amp; Financial Clearing:</strong> Generating dynamic upfront pricing, processing card billing, computing driver commissions, executing rapid electronic bank deposits, and generating downloadable PDF tax invoices.</li>
            <li><strong>Navigation &amp; Mapping Integration:</strong> Translating origin and destination input into optimized TURN-by-TURN GPS guidance powered by Google Maps Platform APIs.</li>
          </ul>
          <h4>Safety &amp; Fraud Mitigation</h4>
          <ul>
            <li><strong>24/7 Incident Surveillance:</strong> Enabling live trip sharing with emergency contacts and powering the in-app &ldquo;SOS Panic Button&rdquo; connected to rapid law enforcement dispatch.</li>
            <li><strong>Identity Verification:</strong> Performing periodic facial recognition and biometric identity verification challenges on active Drivers before shift initialization to prevent unauthorized driver substitutions.</li>
            <li><strong>Anti-Fraud Screening:</strong> Auditing transaction anomalies, credit card testing attempts, GPS location spoofing, and artificial ride farming to safeguard ecosystem stability.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'data-sharing-disclosure',
      title: '3. Data Sharing & Third-Party Disclosure',
      category: 'sharing',
      audience: 'all',
      icon: <Share2 size={24} />,
      content: (
        <>
          <p>
            Dridez operates on a principles of strict necessity. We <strong>never sell, rent, or lease your personal identification information to data brokers or third-party marketing networks</strong>. Data sharing only occurs under the operational workflows detailed below.
          </p>
          <h4>A. Real-Time Sharing Between Riders and Drivers</h4>
          <p>
            When a ride agreement is formed, crucial identifying data is shared to facilitate seamless meeting and safety verification:
          </p>
          <ul>
            <li><strong>Shared with Driver:</strong> Rider&rsquo;s first name, overall community star rating, specified pick-up geographical waypoint, destination landmark, and encrypted in-app communication channels (we use telephone number masking so personal phone numbers remain confidential).</li>
            <li><strong>Shared with Rider:</strong> Driver&rsquo;s full name, portrait photo, verified community star rating, vehicle make/model/color, official license plate registration number, current geographical coordinates on a moving map, and estimated time of arrival (ETA).</li>
          </ul>
          <h4>B. Trusted Infrastructure Providers &amp; Vendors</h4>
          <p>
            We engage industry-leading technology vendors bound by rigorous Data Processing Agreements (DPAs) to assist in operating our infrastructure:
          </p>
          <ul>
            <li><strong>Cloud Storage &amp; Backend Platforms:</strong> Google Cloud &amp; Firebase Architecture for encrypted real-time database syncing, secure authentication tokens, and disaster recovery replication.</li>
            <li><strong>Mapping &amp; Navigation Providers:</strong> Google Maps Platform to process spatial geodatabasing, reverse geocoding, and routing distance computations.</li>
            <li><strong>Payment Processors:</strong> Stripe and institutional banking aggregators to handle secure PCI-compliant credit card clearance, refunds, and instant Driver payout remittances.</li>
            <li><strong>Communication Services:</strong> SMS and push notification gateways (e.g., Twilio / Firebase Cloud Messaging) to dispatch OTP verification codes and live ride status updates.</li>
          </ul>
          <h4>C. Statutory Legal &amp; Emergency Compliance</h4>
          <p>
            Dridez reserves the right to disclose personal data when legally compelled by a valid judicial court order, criminal warrant, subpoena, or administrative summons, or when imminent human physical danger requires immediate cooperation with municipal fire, medical, or law enforcement responders.
          </p>
        </>
      ),
    },
    {
      id: 'account-deletion',
      title: '4. Data Retention & Account Deletion Rights',
      category: 'rights',
      audience: 'all',
      icon: <Trash2 size={24} />,
      content: (
        <>
          <p>
            We retain your profile credentials and activity logs only for as long as your Dridez account remains active or as necessitated by national statutory municipal transit, insurance, and municipal taxation compliance frameworks (typically 5 to 7 years for financial and ride logs).
          </p>
          <h4>Your Mandatory Right to Account Deletion</h4>
          <p>
            In alignment with Google Play Store &ldquo;Data Safety&rdquo; and Apple Privacy standards, both Drivers and Riders possess the unconditional right to request full account erasure and permanent personal data removal directly from our systems.
          </p>
          <div className="delete-steps">
            <div className="delete-step-card">
              <div className="step-number">1</div>
              <div className="step-text">
                <h5>Open App Account Settings</h5>
                <p>Launch the Dridez Rider or Dridez Driver application on your mobile smartphone and tap your profile avatar in the upper right corner.</p>
              </div>
            </div>
            <div className="delete-step-card">
              <div className="step-number">2</div>
              <div className="step-text">
                <h5>Navigate to Privacy &amp; Security</h5>
                <p>Select <strong>Settings &gt; Privacy &amp; Data &gt; Manage Account</strong> from the configuration menu.</p>
              </div>
            </div>
            <div className="delete-step-card">
              <div className="step-number">3</div>
              <div className="step-text">
                <h5>Confirm Deletion Request</h5>
                <p>Tap <strong>&ldquo;Delete My Account&rdquo;</strong>, authenticate your identity via OTP or password, and select confirm. Your profile immediately switches to deactivated status.</p>
              </div>
            </div>
          </div>
          <p>
            Alternatively, if you no longer possess the app or cannot access your phone, you can initiate immediate data erasure by emailing our Data Protection team at <strong>privacy@dridez.com</strong> with the subject line <em>&ldquo;Account Deletion Request - [Your Phone Number]&rdquo;</em>.
          </p>
          <p>
            <em>Note on Exception Protocols:</em> Upon confirming account deletion, we purge all marketing identities, profile photos, custom addresses, and saved favorite spots within 30 days. However, immutable anonymized ledger records of completed rides and tax-related transaction receipts are archived in cold, non-public storage to fulfill non-negotiable legal audit obligations.
          </p>
        </>
      ),
    },
    {
      id: 'security-measures',
      title: '5. Security Measures & Technical Safeguards',
      category: 'security',
      audience: 'all',
      icon: <Lock size={24} />,
      content: (
        <>
          <p>
            Dridez treats the preservation of user cybersecurity as an existential necessity. We maintain comprehensive multi-layered defense frameworks to shield user PII against unauthorized infiltration, interception, or exfiltration.
          </p>
          <ul>
            <li><strong>In-Transit Encryption:</strong> All client-to-server and inter-service network packets are encrypted utilizing modern TLS 1.3 cryptographic protocols. Zero plaintext data is permitted across open radio or cellular networks.</li>
            <li><strong>At-Rest Encryption:</strong> Database repositories, document archives containing driver licenses, and system logs are fully encrypted on disk using AES-256 cipher standardizations.</li>
            <li><strong>Zero-Knowledge Password Vaulting:</strong> User authentication passwords are hashed using salted cryptographic PBKDF2 / bcrypt hashing functions; Dridez personnel cannot read or decrypt your credentials.</li>
            <li><strong>Principle of Least Privilege:</strong> Internal access to user database indices is rigorously walled behind role-based multi-factor authentication (MFA) and audited by automated intrusion detection algorithms.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'childrens-privacy',
      title: '6. Children & Minors Policy',
      category: 'general',
      audience: 'all',
      icon: <UserCheck size={24} />,
      content: (
        <>
          <p>
            The Dridez platform is strictly designed for adults aged <strong>18 years or older</strong>. We do not knowingly solicit, collect, or retain personally identifying data from unattended minors under the age of 18.
          </p>
          <p>
            Individuals under 18 years of age are expressly restricted from holding an individual Dridez account or utilizing our transportation services unaccompanied by a parent or legal guardian. If a Driver arrives at a pickup waypoint and discovers an unaccompanied minor attempting to travel solo, the Driver is instructed under platform guidelines to reject the journey immediately. If we discover that an underage account has been created, we will permanently terminate the profile and erase associated database records without delay.
          </p>
        </>
      ),
    },
    {
      id: 'international-transfers',
      title: '7. Policy Updates & Modifications',
      category: 'general',
      audience: 'all',
      icon: <RefreshCw size={24} />,
      content: (
        <>
          <p>
            As automotive transportation technology, regional regulatory ordinances, and our mobile applications evolve, we reserve the right to periodically refine and update this Privacy Policy.
          </p>
          <p>
            When material changes occur that substantially alter how your personal or location data is processed, we will proactively deliver a comprehensive notification via an prominent in-app prompt, push banner, or registered email address at least <strong>14 days prior to implementation</strong>. The &ldquo;Effective Date&rdquo; date stamp displayed at the top of this document represents the latest active revision. Continued access or usage of Dridez apps after the effective date constitutes acknowledgment and acceptance of the refreshed terms.
          </p>
        </>
      ),
    },
    {
      id: 'contact-dpo',
      title: '8. Contact Our Data Protection Officer (DPO)',
      category: 'general',
      audience: 'all',
      icon: <Mail size={24} />,
      content: (
        <>
          <p>
            We welcome your scrutiny and inquiries regarding our data handling protocols. If you harbor questions, require clarification on background location tracking, wish to challenge an algorithmic matching decision, or desire to formalize an external privacy concern, please contact our dedicated legal and compliance division:
          </p>
          <div className="info-box" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>Dridez Technologies Ltd. — Data Privacy Office</strong></p>
            <p style={{ margin: '0 0 0.25rem 0' }}>📧 <strong>Primary Legal Contact:</strong> <a href="mailto:privacy@dridez.com" style={{ color: '#4f46e5' }}>privacy@dridez.com</a></p>
            <p style={{ margin: '0 0 0.25rem 0' }}>🎧 <strong>Customer Support Desk:</strong> <a href="mailto:support@dridez.com" style={{ color: '#4f46e5' }}>support@dridez.com</a></p>
            <p style={{ margin: 0 }}>📍 <strong>Corporate Compliance HQ:</strong> Innovation Park, Suite 402, Mobility Blvd, Global Tech District</p>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Our compliance engineers and privacy mediators pledge to review and respond to formal data rights requests within <strong>15 working business days</strong> from Initial receipt.
          </p>
        </>
      ),
    },
  ], []);

  // Filter sections based on keyword search and selected tab
  const filteredSections = useMemo(() => {
    return sections.filter((section) => {
      const matchesTab = activeTab === 'all' ? true : section.category === activeTab;
      const matchesSearch = searchQuery.trim() === '' ? true : (
        section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        // Check standard keyword hits
        searchQuery.toLowerCase().split(' ').some(kw => 
          section.title.toLowerCase().includes(kw) || 
          section.id.toLowerCase().includes(kw)
        )
      );
      return matchesTab && matchesSearch;
    });
  }, [sections, activeTab, searchQuery]);

  const getAudienceBadge = (audience: string) => {
    switch (audience) {
      case 'rider':
        return <span className="audience-badge badge-rider"><User size={12} /> Riders Only</span>;
      case 'driver':
        return <span className="audience-badge badge-driver"><Car size={12} /> Drivers Only</span>;
      case 'critical':
        return <span className="audience-badge badge-critical"><AlertTriangle size={12} /> Mandatory Disclosure</span>;
      case 'all':
      default:
        return <span className="audience-badge badge-all"><CheckCircle2 size={12} /> Riders &amp; Drivers</span>;
    }
  };

  return (
    <div className="privacy-page-wrapper">
      {/* Top Glassmorphic Navigation */}
      <header className="privacy-navbar">
        <Link to="/" className="privacy-nav-brand">
          <div className="privacy-nav-logo">
            <ShieldCheck size={24} />
          </div>
          <div className="privacy-brand-text">
            Dridez <span>Privacy</span>
          </div>
        </Link>
        
        <div className="privacy-nav-actions">
          <button onClick={handlePrint} className="privacy-btn privacy-btn-secondary" title="Print or save as PDF">
            <Printer size={16} />
            <span>Print Policy</span>
          </button>
          <Link to="/" className="privacy-btn privacy-btn-primary">
            <ArrowLeft size={16} />
            <span>Back to Portal</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="privacy-container">
        {/* Hero Banner */}
        <section className="privacy-hero">
          <div className="privacy-badge">
            <ShieldCheck size={14} />
            <span>App Store &amp; Play Store Compliant</span>
          </div>
          <h1 className="privacy-title">Privacy Policy &amp; Data Transparency</h1>
          <p className="privacy-subtitle">
            We built <strong>Dridez</strong> to connect Drivers and Riders with seamless transparency. Learn precisely how we safeguard your personal information, handle location telemetrics, and honor your absolute right to data autonomy.
          </p>

          <div className="privacy-meta">
            <div className="privacy-meta-item">
              <span>Effective Date:</span> <strong>August 5, 2026</strong>
            </div>
            <div className="privacy-meta-item">
              <span>Applies To:</span> <strong>Dridez Driver &amp; Rider Apps</strong>
            </div>
            <div className="privacy-meta-item">
              <span>Compliance:</span> <strong>Play Store / iOS Data Safety</strong>
            </div>
          </div>
        </section>

        {/* Quick Value Highlights Grid */}
        <section className="privacy-highlights-grid">
          <div className="privacy-highlight-card">
            <div className="highlight-icon" style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
              <Navigation size={24} />
            </div>
            <div>
              <div className="highlight-title">Transparent Location</div>
              <p className="highlight-desc">Background GPS is harvested solely when Drivers go Online to match nearby ride dispatches.</p>
            </div>
          </div>

          <div className="privacy-highlight-card">
            <div className="highlight-icon" style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}>
              <Lock size={24} />
            </div>
            <div>
              <div className="highlight-title">End-to-End Encryption</div>
              <p className="highlight-desc">All live client-server communication and sensitive payment cards are secured with TLS 1.3 and AES-256 ciphers.</p>
            </div>
          </div>

          <div className="privacy-highlight-card">
            <div className="highlight-icon" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
              <Trash2 size={24} />
            </div>
            <div>
              <div className="highlight-title">One-Click Deletion</div>
              <p className="highlight-desc">Drivers and Riders can trigger instant account erasure directly inside app profile privacy settings.</p>
            </div>
          </div>

          <div className="privacy-highlight-card">
            <div className="highlight-icon" style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)' }}>
              <UserCheck size={24} />
            </div>
            <div>
              <div className="highlight-title">Zero Data Selling</div>
              <p className="highlight-desc">We never trade, rent, or commercialize user contact numbers or trip records to third-party data brokers.</p>
            </div>
          </div>
        </section>

        {/* Filter & Search Bar Panel */}
        <section className="privacy-controls-panel">
          <div className="privacy-search-wrapper">
            <Search className="privacy-search-icon" size={18} />
            <input
              type="text"
              className="privacy-search-input"
              placeholder="Search policy topics (e.g. location, delete, card, driver, retention)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="privacy-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <X size={18} />
              </button>
            )}
          </div>

          <div className="privacy-category-tabs">
            <button
              className={`privacy-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <Eye size={14} />
              All Sections ({sections.length})
            </button>
            <button
              className={`privacy-tab ${activeTab === 'location' ? 'active' : ''}`}
              onClick={() => setActiveTab('location')}
            >
              <Navigation size={14} />
              Location &amp; Tracking
            </button>
            <button
              className={`privacy-tab ${activeTab === 'collection' ? 'active' : ''}`}
              onClick={() => setActiveTab('collection')}
            >
              <Database size={14} />
              Data Collection
            </button>
            <button
              className={`privacy-tab ${activeTab === 'sharing' ? 'active' : ''}`}
              onClick={() => setActiveTab('sharing')}
            >
              <Share2 size={14} />
              Sharing &amp; Vendors
            </button>
            <button
              className={`privacy-tab ${activeTab === 'rights' ? 'active' : ''}`}
              onClick={() => setActiveTab('rights')}
            >
              <Trash2 size={14} />
              Account Deletion
            </button>
            <button
              className={`privacy-tab ${activeTab === 'security' ? 'active' : ''}`}
              onClick={() => setActiveTab('security')}
            >
              <Lock size={14} />
              Security &amp; Encryption
            </button>
          </div>
        </section>

        {/* Policy Sections List */}
        <section className="privacy-sections-list">
          {filteredSections.length > 0 ? (
            filteredSections.map((sec) => {
              const isCritical = sec.audience === 'critical';
              return (
                <article
                  key={sec.id}
                  id={sec.id}
                  className={`privacy-section-card ${isCritical ? 'critical-notice' : ''}`}
                >
                  <div className="section-header">
                    <div className="section-title-wrapper">
                      <div className="section-icon-badge">
                        {sec.icon}
                      </div>
                      <h3 className="section-title">{sec.title}</h3>
                    </div>
                    <div>
                      {getAudienceBadge(sec.audience)}
                    </div>
                  </div>
                  <div className="section-body">
                    {sec.content}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="privacy-empty">
              <Search size={48} style={{ opacity: 0.4, margin: '0 auto 1rem auto' }} />
              <h3>No Policy Sections Matched Your Filter</h3>
              <p>Try searching for different keywords or clicking &ldquo;All Sections&rdquo; to reset the category filter.</p>
              <button
                className="privacy-btn privacy-btn-secondary"
                style={{ marginTop: '1rem' }}
                onClick={() => {
                  setSearchQuery('');
                  setActiveTab('all');
                }}
              >
                Reset Filters
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="privacy-footer">
        <div className="privacy-footer-links">
          <Link to="/" className="privacy-footer-link">Admin Portal</Link>
          <a href="mailto:support@dridez.com" className="privacy-footer-link">Driver Support</a>
          <a href="mailto:support@dridez.com" className="privacy-footer-link">Rider Help Center</a>
          <a href="mailto:privacy@dridez.com" className="privacy-footer-link">DPO Inquiries</a>
        </div>
        <p>&copy; {new Date().getFullYear()} Dridez Technologies Ltd. All rights reserved. Designed for Driver &amp; Rider Trust.</p>
      </footer>
    </div>
  );
};

export default PrivacyPolicy;
