import { config } from './dist/config/index.js';
import { runAthenaQuery } from './dist/clients/athena.js';

const catalog = config.athena.catalog;
const wg = config.athena.workgroup;
const ol = config.athena.outputLocation;
const opts = { database: 'amazon_ads_reports_iceberg', workGroup: wg, outputLocation: ol, maxRows: 10 };

async function q(label, sql) {
  try {
    const r = await runAthenaQuery({ query: sql, ...opts });
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.error(label, 'ERROR:', e.message);
  }
}

await q('Q1 raw count (no joins):',
  `SELECT COUNT(*) AS cnt
   FROM "${catalog}"."amazon_ads_reports_iceberg"."sp_search_term" st
   WHERE st.ingest_company_id = '106'
     AND lower(st.searchterm) = lower('ring sizers for loose rings')`);

await q('Q2 any data for company 106 (last 30 days):',
  `SELECT COUNT(*) AS cnt, MIN(st.date) AS min_date, MAX(st.date) AS max_date
   FROM "${catalog}"."amazon_ads_reports_iceberg"."sp_search_term" st
   WHERE st.ingest_company_id = '106'
     AND CAST(st.date AS DATE) >= current_date - INTERVAL '30' DAY`);

await q('Q3 after seller join:',
  `SELECT COUNT(*) AS cnt
   FROM "${catalog}"."amazon_ads_reports_iceberg"."sp_search_term" st
   INNER JOIN "${catalog}"."neonpanel_iceberg"."amazon_sellers" s
     ON CAST(s.id AS VARCHAR) = st.ingest_seller_id
   WHERE st.ingest_company_id = '106'
     AND lower(st.searchterm) = lower('ring sizers for loose rings')`);

await q('Q4 sample ingest_seller_id values:',
  `SELECT DISTINCT st.ingest_seller_id
   FROM "${catalog}"."amazon_ads_reports_iceberg"."sp_search_term" st
   WHERE st.ingest_company_id = '106'
   LIMIT 5`);

await q('Q5 seller IDs for company 106:',
  `SELECT CAST(s.id AS VARCHAR) AS seller_id, s.name
   FROM "${catalog}"."neonpanel_iceberg"."amazon_sellers" s
   WHERE s.company_id = 106
   LIMIT 5`);
