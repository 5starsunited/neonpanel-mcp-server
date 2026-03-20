-- Migration: add company_id column to ryg_thresholds.
-- Run once in Athena. Existing rows will have company_id = NULL (system defaults).
ALTER TABLE brand_analytics_iceberg.ryg_thresholds
  ADD COLUMNS (company_id BIGINT);
