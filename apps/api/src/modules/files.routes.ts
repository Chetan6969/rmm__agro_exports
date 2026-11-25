import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { files } from '../db/schema/index.js';
import { audit } from '../core/audit.js';
import { inTenantTx, requireCtx, requirePerm } from '../core/context.js';
import { badRequest, HINTS, notFound } from '../core/errors.js';

/** Magic-byte sniffing: never trust the client's content type. SVG is rejected (can carry scripts). */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export async function filesRoutes(app: FastifyInstance) {
  /**
   * Upload. `?scope=group` stores a group asset (company branding: logo, seal, signature),
   * which needs permission to edit companies. Otherwise the file is private to the active company.
   */
  app.post<{ Querystring: { scope?: string } }>('/files', async (req, reply) => {
    const ctx = requireCtx(req);
    const group = req.query.scope === 'group';
    if (group) requirePerm(ctx, 'master.companies', 'edit');
    else if (!ctx.companyId) throw badRequest('No company is selected', HINTS.selectCompany);

    const part = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!part) throw badRequest('No file was received', 'Choose a file and upload it again. If uploads keep failing, check the network connection.');
    const buf = await part.toBuffer();
    if (part.file.truncated) {
      throw badRequest(
        `The file is larger than ${config.maxUploadBytes / 1024 / 1024} MB`,
        'Resize or compress the image (for example save it as JPG at a lower resolution) and upload it again.',
      );
    }
    const kind = sniff(buf);
    if (!kind) {
      throw badRequest(
        'This file type is not allowed',
        'Upload a PNG, JPG or WEBP image, or a PDF. Renaming a file does not change its type: save or export it again in one of these formats.',
      );
    }

    const id = randomUUID();
    const rel = path.join(new Date().toISOString().slice(0, 7), `${id}.${kind.ext}`);
    const abs = path.join(config.storageDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf, { mode: 0o640 });

    // The bytes are written before the row; if the row never commits, remove them again
    // so the storage folder only holds files the database knows about.
    const row = await inTenantTx(ctx, async (tx) => {
      const [f] = await tx
        .insert(files)
        .values({
          id,
          companyId: group ? null : ctx.companyId,
          originalName: part.filename.slice(0, 200),
          mimeType: kind.mime,
          sizeBytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          storagePath: rel,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, { entity: 'files', recordId: f.id, action: 'upload', meta: { name: f.originalName, size: f.sizeBytes } });
      return f;
    }).catch(async (err: unknown) => {
      await rm(abs, { force: true }).catch((rmErr: unknown) => req.log.warn(rmErr, `could not remove orphaned upload ${rel}`));
      throw err;
    });
    return reply.status(201).send({ id: row.id, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
  });

  app.get<{ Params: { id: string } }>('/files/:id', async (req, reply) => {
    const ctx = requireCtx(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound();
    const [f] = await inTenantTx(ctx, (tx) => tx.select().from(files).where(eq(files.id, req.params.id)));
    if (!f) throw notFound('File not found', 'It may have been replaced, or it belongs to another company. Upload the file again.');
    const abs = path.resolve(config.storageDir, f.storagePath);
    if (!abs.startsWith(config.storageDir + path.sep)) throw notFound();
    return reply
      .header('content-type', f.mimeType)
      .header('content-length', f.sizeBytes)
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${encodeURIComponent(f.originalName)}"`)
      .send(createReadStream(abs));
  });
}
