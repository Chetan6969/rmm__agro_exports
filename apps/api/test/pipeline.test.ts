import { evaluatePipeline, pipelineSteps, type PipelineStep } from '@rmm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

const steps: PipelineStep[] = [
  { key: 'pi', label: 'PI', doc: 'pi', daysBeforeShip: 30 },
  { key: 'coc', label: 'COC', daysBeforeShip: 10, requiresFile: true },
  { key: 'booking', label: 'Booking', daysBeforeShip: 5 },
  { key: 'on_board', label: 'On board', daysBeforeShip: 0 },
  { key: 'payment', label: 'Payment', daysBeforeShip: -30 },
];

describe('checkpoint rules', () => {
  it('plans from the ship date and marks overdue, due soon and upcoming', () => {
    const p = evaluatePipeline(steps, { targetShipDate: '2026-12-01', doneByDoc: { pi: '2026-10-25' }, records: {}, today: '2026-11-25' });
    expect(p.steps.map((s) => [s.key, s.plannedDate, s.status])).toEqual([
      ['pi', '2026-11-01', 'done'],
      ['coc', '2026-11-21', 'overdue'],
      ['booking', '2026-11-26', 'due'],
      ['on_board', '2026-12-01', 'due'],
      ['payment', '2026-12-31', 'upcoming'],
    ]);
    expect(p.steps[0].lateDays).toBe(-7); // PI done 7 days early
    expect(p.steps[1].lateDays).toBe(4);
    expect(p).toMatchObject({ overdue: 1, dueSoon: 2, next: 'COC', currentStage: 'PI', done: 1 });
  });

  it('flags work done out of order and counts skipped checkpoints as closed', () => {
    const p = evaluatePipeline(steps, {
      targetShipDate: null,
      doneByDoc: {},
      records: { coc: { done: false, skipped: true, skipReason: 'Waived' }, payment: { done: true, doneDate: '2026-11-20' } },
      today: '2026-11-25',
    });
    expect(p.steps.find((s) => s.key === 'payment')!.outOfOrder).toBe(true);
    expect(p.steps.find((s) => s.key === 'coc')!.status).toBe('skipped');
    expect(p.steps.find((s) => s.key === 'booking')!.status).toBe('unplanned');
    expect(p.done).toBe(2);
    expect(p.overdue).toBe(0);
  });
});

let app: FastifyInstance;
let root: Client;
let companyId = '';
let lotId = '';

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('stage-root');
  root = new Client(app);
  await root.login('stage-root');
  companyId = (await root.ok('POST', '/masters/companies', { code: 'STAGE', name: 'Stage Co', legalName: 'Stage Co Pvt Ltd' })).id;
  await root.ok('POST', '/auth/switch-company', { companyId });
  await root.post('/masters/currencies', { code: 'USD', name: 'US Dollar', exchangeRate: 84 });
  const usd = ((await root.ok('GET', '/masters/currencies/lookup?q=USD')) as { id: string; label: string }[]).find((c) => c.label === 'USD')!.id;
  const buyer = (await root.ok('POST', '/masters/customers', { name: 'Stage Buyer' })).id;
  const product = (await root.ok('POST', '/masters/products', { name: 'Stage Rice' })).id;
  const pi = await root.ok('POST', '/documents/proformaInvoices', {
    documentDate: '2026-10-01',
    status: 'CONFIRMED',
    incoterm: 'FOB',
    buyerId: buyer,
    currencyId: usd,
    exchangeRate: '84',
    lines: [{ productId: product, quantityMt: '100', ratePerMt: '1000' }],
    terms: [],
  });
  lotId = (await root.ok('POST', '/shipments', { proformaInvoiceId: pi.id, lotNo: 1, market: 'GULF', quantityMt: '50', targetShipDate: '2026-11-01' })).id;
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('lot checkpoints through the API', () => {
  it('shows the standard Gulf path with planned dates and overdue steps', async () => {
    const lot = await root.ok('GET', `/shipments/${lotId}`);
    expect(lot.pipeline.steps.map((s: { key: string }) => s.key)).toEqual(pipelineSteps('GULF').map((s) => s.key));
    expect(lot.pipeline.steps[0]).toMatchObject({ key: 'pi', status: 'done', date: '2026-10-01' });
    const coc = lot.pipeline.steps.find((s: { key: string }) => s.key === 'coc');
    expect(coc).toMatchObject({ plannedDate: '2026-10-18', requiresFile: true });
    expect(lot.pipeline.overdue).toBeGreaterThan(0);
  });

  it('needs proof for proof checkpoints, a reason to skip, and never ticks document steps', async () => {
    expect((await root.post(`/shipments/${lotId}/stage`, { stageKey: 'coc', done: true })).status).toBe(400);
    expect((await root.post(`/shipments/${lotId}/stage`, { stageKey: 'coc', done: false, skipped: true })).status).toBe(400);
    const skipped = await root.ok('POST', `/shipments/${lotId}/stage`, { stageKey: 'coc', done: false, skipped: true, skipReason: 'Buyer waived COC' });
    expect(skipped.pipeline.steps.find((s: { key: string }) => s.key === 'coc')).toMatchObject({ status: 'skipped', skipReason: 'Buyer waived COC' });
    expect((await root.post(`/shipments/${lotId}/stage`, { stageKey: 'production', done: true })).status).toBe(400);
    const ticked = await root.ok('POST', `/shipments/${lotId}/stage`, { stageKey: 'packing_order', done: true, doneDate: '2026-09-20' });
    const packing = ticked.pipeline.steps.find((s: { key: string }) => s.key === 'packing_order');
    expect(packing).toMatchObject({ status: 'done', date: '2026-09-20', doneByName: 'stage-root' });
    expect(packing.lateDays).toBe(-7);
  });

  it('a company can edit its checkpoint path; only admins with the permission', async () => {
    const custom = [
      { key: 'pi', label: 'PI', doc: 'pi', daysBeforeShip: 30 },
      { key: 'fumigation', label: 'Fumigation', daysBeforeShip: 3, owner: 'Quality', evidence: 'Fumigation certificate', requiresFile: true },
    ];
    const saved = await root.ok('PUT', '/pipeline/templates/GULF', { steps: custom });
    expect(saved).toMatchObject({ custom: true, version: 1 });
    const lot = await root.ok('GET', `/shipments/${lotId}`);
    expect(lot.pipeline.steps.map((s: { key: string }) => s.key)).toEqual(['pi', 'fumigation']);
    expect((await root.put('/pipeline/templates/GULF', { steps: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] })).status).toBe(400);

    const role = (await root.ok('POST', '/roles', { name: 'Stage viewer', permissions: ['sales.shipments:view', 'admin.pipeline:view'] })).id;
    await root.ok('POST', '/users', { username: 'stage-viewer', fullName: 'Stage viewer', password: PASSWORD, mustChangePassword: false, access: [{ companyId, roleIds: [role] }] });
    const viewer = new Client(app);
    await viewer.login('stage-viewer');
    expect((await viewer.get('/pipeline/templates')).status).toBe(200);
    expect((await viewer.put('/pipeline/templates/GULF', { steps: custom })).status).toBe(403);

    const reset = await root.ok('DELETE', '/pipeline/templates/GULF');
    expect(reset.custom).toBe(false);
  });
});
