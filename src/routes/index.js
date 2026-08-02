import { Router } from 'express';
import adminAuth from './adminAuth.js';
import adminState from './adminState.js';
import adminSettings from './adminSettings.js';
import adminWorkers from './adminWorkers.js';
import adminEntries from './adminEntries.js';
import adminTimers from './adminTimers.js';
import adminPayments from './adminPayments.js';
import adminPeriods from './adminPeriods.js';
import worker from './worker.js';

const router = Router();

router.use('/api/admin', adminAuth);
router.use('/api/admin', adminState);
router.use('/api/admin', adminSettings);
router.use('/api/admin', adminWorkers);
router.use('/api/admin', adminEntries);
router.use('/api/admin', adminTimers);
router.use('/api/admin', adminPayments);
router.use('/api/admin', adminPeriods);
router.use('/api', worker);

export default router;
