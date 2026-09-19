-- =====================================================
-- File: 00_extensions.sql
-- Description: Required PostgreSQL extensions
-- =====================================================

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;
create extension if not exists pg_stat_statements;
create extension if not exists "uuid-ossp";

comment on extension pgcrypto is
'UUID generation and cryptographic functions';

comment on extension citext is
'Case insensitive text';

comment on extension pg_trgm is
'Trigram indexes for fast LIKE search';

comment on extension btree_gin is
'GIN support for scalar values';

comment on extension pg_stat_statements is
'Query statistics';

comment on extension "uuid-ossp" is
'UUID generation';