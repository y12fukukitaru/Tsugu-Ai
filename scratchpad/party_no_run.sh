# 顧客番号・パートナー番号の SQL を、手元の PostgreSQL で試す（本番には触らない）
cd "$(dirname "$0")/.."
B="psql -h /var/tmp/pgtest -p 55432 -U postgres -q"
P="$B -v ON_ERROR_STOP=1"
$B -c 'drop database if exists pno' -c 'create database pno' >/dev/null 2>&1
$P -d pno -f scratchpad/debit_stub.sql >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
for m in 20261015000000_debit_mandate_setup_fee 20261015010000_dunning; do
  $P -d pno -f supabase/migrations/$m.sql >/dev/null 2>&1 || { echo "$m failed"; exit 1; }
done
$P -d pno -f scratchpad/suspension_pre.sql >/dev/null 2>&1 || { echo "pre failed"; exit 1; }
for m in 20261015020000_suspension 20261015030000_invoice_mail; do
  $P -d pno -f supabase/migrations/$m.sql >/dev/null 2>&1 || { echo "$m failed"; exit 1; }
done
#  流す前からいる方（運営・顧客・パートナー）と、請求
$P -d pno >/dev/null 2>&1 <<'SQL' || { echo "seed failed"; exit 1; }
delete from public.invoices; delete from public.profiles; delete from auth.users;
insert into auth.users values ('40000000-0000-0000-0000-00000000000a','a@x'),('40000000-0000-0000-0000-0000000000c1','c1@x'),('40000000-0000-0000-0000-0000000000b1','p1@x');
insert into public.profiles(id, role, company_name) values
 ('40000000-0000-0000-0000-00000000000a','admin','運営'),('40000000-0000-0000-0000-0000000000c1','customer','一社'),('40000000-0000-0000-0000-0000000000b1','consultant','P1');
insert into public.invoices(customer_id, period, kind, title, amount_ex, tax, amount, due_on, status, method)
 values ('40000000-0000-0000-0000-0000000000c1','2026-11','advisory','2026-11 顧問料',45000,4500,49500,'2026-11-27','open','bank');
grant execute on function public.debit_mandate_set(uuid,text,date,text,text) to authenticated;
SQL
#  2回流しても同じ結果
$P -d pno -f supabase/migrations/20261015040000_party_numbers.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -2
$P -d pno -f supabase/migrations/20261015040000_party_numbers.sql 2>&1 | grep -v NOTICE | grep -v '^$' | tail -1
python3 - <<'PY' > /tmp/claude-0/_pn_check.sql
s=open('supabase/migrations/20261015040000_party_numbers.sql').read()
i=s.rindex('\nselect\n'); j=s.index(';', s.index('"見張り"'))
print('drop table if exists public.__pn_check; create table public.__pn_check as ' + s[i+1:j] + ';')
PY
$P -d pno -f /tmp/claude-0/_pn_check.sql >/dev/null 2>&1 || { echo "check failed"; $P -d pno -f /tmp/claude-0/_pn_check.sql 2>&1 | grep ERROR; }
$B -t -A -d pno -f scratchpad/party_no_test.sql 2>&1 | grep -v NOTICE | grep -E "^[0-9]+\|[0-9]+$|^[0-9]+\|.*\|.*\||ERROR" | tail -20
