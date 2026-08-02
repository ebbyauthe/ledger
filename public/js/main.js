import { bootAdmin } from './admin-render.js';
import { bootWorkerView } from './worker-render.js';

const mode = location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'worker';

if(mode === 'admin'){
  bootAdmin();
}else{
  bootWorkerView();
}
