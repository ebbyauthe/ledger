import { Router as ExpressRouter } from 'express';

// Drop-in replacement for express.Router(). Express 4 doesn't catch errors thrown from async
// handlers — a rejected promise becomes an unhandled rejection, which kills the whole Node
// process (one bad request, or one database hiccup, takes the app down for everyone). This
// wraps every handler and middleware registered on the router so a rejection is passed to
// next(err) instead, where the error handler in server.js turns it into a 500 response.
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function wrap(fn){
  // Four-argument functions are error handlers; Express identifies them by arity, so leave
  // them untouched.
  if(typeof fn !== 'function' || fn.length === 4) return fn;
  return function wrapped(req, res, next){
    try{
      const result = fn(req, res, next);
      if(result && typeof result.then === 'function') result.catch(next);
    }catch(err){
      next(err);
    }
  };
}

export function Router(options){
  const router = ExpressRouter(options);
  for(const method of METHODS){
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}
