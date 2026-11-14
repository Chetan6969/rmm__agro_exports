'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { Term } from '../../lib/api';
import type { SectionToggles } from './types';

interface Props {
  terms: Term[];
  selectedTermIds: Set<string>;
  sections: SectionToggles;
  onToggleTerm: (id: string) => void;
  onToggleSection: (key: keyof SectionToggles) => void;
  onClose: () => void;
}

const SECTION_LABELS: { key: keyof SectionToggles; label: string }[] = [
  { key: 'showNotifyParty', label: 'Notify party' },
  { key: 'showShippingDetails', label: 'Shipping details' },
  { key: 'showSpecification', label: 'Specification' },
  { key: 'showBankDetails', label: 'Bank details' },
  { key: 'showLcDetails', label: 'LC No. / Date' },
  { key: 'showTermsConditions', label: 'Terms conditions' },
  { key: 'showSignatureBlock', label: 'Signature block' },
];

export function TermsSectionsPanel({
  terms,
  selectedTermIds,
  sections,
  onToggleTerm,
  onToggleSection,
  onClose,
}: Props) {
  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div
        className="ef-modal max-w-sm mt-10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ef-modal-bar">
          <span>Terms &amp; Conditions / Sections</span>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="ef-section-title mb-1.5">
              Terms Conditions — tick to include
            </div>
            <div className="ef-card max-h-48 overflow-y-auto divide-y divide-slate-100">
              {terms.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">
                  No master terms defined.
                </div>
              )}
              {terms.map((t) => (
                <label
                  key={t.id}
                  className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="ef-check mt-0.5"
                    checked={selectedTermIds.has(t.id)}
                    onChange={() => onToggleTerm(t.id)}
                  />
                  <span className="text-xs text-slate-700 leading-snug">
                    {t.content}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="ef-section-title mb-1.5">
              Sections to include on this PI
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {SECTION_LABELS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer text-xs text-slate-700"
                >
                  <input
                    type="checkbox"
                    className="ef-check"
                    checked={sections[key]}
                    onChange={() => onToggleSection(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md">
          <button className="ef-btn ef-btn-primary" onClick={onClose}>
            Save
          </button>
          <button className="ef-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
