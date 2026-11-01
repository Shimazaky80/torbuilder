import { useState } from 'react';
import { UserCog, X, Copy } from 'lucide-react';
import {
  guideMemberName,
  guideUpliftPercent,
  guideMembersByDestination,
  guideMemberSupplierName,
  priceGuideLine
} from '../lib/guideRoster';

/* Who was paid to guide this line.

   The charge itself never changes shape: it is the destination's flat per-trip
   figure for the service types already picked on this line. The person only adds
   their own uplift, and picking them here is what puts a name, an ID number and
   an amount on the saved line for accounts and tax.

   Guides are grouped by destination rather than filtered to it — the operator
   sometimes brings a senior guide in from elsewhere, and an empty picker would
   be a worse answer than a long one. */
const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PersonRow = ({ member, isSelected, onSelect, baseCharge, currency }) => {
  const percent = guideUpliftPercent(member);
  const where = member?.destination_area || member?.city || '';
  const via = guideMemberSupplierName(member);
  const charged = priceGuideLine({ baseCharge, member, supplierName: via }).charged;
  return (
    <label className={`guide-person-row ${isSelected ? 'selected' : ''}`}>
      <input
        type="radio"
        name="guide-person"
        checked={isSelected}
        onChange={() => onSelect(member.id)}
      />
      <span className="guide-person-id">
        <strong>{guideMemberName(member) || 'Unnamed guide'}</strong>
        <small>
          {[where, via].filter(Boolean).join(' · ') || 'No destination or supplier recorded'}
        </small>
      </span>
      <span className="guide-person-rate">
        <strong>{money(charged, currency)}</strong>
        <small>{percent > 0 ? `standard ${money(baseCharge, currency)} +${percent}%` : 'standard rate'}</small>
      </span>
    </label>
  );
};

const GuidePersonGroup = ({ title, list, selectedId, onSelect, baseCharge, currency }) => {
  if (!list.length) return null;
  return (
    <>
      <p className="guide-person-group-title">{title}</p>
      {list.map((member) => (
        <PersonRow
          key={member.id}
          member={member}
          isSelected={selectedId === member.id}
          onSelect={onSelect}
          baseCharge={baseCharge}
          currency={currency}
        />
      ))}
    </>
  );
};

export default function GuidePersonModal({
  lineName = '',
  baseCharge = 0,
  currency = 'ZAR',
  members = [],
  destination = '',
  currentMemberId = '',
  guideLineCount = 1,
  onConfirm,
  onCancel
}) {
  const [memberId, setMemberId] = useState(currentMemberId || '');
  const grouped = guideMembersByDestination(members, destination);

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal">
        <div className="modal-header">
          <div>
            <h2>Who is guiding?</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {lineName || 'This guide line'} — the charge is the destination&rsquo;s rate for
              the service types already on the line. The person adds only their uplift.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div className="service-guide-type-list guide-person-list">
          <label className={`guide-person-row ${memberId === '' ? 'selected' : ''}`}>
            <input type="radio" name="guide-person" checked={memberId === ''} onChange={() => setMemberId('')} />
            <span className="guide-person-id">
              <strong>No one named</strong>
              <small>The standard destination rate, with nobody recorded on the line</small>
            </span>
            <span className="guide-person-rate">
              <strong>{money(baseCharge, currency)}</strong>
              <small>standard rate</small>
            </span>
          </label>

          <GuidePersonGroup
            title={destination ? `Guides for ${destination}` : 'Guides'}
            list={grouped.here}
            selectedId={memberId}
            onSelect={setMemberId}
            baseCharge={baseCharge}
            currency={currency}
          />
          <GuidePersonGroup
            title="Elsewhere"
            list={grouped.elsewhere}
            selectedId={memberId}
            onSelect={setMemberId}
            baseCharge={baseCharge}
            currency={currency}
          />

          {members.length === 0 && (
            <p className="service-guide-help">
              Nobody in the guide directory yet. Add them under Guide Team and they will
              appear here with the percentage they cost above the destination rate.
            </p>
          )}
        </div>

        <div className="form-actions guide-person-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          {guideLineCount > 1 && (
            <button type="button" className="secondary-btn" onClick={() => onConfirm(memberId || null, { toTrip: true })}>
              <Copy size={15} /> Same guide for the whole trip
            </button>
          )}
          <button type="button" className="primary-btn" onClick={() => onConfirm(memberId || null, { toTrip: false })}>
            <UserCog size={16} /> Apply to this line
          </button>
        </div>
      </div>
    </div>
  );
}
