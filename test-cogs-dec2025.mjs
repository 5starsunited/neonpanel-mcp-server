import { runAthenaQuery } from './dist/clients/athena.js';

process.env.AWS_REGION = 'us-east-1';
process.env.AWS_PROFILE = 'app-dev-administrator';

const queryString = `
SELECT 
  SUM(-1 * ft.transaction_amount) AS cogs_amount,
  SUM(-1 * ft.quantity) AS units_sold,
  COUNT(*) AS transactions_count
FROM awsdatacatalog.neonpanel_iceberg.fifo_transactions_snapshot ft
WHERE ft.company_id = 106
  AND ft.document_type = 'Invoice'
  AND ft.country = 'US'
  AND ft.document_date >= DATE '2025-12-01'
  AND ft.document_date <= DATE '2025-12-31'
  AND ft.quantity IS NOT NULL
  AND ft.quantity != 0
  AND ft.transaction_amount IS NOT NULL
`;

console.log('Running query...\n');

runAthenaQuery({
  query: queryString,
  database: 'neonpanel_iceberg',
  outputLocation: 's3://etl-glue-amazon-ads-prod-preprocessbucketreports6-1w0usrm0kq0j7/athena-query-results/',
  maxRows: 10
})
  .then(results => {
    console.log('=== RESULTS ===');
    console.log('Company 106, US Market, December 2025:');
    console.log('COGS Amount:', results.rows[0]?.cogs_amount);
    console.log('Units Sold:', results.rows[0]?.units_sold);
    console.log('Transactions:', results.rows[0]?.transactions_count);
    console.log('\nCompare with CSV: $248,939.55');
  })
  .catch(err => console.error('Error:', err.message));
