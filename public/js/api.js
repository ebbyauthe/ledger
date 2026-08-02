export async function api(path, opts = {}){
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if(res.status === 401){
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if(!res.ok){
    let msg = 'Request failed';
    try{ const j = await res.json(); msg = j.error || msg; }catch(e){}
    throw new Error(msg);
  }
  if(res.status === 204) return null;
  return res.json();
}
