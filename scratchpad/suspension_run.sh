# 利用の一時停止の SQL を、手元の PostgreSQL で試す（本番には触らない）
#  前提：手元の PostgreSQL 16 を /var/tmp/pgtest（ポート 55432）で起動しておく
cd "$(dirname "$0")/.."
B="psql -h /var/tmp/pgtest -p 55432 -U postgres -q"
P="$B -v ON_ERROR_STOP=1"
$B -c 'drop database if exists susp' -c 'create database susp' >/dev/null 2>&1
$P -d susp -f scratchpad/debit_stub.sql >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
$P -d susp -f supabase/migrations/20261015000000_debit_mandate_setup_fee.sql >/dev/null 2>&1 || { echo "mig1 failed"; exit 1; }
$P -d susp -f supabase/migrations/20261015010000_dunning.sql >/dev/null 2>&1 || { echo "mig2 failed"; exit 1; }
$P -d susp -f scratchpad/suspension_pre.sql >/dev/null 2>&1 || { echo "pre failed"; $P -d susp -f scratchpad/suspension_pre.sql 2>&1 | grep ERROR | head -3; exit 1; }
#  2回流しても同じ結果になるか
$P -d susp -f supabase/migrations/20261015020000_suspension.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -2
$P -d susp -f supabase/migrations/20261015020000_suspension.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
#  最後の確かめ（select）を表に残して、試験から見る
python3 - <<'PY' > /tmp/claude-0/_sus_check.sql
s=open('supabase/migrations/20261015020000_suspension.sql').read()
i=s.rindex('\nselect\n'); j=s.index(';', s.index('"毎朝の呼び出し"'))
print('drop table if exists public.__sus_check; create table public.__sus_check as ' + s[i+1:j] + ';')
PY
$P -d susp -f /tmp/claude-0/_sus_check.sql >/dev/null 2>&1 || { echo "check failed"; $P -d susp -f /tmp/claude-0/_sus_check.sql 2>&1 | grep ERROR; }
$B -t -A -d susp -f scratchpad/suspension_test.sql 2>&1 | grep -v NOTICE | grep -E "^[0-9]+\|[0-9]+$|^[0-9]+\|.*\|.*\||ERROR" | tail -20
