import { bootAdmin } from './admin-render.js';
import { bootWorkerView } from './worker-render.js';

const path = location.pathname.replace(/\/+$/, '');
const workerMatch = path.match(/^\/w\/([^/]+)$/);

if(path === '/admin'){
  bootAdmin();
}else{
  bootWorkerView(workerMatch ? decodeURIComponent(workerMatch[1]) : null);
}
