# 情報の守りの SQL を、手元の PostgreSQL で試す（本番には触らない）
cd "$(dirname "$0")/.."
P="psql -q -v ON_ERROR_STOP=1"
su postgres -c "psql -q -c 'drop database if exists hard' -c 'create database hard'" >/dev/null 2>&1
su postgres -c "$P -d hard -f scratchpad/hard_stub.sql" >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
su postgres -c "$P -d hard -f supabase/migrations/20260826010000_enterprise_partners.sql" >/dev/null 2>&1 || { echo "ep failed"; exit 1; }
su postgres -c "$P -d hard -f supabase/migrations/20260826030000_ep_kind_rename.sql" >/dev/null 2>&1 || { echo "ep2 failed"; exit 1; }
su postgres -c "psql -q -d hard -c 'grant select,insert,update on all tables in schema public to authenticated'" >/dev/null 2>&1
#  2回流しても同じ結果になるか
su postgres -c "$P -d hard -f supabase/migrations/20261010000000_security_hardening.sql" 2>&1 | grep -v NOTICE | grep -v '^$' | tail -3
su postgres -c "$P -d hard -f supabase/migrations/20261010000000_security_hardening.sql" 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
su postgres -c "psql -q -d hard -f scratchpad/hard_test.sql" 2>&1 | grep -v NOTICE | grep -v '^ *$'
