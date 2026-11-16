import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type {
  CommercialInvoicePdfData,
  CompanyHeaderData,
  CustomerPartyData,
  InvoicePdfData,
  ProductionOrderPdfData,
  ProformaInvoicePdfData,
} from './pdf.types.js';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /** Resolve a file under apps/backend/assets, working from both src and dist. */
  private assetPath(file: string): string | null {
    const candidates: string[] = [];
    try {
      candidates.push(fileURLToPath(new URL(`../../../assets/${file}`, import.meta.url)));
      candidates.push(fileURLToPath(new URL(`../../../../assets/${file}`, import.meta.url)));
    } catch {
      /* ignore */
    }
    candidates.push(`${process.cwd()}/assets/${file}`);
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /** Company logo in the top-right corner of every document. */
  private drawLogo(doc: PDFKit.PDFDocument): void {
    const logo = this.assetPath('logo.png');
    if (!logo) return;
    try {
      doc.image(logo, 437, 26, { width: 122 });
    } catch (err) {
      this.logger.warn(`Could not embed logo: ${(err as Error).message}`);
    }
  }

  /** Authorised-signatory block with the scanned RMM signature/stamp. */
  private drawSignatureBlock(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    forName: string,
  ): number {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#111111')
      .text(`For ${forName.toUpperCase()}`, x, y, { width, align: 'center' });
    let cursor = doc.y + 3;
    const sig = this.assetPath('signature.jpg');
    if (sig) {
      try {
        const sigW = 130;
        doc.image(sig, x + (width - sigW) / 2, cursor, { width: sigW });
        cursor += 46;
      } catch (err) {
        this.logger.warn(`Could not embed signature: ${(err as Error).message}`);
        cursor += 34;
      }
    } else {
      cursor += 34;
    }
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#555555')
      .text('Authorised Signatory', x, cursor, { width, align: 'center' });
    return doc.y;
  }

  /**
   * Generates a print-faithful A4 Production Order PDF for the production
   * department, mirroring the legacy desktop output.
   */
  async generateProductionOrderPdf(
    data: ProductionOrderPdfData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const LEFT = 36;
        const RIGHT = 559;
        const MIDX = 300;
        const gray = '#555555';
        const dark = '#111111';
        const blue = '#1f6fe0';

        const hr = (y: number, color = '#999999') =>
          doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.6).stroke(color);
        const sectionTitle = (t: string, x: number, y: number, w: number) =>
          doc.font('Helvetica-Bold').fontSize(9).fillColor(blue).text(t, x, y, { width: w });

        this.drawLogo(doc);
        doc
          .font('Helvetica-Bold')
          .fontSize(15)
          .fillColor(dark)
          .text('PRODUCTION ORDER', LEFT, 46, {
            width: RIGHT - LEFT,
            align: 'center',
          });
        doc.moveDown(0.8);

        // Produced by (left) + details (right)
        let y = doc.y + 2;
        sectionTitle('PRODUCED BY', LEFT, y, 250);
        hr(y + 11, '#cccccc');
        let ey = y + 14;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark)
          .text((data.company.legalName || data.company.name).toUpperCase(), LEFT, ey, { width: 250 });
        ey = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor(dark);
        for (const ln of data.company.addressLines || [data.company.address || '']) {
          doc.text(ln, LEFT, ey, { width: 250 });
          ey = doc.y;
        }

        sectionTitle('PRODUCTION ORDER DETAILS', MIDX, y, RIGHT - MIDX);
        hr(y + 11, '#cccccc');
        let ry = y + 14;
        const detail = (k: string, v: string, boldVal = false) => {
          doc.font('Helvetica').fontSize(8.5).fillColor(gray).text(k, MIDX, ry, { width: 95 });
          doc.font(boldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(dark)
            .text(v || '-', MIDX + 100, ry, { width: RIGHT - (MIDX + 100) });
          ry = Math.max(doc.y, ry + 12);
        };
        detail('Production Order No.', data.documentNumber, true);
        detail('Date', data.documentDate);
        detail('Buyer', data.buyer?.name || '-');
        detail("Buyer's PO No.", data.buyerPoRef || '-');
        detail('PO Date', data.poDate || '-');

        y = Math.max(ey, ry) + 8;

        // Specification
        sectionTitle('SPECIFICATION', LEFT, y, RIGHT - LEFT);
        y += 12;
        hr(y, '#cccccc');
        y += 4;
        const specRows: Array<[string, string | undefined]> = [
          ['Variety & Grade', data.spec.variety],
          ['Avg. Grain Length', data.spec.avgLength],
          ['Moisture', data.spec.moisture],
          ['Broken', data.spec.broken],
          ['Crop Year', data.spec.cropYear],
        ];
        for (const [k, v] of specRows) {
          doc.font('Helvetica').fontSize(8.5).fillColor(gray).text(k, LEFT, y, { width: 120 });
          doc.font('Helvetica').fontSize(8.5).fillColor(dark).text(v || '', LEFT + 125, y, { width: 300 });
          y = Math.max(doc.y, y + 12);
        }
        y += 2;

        // Items table
        const cols = { sno: 40, desc: 100, pack: 360, bags: 440, qty: 500 };
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark);
        doc.text('S.No', cols.sno, y);
        doc.text('Variety / Description', cols.desc, y);
        doc.text('Packing', cols.pack, y);
        doc.text('No. of Bags', cols.bags, y, { width: 55, align: 'right' });
        doc.text('Qty (MT)', cols.qty, y, { width: 59, align: 'right' });
        y += 12;
        hr(y, '#777777');
        y += 4;

        for (const it of data.items) {
          const top = y;
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark).text(String(it.lineNumber), cols.sno, y);
          doc.font('Helvetica-Bold').fontSize(8.5).text(it.productName, cols.desc, y, { width: cols.pack - cols.desc - 6 });
          let dy = doc.y;
          if (it.description) {
            doc.font('Helvetica').fontSize(7.5).fillColor(gray)
              .text(it.description, cols.desc, dy, { width: cols.pack - cols.desc - 6 });
            dy = doc.y;
          }
          doc.font('Helvetica').fontSize(8.5).fillColor(dark);
          doc.text(it.packing || '', cols.pack, top, { width: 75 });
          doc.text(String(it.noOfBags), cols.bags, top, { width: 55, align: 'right' });
          doc.text(it.quantityMt.toFixed(3), cols.qty, top, { width: 59, align: 'right' });
          y = Math.max(dy, top + 12) + 4;
        }
        hr(y, '#777777');
        y += 5;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark)
          .text(`Total quantity (MT): ${data.totalQuantityMt.toFixed(3)}`, LEFT, y, { continued: true })
          .text(`      Total no. of bags: ${data.totalBags}`);
        y = doc.y + 10;

        // Instructions
        sectionTitle('INSTRUCTIONS', LEFT, y, RIGHT - LEFT);
        y += 12;
        hr(y, '#cccccc');
        y += 4;
        doc.font('Helvetica').fontSize(8.5).fillColor(dark)
          .text(data.instructions || '-', LEFT, y, { width: RIGHT - LEFT });
        y = doc.y + 8;

        if (data.terms.length > 0) {
          sectionTitle('TERMS & CONDITIONS', LEFT, y, RIGHT - LEFT);
          y += 12;
          doc.font('Helvetica').fontSize(7.8).fillColor(dark);
          data.terms.forEach((t, i) => {
            doc.text(`${i + 1}. ${t}`, LEFT, y, { width: RIGHT - LEFT });
            y = doc.y + 2;
          });
          y += 4;
        }

        if (data.showSignature) {
          y = Math.max(y, doc.y) + 20;
          this.drawSignatureBlock(
            doc,
            MIDX,
            y,
            RIGHT - MIDX,
            data.company.legalName || data.company.name,
          );
        }

        if (data.footer) {
          const fy = doc.page.height - 48;
          doc.font('Helvetica').fontSize(7).fillColor(gray)
            .text(data.footer.line, LEFT, fy, {
              width: RIGHT - LEFT,
              align: 'center',
              lineBreak: false,
            });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a print-faithful A4 Proforma Invoice PDF that mirrors the
   * legacy desktop "Preview / Print" output.
   */
  async generateProformaInvoicePdf(
    data: ProformaInvoicePdfData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const LEFT = 36;
        const RIGHT = 559;
        const MIDX = 300;
        const gray = '#555555';
        const dark = '#111111';

        const hr = (y: number, color = '#999999') =>
          doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.6).stroke(color);
        const label = (t: string, x: number, y: number, w: number) => {
          doc
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .fillColor(gray)
            .text(t, x, y, { width: w });
          const ly = doc.y + 1.5;
          doc.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.4).stroke('#c2c2c2');
          doc.y = ly + 2;
        };
        const val = (t: string, x: number, y: number, w: number) =>
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(dark)
            .text(t, x, y, { width: w });

        // ---- Logo (top-right) + Title ----
        this.drawLogo(doc);
        doc
          .font('Helvetica-Bold')
          .fontSize(15)
          .fillColor(dark)
          .text('PROFORMA INVOICE', LEFT, 46, {
            width: RIGHT - LEFT,
            align: 'center',
          });
        doc.moveDown(0.6);

        // ---- Exporter (left) + PI details (right) ----
        let y = doc.y + 4;
        label('EXPORTER', LEFT, y, 250);
        const exporterLines = [
          data.company.legalName || data.company.name,
          ...(data.company.addressLines || [data.company.address || '']),
        ].filter(Boolean);
        doc.font('Helvetica').fontSize(8.5).fillColor(dark);
        let ey = y + 11;
        for (const ln of exporterLines) {
          doc.text(ln, LEFT, ey, { width: 250 });
          ey = doc.y;
        }

        label('PROFORMA INVOICE DETAILS', MIDX, y, RIGHT - MIDX);
        let ry = y + 11;
        const detailRow = (k: string, v: string) => {
          doc
            .font('Helvetica-Bold')
            .fontSize(8)
            .fillColor(gray)
            .text(k, MIDX, ry, { width: 90, continued: false });
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(dark)
            .text(v || '-', MIDX + 95, ry, { width: RIGHT - (MIDX + 95) });
          ry = Math.max(doc.y, ry + 12);
        };
        detailRow('PI No.', data.documentNumber);
        detailRow('PI Date', data.documentDate);
        if (data.buyerPoRef) detailRow('Buyers PO / Ref', data.buyerPoRef);
        if (data.poDate) detailRow('PO Date', data.poDate);
        if (data.sections.showLcDetails) {
          detailRow('LC No.', data.lcNumber || '-');
          detailRow('LC Date', data.lcDate || '-');
        }
        detailRow('Currency', data.currency);
        detailRow('Incoterms', data.incoterm);
        detailRow('Payment Terms', data.paymentTerms);

        y = Math.max(ey, ry) + 6;
        hr(y);
        y += 6;

        // ---- Consignee / Buyer / Notify ----
        const party = (
          title: string,
          p: CustomerPartyData | undefined,
          x: number,
          w: number,
          yy: number,
        ): number => {
          label(title, x, yy, w);
          let py = yy + 11;
          if (p) {
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark);
            doc.text(p.name, x, py, { width: w });
            py = doc.y;
            doc.font('Helvetica').fontSize(8).fillColor(dark);
            doc.text(`${p.address}`, x, py, { width: w });
            py = doc.y;
            doc.text(p.country, x, py, { width: w });
            py = doc.y;
          } else {
            doc.font('Helvetica').fontSize(8).fillColor(gray).text('-', x, py);
            py = doc.y;
          }
          return py;
        };

        const cY = party('CONSIGNEE / BUYER', data.consignee, LEFT, 250, y);
        const bY = data.buyer
          ? party('BUYER (IF OTHER THAN CONSIGNEE)', data.buyer, MIDX, RIGHT - MIDX, y)
          : y;
        y = Math.max(cY, bY) + 6;

        if (data.sections.showNotifyParty && data.notifyParty) {
          y = party('NOTIFY PARTY', data.notifyParty, LEFT, 250, y) + 6;
        }

        hr(y);
        y += 6;

        // ---- Shipping details ----
        if (data.sections.showShippingDetails) {
          label('SHIPPING DETAILS', LEFT, y, RIGHT - LEFT);
          y += 12;
          const sLeft = [
            ['Country of Origin', data.countryOfOrigin],
            ['Port of Loading', data.portOfLoading],
            ['Mode of Shipment', data.modeOfShipment],
          ];
          const sRight = [
            ['Destination Country', data.finalDestination],
            ['Port of Discharge', data.portOfDischarge],
          ];
          const startShip = y;
          let ly = startShip;
          for (const [k, v] of sLeft) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(gray).text(k + ':', LEFT, ly, { width: 110 });
            doc.font('Helvetica').fontSize(8.5).fillColor(dark).text(v, LEFT + 115, ly, { width: 170 });
            ly = Math.max(doc.y, ly + 12);
          }
          let ry2 = startShip;
          for (const [k, v] of sRight) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(gray).text(k + ':', MIDX, ry2, { width: 110 });
            doc.font('Helvetica').fontSize(8.5).fillColor(dark).text(v, MIDX + 115, ry2, { width: RIGHT - (MIDX + 115) });
            ry2 = Math.max(doc.y, ry2 + 12);
          }
          y = Math.max(ly, ry2) + 4;
          hr(y);
          y += 6;
        }

        // ---- Items table ----
        const cols = { sno: 40, desc: 70, hs: 300, qty: 360, rate: 430, amt: 495 };
        doc.font('Helvetica-Bold').fontSize(8).fillColor(gray);
        doc.text('S.No', cols.sno, y);
        doc.text('Description of Goods', cols.desc, y);
        doc.text('HS Code', cols.hs, y);
        doc.text('Qty (MT)', cols.qty, y, { width: 55, align: 'right' });
        doc.text('Rate', cols.rate, y, { width: 55, align: 'right' });
        doc.text('Amount', cols.amt, y, { width: 64, align: 'right' });
        y += 12;
        hr(y, '#777777');
        y += 5;

        doc.fillColor(dark);
        for (const it of data.items) {
          const rowTop = y;
          doc.font('Helvetica-Bold').fontSize(8.5).text(String(it.lineNumber), cols.sno, y);
          doc.font('Helvetica-Bold').fontSize(8.5).text(it.productName, cols.desc, y, { width: cols.hs - cols.desc - 6 });
          let dy = doc.y;
          doc.font('Helvetica').fontSize(7.5).fillColor(gray);
          if (it.description) {
            doc.text(it.description, cols.desc, dy, { width: cols.hs - cols.desc - 6 });
            dy = doc.y;
          }
          if (it.packingText) {
            doc.text('Packing:', cols.desc, dy + 1, { width: cols.hs - cols.desc - 6 });
            dy = doc.y;
            doc.text(it.packingText, cols.desc, dy, { width: cols.hs - cols.desc - 6 });
            dy = doc.y;
          }
          if (it.cropYear) {
            doc.text(`CROP YEAR : ${it.cropYear}`, cols.desc, dy, { width: cols.hs - cols.desc - 6 });
            dy = doc.y;
          }
          doc.fillColor(dark).font('Helvetica').fontSize(8.5);
          doc.text(it.hsCode || '-', cols.hs, rowTop, { width: 55 });
          doc.text(it.quantityMt.toFixed(2), cols.qty, rowTop, { width: 55, align: 'right' });
          doc.text(it.ratePerMt.toFixed(2), cols.rate, rowTop, { width: 55, align: 'right' });
          doc.text(it.amount.toFixed(2), cols.amt, rowTop, { width: 64, align: 'right' });
          y = Math.max(dy, rowTop + 14) + 4;
        }

        hr(y, '#777777');
        y += 6;

        // ---- Totals ----
        const totalRow = (k: string, v: string, bold = false) => {
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(bold ? 9.5 : 8.5)
            .fillColor(dark)
            .text(k, 360, y, { width: 75, align: 'left' });
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(bold ? 9.5 : 8.5)
            .text(v, cols.amt - 40, y, { width: 104, align: 'right' });
          y += bold ? 16 : 13;
        };
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark)
          .text(`Total quantity (MT): ${data.totalQuantityMt.toFixed(3)}`, LEFT, y);
        totalRow(data.incoterm, data.goodsSubtotal.toFixed(2));
        totalRow('Freight', data.freightAmount.toFixed(2));
        totalRow('Insurance', data.insuranceAmount.toFixed(2));
        totalRow('Discount (-)', data.discountAmount.toFixed(2));
        hr(y, '#777777');
        y += 5;
        totalRow(`TOTAL (${data.currency})`, data.grandTotal.toFixed(2), true);
        y += 2;

        doc.font('Helvetica-Bold').fontSize(8).fillColor(dark)
          .text('AMOUNT IN WORDS: ', LEFT, y, { continued: true })
          .font('Helvetica')
          .text(data.amountInWords);
        y = doc.y + 8;

        // ---- Bank details ----
        if (data.sections.showBankDetails && data.bankDetails) {
          hr(y);
          y += 5;
          label('BANK DETAILS (FOR REMITTANCE)', LEFT, y, RIGHT - LEFT);
          y += 12;
          const b = data.bankDetails;
          const bankRows: Array<[string, string]> = [
            ['Beneficiary', b.accountName],
            ['Bank Name', b.bankName],
            ['Account No.', b.accountNumber],
            ['SWIFT Code', b.swiftCode],
            ['IFSC / AD Code', b.ifscAdCode || '-'],
          ];
          for (const [k, v] of bankRows) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(gray).text(k, LEFT, y, { width: 90 });
            doc.font('Helvetica').fontSize(8.5).fillColor(dark).text(v, LEFT + 95, y, { width: 300 });
            y = Math.max(doc.y, y + 11);
          }
          y += 4;
        }

        // ---- Terms ----
        if (data.sections.showTermsConditions && data.terms.length > 0) {
          hr(y);
          y += 5;
          label('TERMS & CONDITIONS', LEFT, y, RIGHT - LEFT);
          y += 12;
          doc.font('Helvetica').fontSize(7.8).fillColor(dark);
          data.terms.forEach((t, i) => {
            doc.text(`${i + 1}. ${t}`, LEFT, y, { width: RIGHT - LEFT });
            y = doc.y + 2;
          });
          y += 4;
        }

        // ---- Signature ----
        if (data.sections.showSignatureBlock) {
          const blockTop = Math.max(y, doc.y) + 10;
          doc.font('Helvetica').fontSize(8).fillColor(dark)
            .text(
              `Acceptance by: ${data.buyer?.name || data.consignee?.name || ''}`,
              LEFT,
              blockTop,
              { width: 250 },
            );
          const sigBottom = this.drawSignatureBlock(
            doc,
            MIDX,
            blockTop,
            RIGHT - MIDX,
            data.company.legalName || data.company.name,
          );
          doc.font('Helvetica').fontSize(7.5).fillColor(gray)
            .text('Signature, name and company stamp', LEFT, sigBottom, { width: 250 });
        }

        // ---- Footer (pinned near bottom of the first page) ----
        if (data.footer) {
          const fy = doc.page.height - 58;
          doc.font('Helvetica').fontSize(7).fillColor(gray)
            .text(data.footer.addressLine, LEFT, fy, {
              width: RIGHT - LEFT,
              align: 'center',
              lineBreak: false,
            })
            .text(data.footer.contactLine, LEFT, fy + 10, {
              width: RIGHT - LEFT,
              align: 'center',
              lineBreak: false,
            });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a print-faithful A4 Commercial Invoice PDF in the same layout
   * family as the Proforma Invoice (parties, shipping details, goods, totals).
   */
  async generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const LEFT = 40;
        const RIGHT = 555;
        const MIDX = 306;
        const RW = RIGHT - MIDX; // right column width
        const GAP = 9;
        const gray = '#555555';
        const dark = '#111111';
        const blue = '#13529c';
        const ruleColor = '#b7c6da';

        const heading = (t: string, x: number, yy: number, w: number): number => {
          doc.font('Helvetica-Bold').fontSize(8).fillColor(blue).text(t, x, yy, { width: w });
          const ly = doc.y + 2;
          doc.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.5).stroke(ruleColor);
          return ly + 3;
        };
        const party = (title: string, p: CustomerPartyData | undefined, x: number, w: number, yy: number): number => {
          let py = heading(title, x, yy, w);
          if (p) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(p.name, x, py, { width: w });
            py = doc.y + 1;
            doc.font('Helvetica').fontSize(8.3).fillColor(dark).text(p.address, x, py, { width: w, lineGap: 1 });
            py = doc.y;
            doc.text(p.country, x, py, { width: w });
            py = doc.y;
          } else {
            doc.font('Helvetica').fontSize(8.3).fillColor(gray).text('-', x, py);
            py = doc.y;
          }
          return py;
        };
        const kvRows = (rows: Array<[string, string | undefined]>, x: number, w: number, startY: number): number => {
          let ry = startY;
          const labelW = 104;
          for (const [k, v] of rows) {
            doc.font('Helvetica').fontSize(8).fillColor(gray).text(k, x, ry, { width: labelW });
            doc.font('Helvetica-Bold').fontSize(8.3).fillColor(dark).text(v || '-', x + labelW + 6, ry, { width: w - labelW - 6 });
            ry = Math.max(doc.y, ry + 12.5);
          }
          return ry;
        };

        // ---- Header: logo (top-right) + title + subtitle below the logo ----
        this.drawLogo(doc);
        doc.font('Helvetica-Bold').fontSize(16).fillColor(dark)
          .text('COMMERCIAL INVOICE', LEFT, 40, { width: RIGHT - LEFT, align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor(gray)
          .text(
            `SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF IGST${data.company.lutNumber ? `   |   LUT ARN: ${data.company.lutNumber}` : ''}`,
            LEFT, 74, { width: RIGHT - LEFT, align: 'center' },
          );
        let y = doc.y + 6;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.8).stroke('#7f93ad');
        y += GAP;

        // ---- Exporter + Invoice detail ----
        let ey = heading('EXPORTER', LEFT, y, MIDX - LEFT - 12);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark)
          .text(data.company.legalName || data.company.name, LEFT, ey, { width: MIDX - LEFT - 12 });
        ey = doc.y + 1;
        doc.font('Helvetica').fontSize(8.3).fillColor(dark);
        for (const ln of data.company.addressLines || [data.company.address || '']) {
          doc.text(ln, LEFT, ey, { width: MIDX - LEFT - 12, lineGap: 1 });
          ey = doc.y;
        }

        const ry0 = heading('INVOICE DETAIL $', MIDX, y, RW);
        const ry = kvRows(
          [
            ['Invoice No.', data.documentNumber],
            ['Date', data.documentDate],
            ['IEC No.', data.company.iec || '-'],
            ["Buyer's Order No. & Date", data.buyerOrderNoAndDate || '-'],
          ],
          MIDX, RW, ry0,
        );
        y = Math.max(ey, ry) + GAP;

        // ---- Consignee + Buyer ----
        const cY = party('CONSIGNEE', data.consignee, LEFT, MIDX - LEFT - 12, y);
        const bY = party('BUYER (IF OTHER THAN CONSIGNEE)', data.buyer || data.consignee, MIDX, RW, y);
        y = Math.max(cY, bY) + GAP;

        // ---- Notify + Our bank ----
        const nY = party('NOTIFY PARTY', data.notifyParty || data.consignee, LEFT, MIDX - LEFT - 12, y);
        const by0 = heading('OUR BANK (FOR REMITTANCE)', MIDX, y, RW);
        const byy = data.bank
          ? kvRows(
              [
                ['Bank', data.bank.bankName],
                ['A/C No.', data.bank.accountNumber],
                ['Branch / SWIFT', data.bank.swiftCode],
                ['AD Code', data.bank.adCode || '-'],
              ],
              MIDX, RW, by0,
            )
          : by0;
        y = Math.max(nY, byy) + GAP;

        // ---- Shipping details (two columns) ----
        const sh0 = heading('SHIPPING DETAILS $', LEFT, y, RIGHT - LEFT);
        const s = data.shipping;
        const ly2 = kvRows(
          [
            ['Pre-carriage by', s.preCarriageBy],
            ['Country of Origin', s.countryOfOrigin],
            ['Vessel / Flight No.', s.vesselFlightNo],
            ['Port of Discharge', s.portOfDischarge],
            ['Terms of Delivery', s.termsOfDelivery || data.incoterm],
          ],
          LEFT, MIDX - LEFT - 12, sh0,
        );
        const ry3 = kvRows(
          [
            ['Place of Receipt', s.placeOfReceipt],
            ['Destination Country', s.destinationCountry],
            ['Port of Loading', s.portOfLoading],
            ['Final Destination', s.finalDestination],
            ['Payment', s.payment],
          ],
          MIDX, RW, sh0,
        );
        y = Math.max(ly2, ry3) + GAP;

        // ---- Goods table ----
        const col = { marks: LEFT, desc: 112, qty: 392, price: 448, amt: 502 };
        const qtyW = 50, priceW = 48, amtW = RIGHT - col.amt;
        doc.font('Helvetica-Bold').fontSize(7.8).fillColor(gray);
        doc.text('Marks / HS', col.marks, y, { width: col.desc - col.marks - 6 });
        doc.text('Number & Kind of Packages, Description of Goods', col.desc, y, { width: col.qty - col.desc - 6 });
        doc.text('Qty (MT)', col.qty, y, { width: qtyW, align: 'right' });
        doc.text('Price $/MT', col.price, y, { width: priceW, align: 'right' });
        doc.text('Amount $', col.amt, y, { width: amtW, align: 'right' });
        y += 13;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.7).stroke('#6f7f93');
        y += 5;

        const marksTop = y;
        doc.font('Helvetica').fontSize(7.8).fillColor(dark);
        if (data.marksNumbers) doc.text(data.marksNumbers, col.marks, y, { width: col.desc - col.marks - 6 });
        if (data.hsCode) doc.text(`HS CODE: ${data.hsCode}`, col.marks, doc.y + 2, { width: col.desc - col.marks - 6 });

        let dy = marksTop;
        if (data.goodsIntro) {
          doc.font('Helvetica').fontSize(8).fillColor(dark)
            .text(data.goodsIntro, col.desc, dy, { width: col.qty - col.desc - 6, lineGap: 1 });
          dy = doc.y + 3;
        }
        for (const it of data.items) {
          const top = dy;
          doc.font('Helvetica').fontSize(8).fillColor(dark)
            .text(it.description, col.desc, top, { width: col.qty - col.desc - 6 });
          const lineBottom = doc.y;
          doc.font('Helvetica').fontSize(8).fillColor(dark);
          doc.text(it.quantityMt.toFixed(3), col.qty, top, { width: qtyW, align: 'right' });
          doc.text(it.pricePerMt.toFixed(2), col.price, top, { width: priceW, align: 'right' });
          doc.text(it.amount.toFixed(2), col.amt, top, { width: amtW, align: 'right' });
          dy = Math.max(lineBottom, top + 12) + 4;
        }
        y = Math.max(dy, doc.y, marksTop) + 3;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.7).stroke('#6f7f93');
        y += 7;

        // ---- Totals: left weights/igst, right value breakdown ----
        const totalsTop = y;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark)
          .text(`Total Net Weight (MT): ${data.totalNetWeightMt.toFixed(3)}`, LEFT, y);
        if (data.totalGrossWeightMt != null) {
          doc.text(`Total Gross Weight (MT): ${data.totalGrossWeightMt.toFixed(3)}`, LEFT, doc.y + 2);
        }
        doc.font('Helvetica').fontSize(8).fillColor(dark)
          .text('IGST @ 0% (export under LUT): NIL', LEFT, doc.y + 2);

        const cur = data.currency === 'USD' ? '$' : data.currency;
        let ty = totalsTop;
        const totRow = (k: string, v: number, bold = false) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9.5 : 8.3).fillColor(dark)
            .text(k, 360, ty, { width: 120 });
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9.5 : 8.3)
            .text(v.toFixed(2), 480, ty, { width: RIGHT - 480, align: 'right' });
          ty += bold ? 16 : 13;
        };
        totRow(`Total CFR Value ${cur}`, data.totalCfrValue);
        totRow('Insurance', data.insuranceAmount);
        totRow('Ocean Freight', data.oceanFreightAmount);
        totRow(`Total FOB Value ${cur}`, data.totalFobValue, true);

        y = Math.max(doc.y, ty) + 7;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).stroke('#999999');
        y += 6;

        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(dark)
          .text('AMOUNT IN WORDS: ', LEFT, y, { continued: true })
          .font('Helvetica').text(data.amountInWords);
        y = doc.y + 10;

        // ---- BL / Shipping bill (left) + signature block (right) ----
        const refTop = y;
        doc.font('Helvetica').fontSize(8).fillColor(dark);
        if (data.blNumber) { doc.text(`BILL OF LADING NO.: ${data.blNumber}    DATED: ${data.blDate || '-'}`, LEFT, y, { width: 280 }); y = doc.y + 2; }
        if (data.shippingBillNumber) { doc.text(`SHIPPING BILL NO.: ${data.shippingBillNumber}    DATED: ${data.shippingBillDate || '-'}`, LEFT, y, { width: 280 }); y = doc.y + 2; }
        doc.font('Helvetica').fontSize(7).fillColor(gray)
          .text('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', LEFT, y + 4, { width: 280, lineGap: 1 });

        if (data.showSignature) {
          this.drawSignatureBlock(doc, MIDX, refTop, RW, data.company.legalName || data.company.name);
        }

        if (data.footer) {
          const fy = doc.page.height - 64;
          doc.font('Helvetica').fontSize(7).fillColor(gray)
            .text(data.footer.addressLine, LEFT, fy, { width: RIGHT - LEFT, align: 'center', lineBreak: false })
            .text(data.footer.contactLine, LEFT, fy + 10, { width: RIGHT - LEFT, align: 'center', lineBreak: false });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a print-faithful A4 Commercial Export Invoice PDF
   */
  async generateCommercialInvoicePdf(
    data: CommercialInvoicePdfData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36, // 0.5 in / 12.7 mm
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        // 1. HEADER (Top Letterhead) — centered in the left area, clear of the logo
        this.drawLogo(doc);
        const HEADX = 36;
        const HEADW = 396;
        doc
          .font('Helvetica-Bold')
          .fontSize(15)
          .text(data.company.name.toUpperCase(), HEADX, 40, {
            align: 'center',
            width: HEADW,
          });

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(
            `${data.company.address || 'Export House, Taraori - 132116, Karnal, Haryana, India'}`,
            HEADX,
            undefined,
            { align: 'center', width: HEADW },
          )
          .text(
            `GSTIN: ${data.company.gstin || '06AABCR1234F1Z5'} | IEC: ${data.company.iec || '0505012345'} | Email: ${data.company.email || 'exports@rmmagroexports.com'}`,
            HEADX,
            undefined,
            { align: 'center', width: HEADW },
          );

        doc.moveDown(0.6);
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .text('COMMERCIAL EXPORT INVOICE', HEADX, undefined, {
            align: 'center',
            width: 523,
            underline: true,
          });

        doc.moveDown(0.5);

        // Draw horizontal divider
        const startY = doc.y;
        doc.moveTo(36, startY).lineTo(559, startY).stroke('#222222');
        doc.moveDown(0.4);

        // 2. DOCUMENT & PARTY METADATA (2-column box layout)
        const topGridY = doc.y;

        // Left column: Shipper & Consignee
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text('EXPORTER / SHIPPER:', 36, topGridY)
          .font('Helvetica')
          .text(data.company.name, 36)
          .text(data.company.address || 'Karnal, Haryana, India', 36);

        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .text('CONSIGNEE (For Delivery):', 36)
          .font('Helvetica')
          .text(data.buyer.name, 36)
          .text(data.buyer.address, 36)
          .text(data.buyer.country, 36);

        // Right column: Invoice details
        const rightColX = 320;
        doc
          .font('Helvetica-Bold')
          .text('Invoice No: ', rightColX, topGridY, { continued: true })
          .font('Helvetica')
          .text(data.documentNumber);

        doc
          .font('Helvetica-Bold')
          .text('Invoice Date: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(data.documentDate);

        doc
          .font('Helvetica-Bold')
          .text('Buyer PO Ref: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(data.buyerPoNumber || 'N/A');

        doc
          .font('Helvetica-Bold')
          .text('Port of Loading: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(data.portOfLoading);

        doc
          .font('Helvetica-Bold')
          .text('Port of Discharge: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(data.portOfDischarge);

        doc
          .font('Helvetica-Bold')
          .text('Country of Destination: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(data.countryOfDestination);

        doc
          .font('Helvetica-Bold')
          .text('Incoterm Terms: ', rightColX, undefined, { continued: true })
          .font('Helvetica')
          .text(`${data.incoterm} (${data.currency})`);

        doc.moveDown(1);
        const tableStartY = Math.max(doc.y, 230);
        doc.moveTo(36, tableStartY).lineTo(559, tableStartY).stroke('#222222');

        // 3. ITEMS TABLE
        let currentY = tableStartY + 6;
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('S.No', 40, currentY);
        doc.text('Description of Export Goods', 70, currentY);
        doc.text('Packing Type', 270, currentY);
        doc.text('Quantity (MT)', 370, currentY, { width: 60, align: 'right' });
        doc.text(`Rate / MT (${data.currency})`, 440, currentY, {
          width: 50,
          align: 'right',
        });
        doc.text(`Amount (${data.currency})`, 500, currentY, {
          width: 55,
          align: 'right',
        });

        currentY += 14;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#888888');
        currentY += 6;

        let totalQty = 0;
        doc.font('Helvetica').fontSize(8);
        data.items.forEach((item, idx) => {
          totalQty += item.quantityMt;
          doc.text(String(idx + 1), 40, currentY);
          doc.text(item.productName, 70, currentY, { width: 190 });
          doc.text(item.packingDescription, 270, currentY, { width: 95 });
          doc.text(item.quantityMt.toFixed(3), 370, currentY, {
            width: 60,
            align: 'right',
          });
          doc.text(item.ratePerMt.toFixed(2), 440, currentY, {
            width: 50,
            align: 'right',
          });
          doc.text(item.amount.toFixed(2), 500, currentY, {
            width: 55,
            align: 'right',
          });

          if (item.specifications) {
            currentY += 12;
            doc
              .font('Helvetica-Oblique')
              .fontSize(7)
              .text(`Spec: ${item.specifications}`, 70, currentY, { width: 250 })
              .font('Helvetica')
              .fontSize(8);
          }
          currentY += 16;
        });

        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#222222');
        currentY += 6;

        // Subtotals & Shipping breakdown
        doc.font('Helvetica-Bold');
        doc.text(`Total FOB Quantity (MT): ${totalQty.toFixed(3)}`, 40, currentY);
        doc.text('Total FOB Value:', 360, currentY, { width: 120 });
        doc.text(data.totalFobAmount.toFixed(2), 500, currentY, {
          width: 55,
          align: 'right',
        });

        if (data.incoterm === 'CFR' || data.incoterm === 'CIF') {
          currentY += 12;
          doc.text('Ocean Freight Charges:', 400, currentY);
          doc.text(data.oceanFreightAmount.toFixed(2), 500, currentY, {
            width: 55,
            align: 'right',
          });
        }

        if (data.incoterm === 'CIF') {
          currentY += 12;
          doc.text('Marine Insurance:', 400, currentY);
          doc.text(data.insuranceAmount.toFixed(2), 500, currentY, {
            width: 55,
            align: 'right',
          });
        }

        currentY += 14;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#222222');
        currentY += 6;

        // Grand Total
        doc.fontSize(9);
        doc.text(
          `GRAND TOTAL (${data.incoterm} ${data.currency}):`,
          350,
          currentY,
        );
        doc.text(data.totalInvoiceAmount.toFixed(2), 500, currentY, {
          width: 55,
          align: 'right',
        });

        // 4. AMOUNT IN WORDS
        currentY += 20;
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text('AMOUNT IN WORDS: ', 36, currentY, { continued: true })
          .font('Helvetica')
          .text(data.amountInWords);

        // 5. BANKING DETAILS
        currentY += 20;
        doc.font('Helvetica-Bold').fontSize(8).text('BANK DETAILS FOR REMITTANCE:', 36, currentY);
        currentY += 10;
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .text(
            `Bank: ${data.bankDetails?.bankName || 'HDFC Bank Ltd, New Delhi'} | A/C No: ${data.bankDetails?.accountNumber || '50200012345678'} | SWIFT: ${data.bankDetails?.swiftCode || 'HDFCINBB'}`,
            36,
            currentY,
          );

        // 6. DECLARATION & SIGNATURE
        currentY += 25;
        doc
          .font('Helvetica')
          .fontSize(7)
          .text(
            'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
            36,
            currentY,
            { width: 300 },
          );

        this.drawSignatureBlock(doc, 380, currentY, 170, data.company.name);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a print-faithful A4 Packing List PDF
   */
  async generatePackingListPdf(
    company: CompanyHeaderData,
    invoiceNumber: string,
    invoiceDate: string,
    buyer: CustomerPartyData,
    containersList: {
      containerNumber: string;
      sealNumber: string;
      containerSize: string;
      totalBags: number;
      grossWeightKg: number;
      netWeightKg: number;
    }[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36,
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        // Header
        this.drawLogo(doc);
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(company.name.toUpperCase(), { align: 'center' });

        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .text('EXPORT PACKING LIST', { align: 'center', underline: true });

        doc.moveDown(0.5);
        let currentY = doc.y;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#222222');
        currentY += 8;

        // Metadata
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(`Invoice No: ${invoiceNumber}  |  Date: ${invoiceDate}`, 36, currentY);
        doc.text(`Consignee / Buyer: ${buyer.name}, ${buyer.country}`, 300, currentY);

        currentY += 20;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#222222');
        currentY += 6;

        // Container Table Header
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('Container No', 40, currentY);
        doc.text('Line Seal No', 160, currentY);
        doc.text('Size', 270, currentY);
        doc.text('Total Bags', 330, currentY, { width: 60, align: 'right' });
        doc.text('Net Wt (KG)', 410, currentY, { width: 65, align: 'right' });
        doc.text('Gross Wt (KG)', 490, currentY, { width: 65, align: 'right' });

        currentY += 14;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#888888');
        currentY += 6;

        let totalBagsSum = 0;
        let totalNetKgSum = 0;
        let totalGrossKgSum = 0;

        doc.font('Helvetica').fontSize(8);
        for (const c of containersList) {
          totalBagsSum += c.totalBags;
          totalNetKgSum += c.netWeightKg;
          totalGrossKgSum += c.grossWeightKg;

          doc.text(c.containerNumber, 40, currentY);
          doc.text(c.sealNumber, 160, currentY);
          doc.text(c.containerSize, 270, currentY);
          doc.text(c.totalBags.toLocaleString(), 330, currentY, {
            width: 60,
            align: 'right',
          });
          doc.text(c.netWeightKg.toFixed(2), 410, currentY, {
            width: 65,
            align: 'right',
          });
          doc.text(c.grossWeightKg.toFixed(2), 490, currentY, {
            width: 65,
            align: 'right',
          });

          currentY += 14;
        }

        currentY += 4;
        doc.moveTo(36, currentY).lineTo(559, currentY).stroke('#222222');
        currentY += 6;

        // Totals
        doc.font('Helvetica-Bold');
        doc.text('TOTAL SUMMARY:', 40, currentY);
        doc.text(totalBagsSum.toLocaleString(), 330, currentY, {
          width: 60,
          align: 'right',
        });
        doc.text(totalNetKgSum.toFixed(2), 410, currentY, {
          width: 65,
          align: 'right',
        });
        doc.text(totalGrossKgSum.toFixed(2), 490, currentY, {
          width: 65,
          align: 'right',
        });

        // Signatory
        currentY += 50;
        this.drawSignatureBlock(doc, 380, currentY, 170, company.name);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
