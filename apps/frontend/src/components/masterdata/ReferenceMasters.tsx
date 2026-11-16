'use client';

import React from 'react';
import { Ship, Anchor, Globe, ScrollText } from 'lucide-react';
import { api } from '../../lib/api';
import { MasterTable, type MasterConfig } from './MasterTable';

const asRows = (p: Promise<unknown>) => p as Promise<Record<string, unknown>[]>;

export function PortsMaster() {
  const config: MasterConfig = {
    title: 'Ports (Loading / Discharge)',
    icon: <Anchor className="w-5 h-5 text-blue-700" />,
    columns: [
      { key: 'name', label: 'Port name' },
      { key: 'code', label: 'Code' },
      { key: 'portType', label: 'Type' },
      { key: 'country', label: 'Country' },
    ],
    fields: [
      { key: 'name', label: 'Port name', required: true, placeholder: 'e.g. Mundra' },
      { key: 'code', label: 'UN/LOCODE', placeholder: 'e.g. INMUN' },
      { key: 'portType', label: 'Type', type: 'select', options: [
        { value: 'LOADING', label: 'Loading' },
        { value: 'DISCHARGE', label: 'Discharge' },
        { value: 'BOTH', label: 'Both' },
      ] },
      { key: 'country', label: 'Country', required: true, placeholder: 'e.g. India' },
    ],
    empty: { name: '', code: '', portType: 'LOADING', country: '' },
    load: () => asRows(api.ports()),
    create: (d) => api.createPort(d),
    update: (id, d) => api.updatePort(id, d),
    remove: (id) => api.deletePort(id),
  };
  return <MasterTable config={config} />;
}

export function ShippingLinesMaster() {
  const config: MasterConfig = {
    title: 'Shipping Lines',
    icon: <Ship className="w-5 h-5 text-blue-700" />,
    columns: [
      { key: 'name', label: 'Shipping line' },
      { key: 'code', label: 'Code' },
      { key: 'contactDetails', label: 'Contact' },
    ],
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Maersk Line' },
      { key: 'code', label: 'Code', placeholder: 'e.g. MAEU' },
      { key: 'contactDetails', label: 'Contact details', type: 'textarea' },
    ],
    empty: { name: '', code: '', contactDetails: '' },
    load: () => asRows(api.shippingLines()),
    create: (d) => api.createShippingLine(d),
    update: (id, d) => api.updateShippingLine(id, d),
    remove: (id) => api.deleteShippingLine(id),
  };
  return <MasterTable config={config} />;
}

export function CountriesMaster() {
  const config: MasterConfig = {
    title: 'Destination Countries',
    icon: <Globe className="w-5 h-5 text-blue-700" />,
    columns: [
      { key: 'name', label: 'Country' },
      { key: 'code', label: 'ISO' },
      { key: 'region', label: 'Region' },
      { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') },
    ],
    fields: [
      { key: 'name', label: 'Country name', required: true, placeholder: 'e.g. Iraq' },
      { key: 'code', label: 'ISO code', placeholder: 'e.g. IRQ' },
      { key: 'region', label: 'Region', placeholder: 'e.g. Middle East' },
      { key: 'isActive', label: 'Active', type: 'checkbox', placeholder: 'Active' },
    ],
    empty: { name: '', code: '', region: '', isActive: true },
    load: () => asRows(api.countries()),
    create: (d) => api.createCountry(d),
    update: (id, d) => api.updateCountry(id, d),
    remove: (id) => api.deleteCountry(id),
  };
  return <MasterTable config={config} />;
}

export function TermsMaster() {
  const config: MasterConfig = {
    title: 'Terms & Conditions',
    icon: <ScrollText className="w-5 h-5 text-blue-700" />,
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'documentType', label: 'Document' },
      { key: 'content', label: 'Content', render: (r) => <span className="line-clamp-1 max-w-md inline-block">{String(r.content ?? '')}</span> },
      { key: 'isDefault', label: 'Default', render: (r) => (r.isDefault ? 'Yes' : 'No') },
    ],
    fields: [
      { key: 'title', label: 'Title', required: true, placeholder: 'e.g. Jurisdiction' },
      { key: 'documentType', label: 'Document type', type: 'select', options: [
        { value: 'PROFORMA', label: 'Proforma / shared' },
        { value: 'INVOICE', label: 'Invoice' },
        { value: 'PRODUCTION_ORDER', label: 'Production order' },
      ] },
      { key: 'content', label: 'Content', type: 'textarea', required: true },
      { key: 'isDefault', label: 'Default (pre-ticked)', type: 'checkbox', placeholder: 'Tick by default on new documents' },
    ],
    empty: { title: '', documentType: 'PROFORMA', content: '', isDefault: false },
    load: () => asRows(api.terms('PROFORMA')),
    create: (d) => api.createTerm(d),
    update: (id, d) => api.updateTerm(id, d),
    remove: (id) => api.deleteTerm(id),
  };
  return <MasterTable config={config} />;
}
