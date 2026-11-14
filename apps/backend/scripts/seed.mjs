// Development seed for ExportFly (RMM Agro Exports).
// Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING. Run: node scripts/seed.mjs
import argon2 from 'argon2';
import postgres from 'postgres';

const url =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/rmm_agro_exports';

const sql = postgres(url, { max: 1 });

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';

async function main() {
  console.log('Seeding ExportFly dev data ->', url.replace(/:[^:@]*@/, ':***@'));

  // 1. Company
  await sql`
    INSERT INTO companies (id, code, name, legal_name, gstin, iec_code, pan_number, lut_number, ad_code, address_line1, address_line2, city, state, country, pincode, contact_phone, contact_email)
    VALUES (${COMPANY_ID}, 'RMM', 'RMM Agro Exports', 'RMM Agro Exports Private Limited',
            '23AAJCR4596A1ZF', 'AAJCR4596A', 'AAJCR4596A', 'AD060326001234X', '6360044-7640009',
            'C-1 to C-7 & E-12 to E-17, Food Park, Pipariya', 'Pachmari Road, Pipariya',
            'Hoshangabad', 'Madhya Pradesh', 'India', '461775', '+91 92025 96265', 'exports@rmmagroexports.com')
    ON CONFLICT (id) DO NOTHING`;

  // 2. Admin user + company link
  const hash = await argon2.hash('Admin@123', {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  });
  await sql`
    INSERT INTO users (id, username, email, password_hash, full_name, role, allowed_screens, is_active)
    VALUES (${ADMIN_ID}, 'admin', 'admin@rmmagroexports.com', ${hash}, 'Navneet Kumar', 'super_admin', ${sql.json(['ALL'])}, true)
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO user_companies (user_id, company_id, is_default)
    VALUES (${ADMIN_ID}, ${COMPANY_ID}, true)
    ON CONFLICT (user_id, company_id) DO NOTHING`;

  // 3. Customers (buyers / consignees / notify parties)
  const customers = [
    ['0000000c-0000-4000-8000-000000000001', 'AL MAHA FOR GENERAL TRADING', 'AL RABEA STREET, POSTAL CODE 6242, BAGHDAD, AL ADEL AREA', 'Baghdad', 'IRAQ', '00964-750-9322222'],
    ['0000000c-0000-4000-8000-000000000002', 'AL-BARAKAH GENERAL TRADING LLC', 'PO Box 8899, Deira', 'Dubai', 'UNITED ARAB EMIRATES', '+971-4-2234567'],
    ['0000000c-0000-4000-8000-000000000003', 'GULF FOODSTUFF TRADING LLC', 'Al Ras, Industrial Area 4', 'Sharjah', 'UNITED ARAB EMIRATES', '+971-6-5567788'],
  ];
  for (const [id, name, address, city, country, phone] of customers) {
    await sql`
      INSERT INTO customers (id, company_id, name, address, city, country, phone, is_buyer, is_consignee, is_notify_party)
      VALUES (${id}, ${COMPANY_ID}, ${name}, ${address}, ${city}, ${country}, ${phone}, true, true, true)
      ON CONFLICT (id) DO NOTHING`;
  }

  // 4. Products (basmati varieties)
  const products = [
    ['0000000d-0000-4000-8000-000000000001', 'INDIAN CREAMY SELLA RICE 1718', '1718', 'SELLA_CREAMY', '10063020'],
    ['0000000d-0000-4000-8000-000000000002', '1121 STEAM BASMATI RICE', '1121', 'STEAM', '10063020'],
    ['0000000d-0000-4000-8000-000000000003', '1509 GOLDEN SELLA BASMATI RICE', '1509', 'SELLA_GOLDEN', '10063020'],
  ];
  for (const [id, name, variety, processing, hsn] of products) {
    await sql`
      INSERT INTO products (id, company_id, name, variety, processing_type, hsn_code)
      VALUES (${id}, ${COMPANY_ID}, ${name}, ${variety}, ${processing}, ${hsn})
      ON CONFLICT (id) DO NOTHING`;
  }

  // 5. Packing types
  const packing = [
    ['0000000e-0000-4000-8000-000000000001', '30KG BOPP BAGS', 'BOPP', '30.000'],
    ['0000000e-0000-4000-8000-000000000002', '25KG BOPP BAGS', 'BOPP', '25.000'],
    ['0000000e-0000-4000-8000-000000000003', '10KG BOPP BAGS', 'BOPP', '10.000'],
    ['0000000e-0000-4000-8000-000000000004', '4*10 KGS JUTE BAG WITH ZIPPER & MASTER', 'JUTE', '40.000'],
    ['0000000e-0000-4000-8000-000000000005', '1KG POUCH X 10 MASTER', 'POUCH', '10.000'],
  ];
  for (const [id, name, material, weight] of packing) {
    await sql`
      INSERT INTO packing_types (id, company_id, name, material, weight_kg)
      VALUES (${id}, ${COMPANY_ID}, ${name}, ${material}, ${weight})
      ON CONFLICT (id) DO NOTHING`;
  }

  // 6. Ports
  const ports = [
    ['0000000f-0000-4000-8000-000000000001', 'Mundra', 'INMUN', 'LOADING', 'India'],
    ['0000000f-0000-4000-8000-000000000002', 'Kandla', 'INIXY', 'LOADING', 'India'],
    ['0000000f-0000-4000-8000-000000000003', 'Umm Qasr', 'IQUQR', 'DISCHARGE', 'Iraq'],
    ['0000000f-0000-4000-8000-000000000004', 'Jebel Ali', 'AEJEA', 'DISCHARGE', 'United Arab Emirates'],
  ];
  for (const [id, name, code, type, country] of ports) {
    await sql`
      INSERT INTO ports (id, company_id, name, code, port_type, country)
      VALUES (${id}, ${COMPANY_ID}, ${name}, ${code}, ${type}, ${country})
      ON CONFLICT (id) DO NOTHING`;
  }

  // 7. Shipping lines
  const lines = [
    ['0000001a-0000-4000-8000-000000000001', 'Maersk Line', 'MAEU'],
    ['0000001a-0000-4000-8000-000000000002', 'MSC', 'MSCU'],
  ];
  for (const [id, name, code] of lines) {
    await sql`
      INSERT INTO shipping_lines (id, company_id, name, code)
      VALUES (${id}, ${COMPANY_ID}, ${name}, ${code})
      ON CONFLICT (id) DO NOTHING`;
  }

  // 8. Bank details (per printed PI)
  await sql`
    INSERT INTO bank_details (id, company_id, bank_name, account_name, account_number, ifsc_code, swift_code, ad_code, branch_address, currency, is_default)
    VALUES ('0000001b-0000-4000-8000-000000000001', ${COMPANY_ID}, 'Axis Bank', 'RMM Agro Export Pvt. Ltd.',
            '925030003649915', 'UTIB0003261', 'AXISINBB044', '6360044-7640009',
            'Pipariya Branch, Hoshangabad, Madhya Pradesh, India', 'USD', true)
    ON CONFLICT (id) DO NOTHING`;

  // 9. Terms & conditions (PROFORMA) — the legacy checklist
  const terms = [
    ['0000001c-0000-4000-8000-000000000001', '2% plus minus from the order', false],
    ['0000001c-0000-4000-8000-000000000002', 'Any dispute is subject to the jurisdiction of the courts at Narmadapuram, Madhya Pradesh, India.', true],
    ['0000001c-0000-4000-8000-000000000003', 'Prices are in the currency and on the Incoterms stated above, for the quantity and packing listed.', true],
    ['0000001c-0000-4000-8000-000000000004', 'Quality as per the specification above; pre-shipment analysis accompanies every consignment.', true],
    ['0000001c-0000-4000-8000-000000000005', 'Shipment within the period stated, from receipt of advance payment or an acceptable letter of credit.', true],
    ['0000001c-0000-4000-8000-000000000006', 'This proforma is valid until the date stated and becomes binding only once confirmed by both parties.', true],
    ['0000001c-0000-4000-8000-000000000007', 'Weight and quality as determined at the port of loading shall be final.', true],
  ];
  for (const [id, content, isDefault] of terms) {
    await sql`
      INSERT INTO terms_and_conditions (id, company_id, title, document_type, content, is_default)
      VALUES (${id}, ${COMPANY_ID}, ${content.slice(0, 60)}, 'PROFORMA', ${content}, ${isDefault})
      ON CONFLICT (id) DO NOTHING`;
  }

  // 10. Proforma counter so next number looks like the legacy sequence
  await sql`
    INSERT INTO document_counters (company_id, document_type, financial_year, last_number, prefix)
    VALUES (${COMPANY_ID}, 'PROFORMA', 'PERPETUAL', 1014, 'RMM')
    ON CONFLICT (company_id, document_type, financial_year) DO NOTHING`;

  console.log('Seed complete. Login: admin / Admin@123');
  await sql.end();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await sql.end();
  process.exit(1);
});
