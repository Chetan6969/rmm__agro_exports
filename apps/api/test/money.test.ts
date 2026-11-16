import { add, amountInWords, cmp, computeShippingCharges, computeTotals, DOCS, formatAmount, mul, round, sub } from '@rmm/shared';
import { describe, expect, it } from 'vitest';

describe('exact decimal helpers', () => {
  it('multiplies, adds and rounds half-up without floating point drift', () => {
    expect(mul('1250.500', '845.75')).toBe('1057610.38');
    expect(mul('0.005', '1', 2)).toBe('0.01');
    expect(round('-2.345', 2)).toBe('-2.35');
    expect(add(['0.1', '0.2'], 2)).toBe('0.30');
    expect(sub('10', '12.5')).toBe('-2.50');
    expect(sub('5', '-2')).toBe('7.00');
    expect(cmp('1.10', '1.1')).toBe(0);
    expect(formatAmount('1234567.5')).toBe('1,234,567.50');
  });

  it('writes amounts in words from the currency master', () => {
    expect(amountInWords('45200.50', { code: 'USD', subunitName: 'Cents' })).toBe('USD Forty-Five Thousand Two Hundred and Cents Fifty Only');
    expect(amountInWords('1000000', { code: 'EUR' })).toBe('EUR One Million Only');
    expect(amountInWords('12.07', { code: 'AED' })).toBe('AED Twelve and 07/100 Only');
  });

  it('applies shipping charges by incoterm', () => {
    const cfr = computeShippingCharges('CFR', { thcCharge: '100', oceanFreightCharge: '2500', insuranceCharge: '99' });
    expect(cfr.oceanFreightCharge).toBe('2500.00');
    expect(cfr.insuranceCharge).toBe('0.00');
    expect(cfr.totalShippingCharge).toBe('2600.00');
    expect(computeShippingCharges('FOB', { oceanFreightCharge: '2500' }).oceanFreightCharge).toBe('0.00');
  });

  it('computes commercial invoice totals (FOB + freight + insurance for CIF)', () => {
    const t = computeTotals(DOCS.commercialInvoices, { incoterm: 'CIF', oceanFreightCharge: '2500.00', insuranceCharge: '120' }, [
      { quantityMt: '26.000', ratePerMt: '1105.50', noOfBags: 650, grossWtMt: '26.130' },
      { quantityMt: '0.5', ratePerMt: '1105.5' },
    ]);
    expect(t).toMatchObject({
      totalQuantityMt: '26.500',
      totalBags: '650',
      totalGrossWtMt: '26.130',
      fobAmount: '29295.75',
      oceanFreightAmount: '2500.00',
      insuranceAmount: '120.00',
      invoiceTotal: '31915.75',
    });
  });

  it('computes proforma grand total with freight, insurance and discount', () => {
    const t = computeTotals(DOCS.proformaInvoices, { freightAmount: '1000', insuranceAmount: '50.5', discountAmount: '25' }, [
      { quantityMt: '100', ratePerMt: '1050.25', cgst: '0', igst: '0' },
    ]);
    expect(t.goodsAmount).toBe('105025.00');
    expect(t.grandTotal).toBe('106050.50');
  });
});
