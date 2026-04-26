import React, { useState } from 'react';
import { X, Shield, CheckCircle, XCircle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { AutocompleteSelect } from './AutocompleteSelect';
import { WriteButton } from './WriteButton';
import { isApiConfigured, postCreateClaim } from '../../lib/api';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../contexts/AuthContext';
import type { Claim } from '../../lib/types';
import { ProcessingOverlay } from './ProcessingOverlay';

interface Props {
  onClose: () => void;
  onCreated: (claimId: string) => void;
  // Phase 2C — optimistic create
  addOptimisticClaim?: (claim: Claim) => void;
  removeOptimisticClaim?: (tempClaimId: string) => void;
}

const COVERAGE_OPTIONS = [
  'Full Replacement Coverage',
  'Full Replacement Coverage with $300 Deductible',
  'Standard Valuation Coverage',
];

const CLAIM_TYPES = ['Item Claim', 'Property Claim'] as const;

export function CreateClaimModal({ onClose, onCreated, addOptimisticClaim, removeOptimisticClaim }: Props) {
  const hasApi = isApiConfigured();
  const { apiClients } = useClients();
  const { user } = useAuth();
  const isClient = user?.role === 'client';

  const [claimType, setClaimType] = useState<'Item Claim' | 'Property Claim'>('Item Claim');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [companyClientName, setCompanyClientName] = useState(isClient && user?.clientName ? user.clientName : '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [coverageType, setCoverageType] = useState('');
  const [propertyIncidentReference, setPropertyIncidentReference] = useState('');

  const [isOtherClient, setIsOtherClient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-fill contact from client selection
  // Client users see only their own client; staff/admin see all
  const clientOptions = isClient && user?.clientName
    ? [user.clientName]
    : apiClients.map(c => c.name).sort();

  function handleClientSelect(name: string) {
    if (name === '__other__') {
      setIsOtherClient(true);
      setCompanyClientName('');
      return;
    }
    setIsOtherClient(false);
    setCompanyClientName(name);
    const match = apiClients.find(c => c.name === name);
    if (match) {
      if (match.contactName && !primaryContactName) setPrimaryContactName(match.contactName);
      if (match.email && !email) setEmail(match.email);
      if (match.phone && !phone) setPhone(match.phone);
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!issueDescription.trim()) { setError('Issue description is required'); return; }
    if (!companyClientName.trim()) { setError('Client name is required'); return; }

    if (!hasApi) {
      // Demo mode — simulate success
      setSuccess('CLM-DEMO-001 created (demo mode)');
      setTimeout(() => onCreated('CLM-DEMO-001'), 1000);
      return;
    }

    setLoading(true);
    setError(null);

    const idempotencyKey = crypto.randomUUID();

    // Phase 2C: optimistic create — temp claim appears instantly in the list
    const tempClaimId = `TEMP-${idempotencyKey.slice(0, 8)}`;
    const todayIso = new Date().toISOString().slice(0, 10);
    const optimisticClaim: Claim = {
      claimId: tempClaimId,
      claimType,
      status: 'Under Review',
      dateOpened: todayIso,
      primaryContactName: primaryContactName.trim() || undefined,
      companyClientName: companyClientName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      incidentDate: incidentDate || undefined,
      incidentLocation: incidentLocation.trim() || undefined,
      issueDescription: issueDescription.trim(),
      requestedAmount: requestedAmount ? parseFloat(requestedAmount) : undefined,
      coverageType: coverageType || undefined,
      propertyIncidentReference: propertyIncidentReference.trim() || undefined,
      createdBy: user?.email || undefined,
    };
    addOptimisticClaim?.(optimisticClaim);

    const res = await postCreateClaim({
      idempotencyKey,
      claimType,
      primaryContactName: primaryContactName.trim(),
      companyClientName: companyClientName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      incidentDate: incidentDate || undefined,
      incidentLocation: incidentLocation.trim() || undefined,
      issueDescription: issueDescription.trim(),
      requestedAmount: requestedAmount ? parseFloat(requestedAmount) : undefined,
      coverageType: coverageType || undefined,
      propertyIncidentReference: propertyIncidentReference.trim() || undefined,
    });

    setLoading(false);

    if (res.ok && res.data) {
      setSuccess(`${res.data.claimId} created — Drive folder ready`);
      // Remove optimistic placeholder — real claim will arrive via refetch in onCreated
      removeOptimisticClaim?.(tempClaimId);
      setTimeout(() => onCreated(res.data!.claimId), 1200);
    } else {
      removeOptimisticClaim?.(tempClaimId); // rollback
      setError(res.error || 'Failed to create claim');
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: `1px solid ${theme.colors.border}`, borderRadius: 8,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 500, color: theme.colors.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: 4,
  };

  return (
    <>
      <div onClick={loading ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 150 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 580, maxWidth: '95vw', maxHeight: '90vh',
        background: '#fff', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        zIndex: 160, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={loading}
          message="Hold tight — filing your claim"
          subMessage="Creating the claim record and Drive folder. Almost there."
        />
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.colors.orangeLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={15} color={theme.colors.orange} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>New Claim</div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted }}>Creates claim record + Drive folder</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Claim Type toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Claim Type *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {CLAIM_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setClaimType(t)} style={{
                  flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: claimType === t ? 600 : 400,
                  border: `1px solid ${claimType === t ? theme.colors.orange : theme.colors.border}`,
                  borderRadius: 8, background: claimType === t ? theme.colors.orangeLight : '#fff',
                  color: claimType === t ? theme.colors.orange : theme.colors.textSecondary,
                  cursor: 'pointer', transition: 'all 0.1s',
                }}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: theme.colors.textMuted }}>
              {claimType === 'Item Claim'
                ? 'Item Claim: damage or loss involving stored inventory items'
                : 'Property Claim: damage to a customer\'s property during delivery or service'}
            </div>
          </div>

          {/* Client info */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Company / Client Name *</label>
            {clientOptions.length > 0 && !isOtherClient ? (
              <AutocompleteSelect
                value={companyClientName}
                onChange={handleClientSelect}
                placeholder="— Select client —"
                options={[...clientOptions.map(name => ({ value: name, label: name })), { value: '__other__', label: 'Other / Not in list' }]}
                style={{ width: '100%' }}
              />
            ) : (
              <div>
                <input
                  value={companyClientName}
                  onChange={e => setCompanyClientName(e.target.value)}
                  placeholder="Enter company / client name"
                  style={inputStyle}
                  autoFocus={isOtherClient}
                />
                {isOtherClient && clientOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setIsOtherClient(false); setCompanyClientName(''); }}
                    style={{ marginTop: 4, fontSize: 11, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                  >
                    ← Back to client list
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Primary Contact Name</label>
              <input value={primaryContactName} onChange={e => setPrimaryContactName(e.target.value)} placeholder="Contact person" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number" style={inputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="claimant@email.com" style={inputStyle} />
          </div>

          {/* Incident info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Incident Date</label>
              <input value={incidentDate} onChange={e => setIncidentDate(e.target.value)} type="date" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Requested Amount ($)</label>
              <input value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" style={inputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              {claimType === 'Item Claim' ? 'Property / Item Reference' : 'Property / Incident Reference'}
            </label>
            <input
              value={propertyIncidentReference}
              onChange={e => setPropertyIncidentReference(e.target.value)}
              placeholder={claimType === 'Item Claim' ? 'Item ID(s), shipment #, etc.' : 'Address, property description, etc.'}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Incident Location</label>
            <input value={incidentLocation} onChange={e => setIncidentLocation(e.target.value)} placeholder="Warehouse location, address, etc." style={inputStyle} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Coverage Type</label>
            <select value={coverageType} onChange={e => setCoverageType(e.target.value)} style={inputStyle}>
              <option value="">— Not specified —</option>
              {COVERAGE_OPTIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Issue Description *</label>
            <textarea
              value={issueDescription}
              onChange={e => setIssueDescription(e.target.value)}
              rows={4}
              placeholder="Describe the incident, damage, or loss in detail..."
              style={{ ...inputStyle, resize: 'vertical' }}
              required
            />
          </div>
        </form>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          {success && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#15803D', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
              <CheckCircle size={13} /> {success}
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
              <XCircle size={13} /> {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}>
              Cancel
            </button>
            <WriteButton
              label={loading ? 'Creating...' : 'Create Claim'}
              icon={<Shield size={14} />}
              onClick={handleSubmit}
              disabled={loading || !issueDescription.trim() || !companyClientName.trim()}
            />
          </div>
          {!hasApi && (
            <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', marginTop: 6 }}>Demo mode — connect API in Settings to create real claims</div>
          )}
        </div>
      </div>
    </>
  );
}
