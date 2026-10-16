SELECT 'CREATE DATABASE helpdesk_test'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'helpdesk_test'
)
\gexec
