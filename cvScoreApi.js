// routes/cvScoreApi.js
// Mount this in your Express app: app.use('/api', cvScoreApiRouter)
// The TMA calls GET /api/cvscore-result?uid=123

import { Router } from 'express';
import { getCVScoreResult } from '../src/cvScore.js';

export const cvScoreApiRouter = Router();

cvScoreApiRouter.get('/cvscore-result', (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const result = getCVScoreResult(uid);
  if (!result) return res.status(404).json({ error: 'No result found. Please send your CV first.' });

  res.json(result);
});
