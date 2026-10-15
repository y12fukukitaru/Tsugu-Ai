# 請求書メールの SQL を、手元の PostgreSQL で試す（本番には触らない）
#  前提：手元の PostgreSQL 16 を /var/tmp/pgtest（ポート 55432）で起動しておく
cd "$(dirname "$0")/.."
B="psql -h /var/tmp/pgtest -p 55432 -U postgres -q"
P="$B -v ON_ERROR_STOP=1"
$B -c 'drop database if exists invm' -c 'create database invm' >/dev/null 2>&1
$P -d invm -f scratchpad/debit_stub.sql >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
$P -d invm -f supabase/migrations/20261015000000_debit_mandate_setup_fee.sql >/dev/null 2>&1 || { echo "mig1 failed"; exit 1; }
$P -d invm -f supabase/migrations/20261015010000_dunning.sql >/dev/null 2>&1 || { echo "mig2 failed"; exit 1; }
$P -d invm -f scratchpad/suspension_pre.sql >/dev/null 2>&1 || { echo "pre failed"; exit 1; }
$P -d invm -f supabase/migrations/20261015020000_suspension.sql >/dev/null 2>&1 || { echo "mig3 failed"; exit 1; }
#  2回流しても同じ結果になるか
$P -d invm -f supabase/migrations/20261015030000_invoice_mail.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -2
$P -d invm -f supabase/migrations/20261015030000_invoice_mail.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
python3 - <<'PY' > /tmp/claude-0/_im_check.sql
s=open('supabase/migrations/20261015030000_invoice_mail.sql').read()
i=s.rindex('\nselect\n'); j=s.index(';', s.index('"守り"'))
print('drop table if exists public.__im_check; create table public.__im_check as ' + s[i+1:j] + ';')
PY
$P -d invm -f /tmp/claude-0/_im_check.sql >/dev/null 2>&1 || { echo "check failed"; $P -d invm -f /tmp/claude-0/_im_check.sql 2>&1 | grep ERROR; }
#  止める側の SQL をもう一度流しても、守りの無い表が出ないこと
$P -d invm -f supabase/migrations/20261015020000_suspension.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -2
$B -t -A -d invm -f scratchpad/invoice_mail_test.sql 2>&1 | grep -v NOTICE | grep -E "^[0-9]+\|[0-9]+$|^[0-9]+\|.*\|.*\||ERROR" | tail -20
