import { NextResponse } from 'next/server';
import { handler, requireSession } from '@/server/http/route';
import { myData } from '@/server/identity/mydata';

/** Выгрузка сведений о своих персональных данных (152-ФЗ) — JSON-файлом. */
export const GET = handler(async (c) => {
  const data = await myData(requireSession(c).user.id);
  return new NextResponse(JSON.stringify(data, null, 1), { headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="my-data-${data.exported_at.slice(0, 10)}.json"`,
  } });
});
