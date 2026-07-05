import { Router } from 'express';
import { setSetting } from '../db/index.js';
import { getAccounts, getActiveAccount, isAccountId } from '../services/accounts.js';

export const accountRouter = Router();

// Expose accounts + the switcher state to every template via res.locals
// (Express merges res.locals into the Nunjucks render context).
accountRouter.use((req, res, next) => {
  const accounts = getAccounts();
  res.locals.accounts = accounts;
  res.locals.accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  res.locals.activeAccount = getActiveAccount();
  next();
});

accountRouter.post('/account/:id', (req, res) => {
  const { id } = req.params;
  if (id === 'all' || isAccountId(id)) {
    setSetting('active_account', id);
  }
  res.redirect(req.get('referer') || '/');
});
