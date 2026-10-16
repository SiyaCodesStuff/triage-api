SELECT 'CREATE DATABASE triage_test'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'triage_test'
)
\gexec
