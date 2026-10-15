#  前提：手元の PostgreSQL 16 を /var/tmp/pgtest（ポート 55432）で起動しておく
# 口座振替の手続き・初期導入費の SQL を、手元の PostgreSQL で試す（本番には触らない）
cd "$(dirname "$0")/.."
P="psql -h /var/tmp/pgtest -p 55432 -U postgres -q -v ON_ERROR_STOP=1"
psql -h /var/tmp/pgtest -p 55432 -U postgres -q -c 'drop database if exists debit' -c 'create database debit' >/dev/null 2>&1
$P -d debit -f scratchpad/debit_stub.sql >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
#  2回流しても同じ結果になるか
$P -d debit -f supabase/migrations/20261015000000_debit_mandate_setup_fee.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -3
$P -d debit -f supabase/migrations/20261015000000_debit_mandate_setup_fee.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
psql -h /var/tmp/pgtest -p 55432 -U postgres -q -t -A -d debit -f scratchpad/debit_test.sql 2>&1 | grep -v NOTICE | grep -E "^[0-9]+\|[0-9]+$|^[0-9]+\|.*\|.*\|" | tail -20
#  お振込みのお願い・3か月の滞納（同じ土台の上で。2回流す）
$P -d debit -f supabase/migrations/20261015010000_dunning.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -2
$P -d debit -f supabase/migrations/20261015010000_dunning.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
psql -h /var/tmp/pgtest -p 55432 -U postgres -q -t -A -d debit -f scratchpad/dunning_test.sql 2>&1 | grep -v NOTICE | grep -E "^[0-9]+\|[0-9]+$|^[0-9]+\|.*\|.*\|" | tail -20
